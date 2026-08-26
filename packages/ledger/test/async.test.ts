// The async ledger boundary, and the invariant that is easy to lose.
//
// The sync guard burns receipts at decision time and only on success, so "a refusal spends nothing"
// is true there by construction. An async ledger has to reserve BEFORE it decides - otherwise the
// spent set the engine reasons over is already stale - which means a refusal now has something to
// unwind. Forgetting the unwind is silent and expensive: the action is refused, the user's approval
// is gone, and the corrected retry they were about to make cannot work.
//
// So most of what follows is about the RELEASE path, not the happy one.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReceiptId } from "@agent-containment/core";
import {
  actionId,
  admitConfirmedTuple,
  admitUserConfirmedValue,
  sourceId,
} from "@agent-containment/core";
import {
  type AsyncReceiptLedger,
  type AsyncSqlExecutor,
  POSTGRES_ASYNC_SCHEMA,
  checkAsyncLedger,
  createAsyncGuard,
  formatAsyncChecks,
  memoryAsyncLedger,
  postgresAsyncLedger,
} from "@agent-containment/ledger";
import { describe, expect, it } from "vitest";

const SCOPE = {
  nonce: "async-test",
  issuedAt: 1_000,
  expiresAt: null,
  source: sourceId("inbox"),
} as const;

/** A receipt that genuinely lifts, so ALLOW is reachable and the consume path is exercised. */
const receiptFor = (candidate: string) =>
  admitUserConfirmedValue({
    candidate,
    presented: `Send to ${candidate}?`,
    capability: "email_send",
    role: "sink_identity",
    argName: "to",
    lifts: "UNTRUSTED_EXTERNAL",
    scope: SCOPE,
  });

const inputWith = (receipt: NonNullable<ReturnType<typeof receiptFor>>, value: string) => ({
  action: {
    id: actionId("send-1"),
    capability: "email_send" as const,
    tool: "smtp.send",
    args: [{ name: "to", role: "sink_identity" as const, derivedFrom: [sourceId("inbox")], value }],
  },
  sources: [
    { id: sourceId("task"), provenance: "USER" as const },
    { id: sourceId("inbox"), provenance: "EMAIL" as const },
  ],
  receipts: [receipt],
});

/** A Postgres good enough to test the SQL: real PRIMARY KEY semantics, and it rejects unknown SQL. */
const fakePg = (rows: Map<string, Record<string, unknown>>): AsyncSqlExecutor => {
  return async (sql, params) => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (s.startsWith("INSERT INTO")) {
      expect(s, "the reserve must be one atomic statement").toContain(
        "ON CONFLICT (receipt) DO NOTHING",
      );
      expect(s, "without RETURNING there is no way to know who won").toContain("RETURNING receipt");
      const k = String(params[0]);
      if (rows.has(k)) return [];
      rows.set(k, {
        receipt: k,
        state: "reserved",
        reservation_id: String(params[1]),
        at: Number(params[2]),
        action_id: String(params[3]),
      });
      return [{ receipt: k }];
    }
    if (s.startsWith("UPDATE") && s.includes("SET reservation_id")) {
      const [k, resId, now, actionIdParam, cutoff] = params;
      const row = rows.get(String(k));
      if (row === undefined || row.state !== "reserved" || Number(row.at) >= Number(cutoff))
        return [];
      row.reservation_id = String(resId);
      row.at = Number(now);
      row.action_id = String(actionIdParam);
      return [{ receipt: String(k) }];
    }
    if (s.startsWith("UPDATE") && s.includes("SET state = 'consumed'")) {
      expect(s, "consume must be guarded by reservation_id").toContain("reservation_id = $1");
      for (const row of rows.values()) {
        if (row.reservation_id === String(params[0]) && row.state === "reserved") {
          row.state = "consumed";
          row.at = Number(params[1]);
        }
      }
      return [];
    }
    if (s.startsWith("DELETE")) {
      expect(s, "release must be guarded by reservation_id").toContain("reservation_id = $1");
      expect(s, "release must never touch a consumed row").toContain("state = 'reserved'");
      for (const [k, row] of [...rows.entries()]) {
        if (row.reservation_id === String(params[0]) && row.state === "reserved") rows.delete(k);
      }
      return [];
    }
    if (s.startsWith("SELECT 1")) return rows.has(String(params[0])) ? [{ ok: 1 }] : [];
    if (s.startsWith("SELECT receipt")) {
      return [...rows.values()].filter((r) => r.state === "consumed");
    }
    throw new Error(`the adapter emitted SQL this fake does not recognise: ${s}`);
  };
};

const pgLedger = (rows: Map<string, Record<string, unknown>>): AsyncReceiptLedger => {
  let n = 0;
  return postgresAsyncLedger({
    query: fakePg(rows),
    sharedAcrossHosts: true,
    newReservationId: () => `res-${++n}-${rows.size}`,
  });
};

describe("async guard", () => {
  it("an admission consumes the receipt exactly once", async () => {
    const ledger = memoryAsyncLedger();
    const guard = createAsyncGuard({ ledger, clock: () => 1_000 });
    const receipt = receiptFor("ops@corp.example");
    expect(receipt).toBeDefined();
    if (receipt === undefined) return;

    const first = await guard.decide(inputWith(receipt, "ops@corp.example"));
    expect(first.verdict.decision).toBe("ALLOW");
    expect(first.receipts, "an admission must consume").toBe("consumed");
    expect(await ledger.isSpent(receipt.id)).toBe(true);
  });

  it("a replay of the same receipt is refused, and refused for the right reason", async () => {
    const ledger = memoryAsyncLedger();
    const guard = createAsyncGuard({ ledger, clock: () => 1_000 });
    const receipt = receiptFor("ops@corp.example");
    if (receipt === undefined) throw new Error("fixture");

    await guard.decide(inputWith(receipt, "ops@corp.example"));
    const replay = await guard.decide(inputWith(receipt, "ops@corp.example"));

    expect(replay.verdict.decision).not.toBe("ALLOW");
    expect(
      replay.verdict.reasons.map((r) => r.code),
      "the replay was refused for some other reason - right answer, wrong reason",
    ).toContain("receipt_already_consumed");
    expect(replay.alreadySpent.map(String)).toEqual([String(receipt.id)]);
  });

  it("A REFUSAL SPENDS NOTHING, and the receipt still works afterwards", async () => {
    // The load-bearing test of the whole design. Refuse first, then succeed with the same receipt:
    // if the refusal had burned it, the second call could not work and a user's approval would have
    // been destroyed by an action that never happened.
    const ledger = memoryAsyncLedger();
    const guard = createAsyncGuard({ ledger, clock: () => 1_000 });
    const receipt = receiptFor("ops@corp.example");
    if (receipt === undefined) throw new Error("fixture");

    // Same receipt, WRONG value: the receipt admits one exact string and this is not it.
    const refused = await guard.decide(inputWith(receipt, "attacker@evil.example"));
    expect(refused.verdict.decision).not.toBe("ALLOW");
    expect(refused.receipts, "a refusal must release, not consume").toBe("released");
    expect(await ledger.isSpent(receipt.id), "a refusal burned the receipt").toBe(false);

    const corrected = await guard.decide(inputWith(receipt, "ops@corp.example"));
    expect(
      corrected.verdict.decision,
      "the corrected retry failed, so the refusal destroyed a valid approval",
    ).toBe("ALLOW");
    expect(corrected.receipts).toBe("consumed");
  });

  it("a decision with no receipts touches the ledger not at all", async () => {
    const ledger = memoryAsyncLedger();
    const guard = createAsyncGuard({ ledger, clock: () => 1_000 });
    const result = await guard.decide({
      action: {
        id: actionId("read-1"),
        capability: "text_response",
        tool: "assistant.summarise",
        args: [{ name: "body", role: "payload", derivedFrom: [sourceId("inbox")] }],
      },
      sources: [
        { id: sourceId("task"), provenance: "USER" },
        { id: sourceId("inbox"), provenance: "EMAIL" },
      ],
    });
    expect(result.verdict.decision).toBe("ALLOW");
    expect(result.receipts, "an action with no receipts should not reserve anything").toBe("none");
    expect(await ledger.entries()).toEqual([]);
  });

  it("two concurrent decisions on one receipt: exactly one is admitted", async () => {
    // Both decisions are in flight before either is awaited. An adapter that checks and then writes
    // has a window between them; this asserts there is none.
    const ledger = memoryAsyncLedger();
    const guard = createAsyncGuard({ ledger, clock: () => 1_000 });
    const receipt = receiptFor("ops@corp.example");
    if (receipt === undefined) throw new Error("fixture");

    const [a, b] = await Promise.all([
      guard.decide(inputWith(receipt, "ops@corp.example")),
      guard.decide(inputWith(receipt, "ops@corp.example")),
    ]);
    const allowed = [a, b].filter((r) => r.verdict.decision === "ALLOW").length;
    expect(allowed, "both concurrent callers were admitted on one receipt - a double-spend").toBe(
      1,
    );
    const consumed = [a, b].filter((r) => r.receipts === "consumed").length;
    expect(consumed, "more than one caller consumed the same receipt").toBe(1);
  });

  it("requireGuarantees rejects an adapter that cannot meet the deployment's needs", async () => {
    expect(() =>
      createAsyncGuard({
        ledger: memoryAsyncLedger(),
        clock: () => 1,
        requireGuarantees: { crossHostSafe: true },
      }),
    ).toThrow(/crossHostSafe/);
    // And accepts one that can.
    expect(() =>
      createAsyncGuard({
        ledger: pgLedger(new Map()),
        clock: () => 1,
        requireGuarantees: { crossHostSafe: true, crashSafe: true },
      }),
    ).not.toThrow();
  });
});

describe("async ledger adapters", () => {
  it("the in-memory adapter honours the reservation protocol", async () => {
    const rows = new Map();
    const checks = await checkAsyncLedger(() => memoryAsyncLedger(rows));
    expect(
      checks
        .filter((c) => !c.passed)
        .map((c) => c.name)
        .join(", "),
      formatAsyncChecks(checks),
    ).toBe("");
  });

  it("the postgres adapter honours it too, against real PRIMARY KEY semantics", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const checks = await checkAsyncLedger(() => pgLedger(rows));
    expect(
      checks
        .filter((c) => !c.passed)
        .map((c) => c.name)
        .join(", "),
      formatAsyncChecks(checks),
    ).toBe("");
  });

  it("the suite can fail: a read-then-write adapter is rejected", async () => {
    // A conformance suite that cannot say no is decoration. This adapter checks and then writes,
    // which is the commonest way to get a reservation wrong, and it must fail the concurrent
    // scenario specifically rather than everything.
    const rows = new Map<string, string>();
    const broken = (): AsyncReceiptLedger => ({
      guarantees: memoryAsyncLedger().guarantees,
      reserve: async (ids, _actionId, _now) => {
        const reserved: ReceiptId[] = [];
        const alreadySpent: ReceiptId[] = [];
        for (const r of ids) {
          const k = r as unknown as string;
          const seen = rows.has(k); // the read
          await Promise.resolve(); // ...and the window
          if (seen) alreadySpent.push(r);
          else {
            rows.set(k, "reserved"); // the write
            reserved.push(r);
          }
        }
        return { id: "broken", reserved, alreadySpent };
      },
      consume: async () => {},
      release: async () => {},
      isSpent: async (r) => rows.has(r as unknown as string),
      entries: async () => [],
      stats: async () => ({
        reserved: rows.size,
        consumed: 0,
        stranded: 0,
        reclaimed: 0,
        released: 0,
      }),
    });
    const checks = await checkAsyncLedger(broken);
    const failed = checks.filter((c) => !c.passed).map((c) => c.name);
    expect(
      failed,
      `a read-then-write adapter passed the concurrency scenario:\n${formatAsyncChecks(checks)}`,
    ).toContain("concurrent reservations: exactly one caller wins");
  });

  it("the documented schema is the schema the SQL requires", async () => {
    expect(POSTGRES_ASYNC_SCHEMA).toContain("receipt        TEXT PRIMARY KEY");
    expect(POSTGRES_ASYNC_SCHEMA).toContain("CHECK (state IN ('reserved', 'consumed'))");
    expect(POSTGRES_ASYNC_SCHEMA, "must be safe to run on every deploy").toContain("IF NOT EXISTS");
  });

  it("a stale reservation is reclaimable, and a consumed one never is", async () => {
    // The reclaim rule has to distinguish an abandoned reservation from a completed spend. Getting
    // it wrong in the second direction is a double-spend, and it looks like ordinary cleanup.
    const rows = new Map<string, Record<string, unknown>>();
    let n = 0;
    const make = () =>
      postgresAsyncLedger({
        query: fakePg(rows),
        sharedAcrossHosts: true,
        staleAfterMs: 1_000,
        newReservationId: () => `res-${++n}`,
      });

    // Abandoned at t=0, reclaimed at t=5000.
    await make().reserve(["stale" as unknown as ReceiptId], "crashed", 0);
    const reclaimed = await make().reserve(["stale" as unknown as ReceiptId], "later", 5_000);
    expect(reclaimed.reserved.length, "an abandoned reservation was never reclaimable").toBe(1);

    // Consumed at t=0 must NOT be reclaimable, however long ago it was.
    const l = make();
    await l.consume(await l.reserve(["done" as unknown as ReceiptId], "finished", 0), 0);
    const attempt = await make().reserve(["done" as unknown as ReceiptId], "replay", 5_000);
    expect(
      attempt.alreadySpent.length,
      "a CONSUMED receipt was reclaimed as if abandoned - that is a double-spend",
    ).toBe(1);
  });

  it("disabling reclaim is reflected in the guarantees, not just in behaviour", async () => {
    const noReclaim = postgresAsyncLedger({
      query: fakePg(new Map()),
      sharedAcrossHosts: true,
      staleAfterMs: null,
      newReservationId: () => "r",
    });
    expect(noReclaim.guarantees.staleLockReclaim).toBe(false);
    expect(noReclaim.guarantees.caveat).toContain("strands that receipt permanently");
  });
});

describe("multi-receipt reservations: all or nothing", () => {
  // Raised by an adversarial review of the design. `Verdict.spends` carries ONE receipt per
  // over-ceiling argument, so an action can need several at once. If `reserve` claims r1, loses r2,
  // and the decision then fails, r1 has been BURNED BEHIND A REFUSAL - the exact invariant the whole
  // two-phase design exists to protect.
  //
  // The guard's release step is what prevents it, and "the design handles it" is not evidence. These
  // tests are.

  const SCOPE = (n: string) => ({
    nonce: n,
    issuedAt: 1_000,
    expiresAt: null,
    source: sourceId("inbox"),
  });

  const receiptFor2 = (candidate: string, argName: string, nonce: string) =>
    admitUserConfirmedValue({
      candidate,
      presented: `Confirm ${candidate}?`,
      capability: "payment",
      role: argName === "destination" ? "sink_identity" : "magnitude",
      argName,
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE(nonce),
    });

  const twoArgInput = (
    rs: readonly NonNullable<ReturnType<typeof receiptFor2>>[],
    amount: string,
  ) => ({
    action: {
      id: actionId("pay-1"),
      capability: "payment" as const,
      tool: "billing.pay",
      args: [
        {
          name: "destination",
          role: "sink_identity" as const,
          derivedFrom: [sourceId("inbox")],
          value: "acct-1",
        },
        {
          name: "amount",
          role: "magnitude" as const,
          derivedFrom: [sourceId("inbox")],
          value: amount,
        },
      ],
    },
    sources: [
      { id: sourceId("task"), provenance: "USER" as const },
      { id: sourceId("inbox"), provenance: "EMAIL" as const },
    ],
    receipts: rs,
    confirmed: true,
  });

  it("a refusal releases EVERY receipt it reserved, not just the ones it lost", () => {
    const dest = receiptFor2("acct-1", "destination", "n1");
    const amt = receiptFor2("500", "amount", "n2");
    if (dest === undefined || amt === undefined) throw new Error("fixture");

    return (async () => {
      const ledger = memoryAsyncLedger();
      const guard = createAsyncGuard({ ledger, clock: () => 1_000 });

      // The amount receipt is for "500" and the action asks for "9999", so the action is refused -
      // AFTER both receipts have been reserved.
      const refused = await guard.decide(twoArgInput([dest, amt], "9999"));
      expect(refused.verdict.decision, "the mismatched value should have been refused").not.toBe(
        "ALLOW",
      );
      expect(refused.receipts).toBe("released");

      // Both must be spendable again. If either was burned, a corrected retry cannot work and a
      // human's approval was destroyed by an action that never happened.
      expect(await ledger.isSpent(dest.id), "the destination receipt was burned by a refusal").toBe(
        false,
      );
      expect(await ledger.isSpent(amt.id), "the amount receipt was burned by a refusal").toBe(
        false,
      );

      // The corrected retry needs a THIRD receipt, and that is the tuple gate doing its job rather
      // than an inconvenience: `payment` declares recipient_and_amount, so two values admitted
      // SEPARATELY must also be ratified as a pair. Without it the retry gets NEEDS_REVIEW - correct,
      // and not what this test is about.
      const pair = admitConfirmedTuple({
        entries: [
          { argName: "destination", value: "acct-1" },
          { argName: "amount", value: "500" },
        ],
        presented: "Pay 500 to acct-1?",
        capability: "payment",
        role: "sink_identity",
        lifts: "UNTRUSTED_EXTERNAL",
        scope: SCOPE("n3"),
      });
      if (pair === undefined) throw new Error("fixture");

      const corrected = await guard.decide(twoArgInput([dest, amt, pair], "500"));
      expect(
        corrected.verdict.decision,
        "the corrected retry failed, so the refusal destroyed valid approvals",
      ).toBe("ALLOW");
      expect(corrected.receipts).toBe("consumed");
    })();
  });

  it("a partly-lost reservation still leaves nothing burned", async () => {
    // One receipt already spent by somebody else, one fresh. The decision must refuse - and the fresh
    // one must survive, because it was never used.
    const ledger = memoryAsyncLedger();
    const guard = createAsyncGuard({ ledger, clock: () => 1_000 });
    const dest = receiptFor2("acct-1", "destination", "n1");
    const amt = receiptFor2("500", "amount", "n2");
    if (dest === undefined || amt === undefined) throw new Error("fixture");

    // Burn the destination receipt on its own, the way another host would.
    await ledger.consume(await ledger.reserve([dest.id], "somebody-else", 1), 1);

    const result = await guard.decide(twoArgInput([dest, amt], "500"));
    expect(result.verdict.decision, "a spent receipt must not admit anything").not.toBe("ALLOW");
    expect(result.alreadySpent.map(String)).toEqual([String(dest.id)]);
    expect(
      await ledger.isSpent(amt.id),
      "the untouched receipt was burned by somebody else's replay",
    ).toBe(false);
  });

  it("release is documented as unsafe after an effect, not just after a refusal", () => {
    // The reviewer's sharpest point: a `release` reachable from a catch block AFTER the effect may
    // have happened returns a receipt to the claimable pool, and that is a replay-permitting
    // operation controlled by whoever can induce a failure. The guard only ever releases on a POLICY
    // REFUSAL, before any effect exists - but `release` is on the public interface, so the hazard has
    // to be written where somebody reaching for it will see it.
    const src = readFileSync(join(import.meta.dirname, "..", "src", "async.ts"), "utf8");
    expect(src, "the release hazard is not documented on the interface").toMatch(
      /release[\s\S]{0,600}(after the effect|effect may have|replay)/i,
    );
  });
});

describe("crash semantics and the stranded-receipt count", () => {
  // A crash between RESERVE and CONSUME leaves a row nobody will finish. The receipt is not
  // double-spendable - the safe direction - and it is not usable either. There is no setting of
  // `staleAfterMs` that makes that free: too long and a crash costs a receipt until it expires, too
  // short and a slow-but-alive caller loses a reservation it was about to consume, which IS a
  // double-spend. It is an integration choice, and a choice whose consequences are invisible is not
  // one - hence `stats()`.

  const id2 = (s: string) => s as unknown as ReceiptId;

  it("a crash after reserve strands the receipt rather than re-arming it", async () => {
    const shared = new Map();
    const crashed = memoryAsyncLedger(shared);
    await crashed.reserve([id2("r-crash")], "will-crash", 1_000);
    // The crash: no consume, no release. A fresh process attaches to the same store.
    const survivor = memoryAsyncLedger(shared);
    const attempt = await survivor.reserve([id2("r-crash")], "survivor", 1_100);
    expect(
      attempt.alreadySpent.map(String),
      "an abandoned reservation was immediately reusable - a crash must not re-arm a receipt",
    ).toEqual(["r-crash"]);
  });

  it("the stranded count makes it visible instead of merely true", async () => {
    const shared = new Map();
    const l = memoryAsyncLedger(shared, { staleAfterMs: 1_000 });
    await l.reserve([id2("r-a")], "will-crash", 0);
    await l.consume(await l.reserve([id2("r-b")], "finished", 0), 0);

    const fresh = await l.stats(500);
    expect(fresh.stranded, "nothing is stale yet").toBe(0);
    expect(fresh.reserved).toBe(1);
    expect(fresh.consumed).toBe(1);

    const later = await l.stats(5_000);
    expect(later.stranded, "the abandoned reservation is not being counted as stranded").toBe(1);
    expect(later.consumed, "a consumed receipt must never be counted as stranded").toBe(1);
  });

  it("a refusal releases rather than strands, and the release is counted", async () => {
    const shared = new Map();
    const ledger = memoryAsyncLedger(shared, { staleAfterMs: 1_000 });
    const guard = createAsyncGuard({ ledger, clock: () => 1_000 });
    const receipt = receiptFor("ops@corp.example");
    if (receipt === undefined) throw new Error("fixture");

    const refused = await guard.decide(inputWith(receipt, "attacker@evil.example"));
    expect(refused.receipts).toBe("released");
    const s = await ledger.stats(9_999);
    expect(s.released, "the release was not counted").toBe(1);
    expect(s.reserved, "a refusal left a reservation behind").toBe(0);
    expect(s.stranded, "a refusal stranded a receipt").toBe(0);
  });

  it("a stale reservation is reclaimed, and the reclaim is counted", async () => {
    const shared = new Map();
    const l = memoryAsyncLedger(shared, { staleAfterMs: 1_000 });
    await l.reserve([id2("r-stale")], "abandoned", 0);
    const reclaim = await l.reserve([id2("r-stale")], "later", 5_000);
    expect(reclaim.reserved.map(String), "a stale reservation was never reclaimable").toEqual([
      "r-stale",
    ]);
    expect((await l.stats(5_000)).reclaimed).toBe(1);
  });

  it("reclaim is BOUNDED: it never touches a consumed receipt, however old", async () => {
    // The direction that would be a double-spend, and it is indistinguishable from cleanup at a
    // glance. The guard for it is the `state === "reserved"` clause, not an age check.
    const shared = new Map();
    const l = memoryAsyncLedger(shared, { staleAfterMs: 1_000 });
    await l.consume(await l.reserve([id2("r-done")], "finished", 0), 0);
    const attempt = await l.reserve([id2("r-done")], "replay", 10_000_000);
    expect(
      attempt.alreadySpent.map(String),
      "a consumed receipt was reclaimed as if abandoned - that is a double-spend",
    ).toEqual(["r-done"]);
    expect((await l.stats(10_000_000)).reclaimed).toBe(0);
  });

  it("staleAfterMs: null means a crash strands the receipt permanently, and says so", async () => {
    // Strictly safer, and not free. The caveat has to name the cost or the setting reads as the
    // careful one with no downside.
    const shared = new Map();
    const l = memoryAsyncLedger(shared, { staleAfterMs: null });
    await l.reserve([id2("r-forever")], "abandoned", 0);
    const attempt = await l.reserve([id2("r-forever")], "later", 10_000_000);
    expect(attempt.alreadySpent.length, "reclaim was disabled and it reclaimed anyway").toBe(1);
    const s = await l.stats(10_000_000);
    expect(s.stranded, "with reclaim off, nothing is ever counted stale").toBe(0);
    expect(s.reserved, "the row is still held - permanently").toBe(1);
  });

  it("the tradeoff is documented where somebody choosing the value will read it", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "src", "asyncpg.ts"), "utf8");
    expect(src, "staleAfterMs is not documented as a tradeoff").toMatch(
      /no free value|There is no free/i,
    );
    expect(src, "the dangerous direction is not named").toMatch(/double-spend|about to consume/i);
  });
});
