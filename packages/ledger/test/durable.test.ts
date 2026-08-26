// The cross-host claim, and the machinery that makes it earnable rather than assertable.
//
// `crossHostSafe: true` is the strongest thing any adapter in this package says about itself, and it
// is exactly the claim nobody can check by reading code - it is about what happens when two machines
// race. So it is not a constructor argument. A store asks for it, `proveCrossHost` runs the
// interleavings that break the file-backed adapters, and `durableLedger` downgrades the claim to
// single-host unless every one passed.
//
// The test that matters most here is the one where the proof SAYS NO. A suite that cannot fail is
// not a proof, so `nonAtomicStore` exists solely to be rejected: it does the check and the write in
// two steps, exactly as `jsonFileLedger` does, and claims cross-host safety anyway.

import type { ReceiptId } from "@agent-containment/core";
import { actionId, admitUserConfirmedValue, sourceId } from "@agent-containment/core";
import type { ReceiptEvidence } from "@agent-containment/core";
import {
  POSTGRES_SCHEMA,
  type ReceiptLedger,
  type SpendStore,
  type SpentRecord,
  type SqlExecutor,
  checkLedger,
  createGuard,
  crossHostProven,
  durableLedger,
  fakeTransactionalStore,
  formatCrossHostProof,
  formatLedgerChecks,
  memoryLedger,
  nonAtomicStore,
  postgresSpendStore,
  proveCrossHost,
} from "@agent-containment/ledger";
import { describe, expect, it } from "vitest";

const id = (s: string): ReceiptId => s as unknown as ReceiptId;
const rec = (r: string, at: number, action: string): SpentRecord => ({
  receipt: id(r),
  spentAt: at,
  actionId: action,
});

/**
 * A Postgres good enough to test the SQL against: one map, and a PRIMARY KEY that actually behaves
 * like one. It parses nothing - it recognises the four statements the adapter emits and rejects
 * anything else, so a typo in the SQL fails here rather than at 3am against a real database.
 */
const fakePostgres = (shared: Map<string, SpentRecord>): SqlExecutor => {
  return (sql, params) => {
    if (sql.startsWith("INSERT INTO")) {
      expect(sql, "the insert must be atomic, not a read followed by a write").toContain(
        "ON CONFLICT (receipt) DO NOTHING",
      );
      expect(sql, "without RETURNING there is no way to know which caller won the race").toContain(
        "RETURNING receipt",
      );
      const k = String(params[0]);
      if (shared.has(k)) return [];
      shared.set(k, { receipt: id(k), spentAt: Number(params[1]), actionId: String(params[2]) });
      return [{ receipt: k }];
    }
    if (sql.startsWith("SELECT 1")) return shared.has(String(params[0])) ? [{ "?column?": 1 }] : [];
    if (sql.startsWith("SELECT receipt")) {
      return [...shared.values()]
        .sort((a, b) => a.spentAt - b.spentAt)
        .map((r) => ({ receipt: r.receipt, spent_at: r.spentAt, action_id: r.actionId }));
    }
    throw new Error(`the adapter emitted SQL this fake does not recognise: ${sql}`);
  };
};

describe("cross-host durable ledger", () => {
  it("the proof rejects a store that reads then writes", () => {
    // The discrimination test, and the reason to believe any of the others. `nonAtomicStore` claims
    // crossHostSafe and does the check and the write in two steps. If this passed, the whole proof
    // would be decoration.
    const shared = new Map<string, SpentRecord>();
    const proofs = proveCrossHost(() => nonAtomicStore(shared));
    expect(
      crossHostProven(proofs),
      `a non-atomic store was accepted:\n${formatCrossHostProof(proofs)}`,
    ).toBe(false);
    const failed = proofs.filter((p) => !p.passed).map((p) => p.scenario);
    expect(
      failed,
      "it must fail specifically on the concurrent double-spend, not on everything - a suite that rejects all stores measures nothing",
    ).toEqual(["concurrent double-spend: exactly one host wins"]);
  });

  it("an atomic store passes every scenario", () => {
    const shared = new Map<string, SpentRecord>();
    const proofs = proveCrossHost(() => fakeTransactionalStore(shared));
    expect(crossHostProven(proofs), formatCrossHostProof(proofs)).toBe(true);
    expect(proofs.length, "the proof must run more than a smoke test").toBe(5);
  });

  it("the postgres adapter passes the proof against a PRIMARY KEY that behaves like one", () => {
    const shared = new Map<string, SpentRecord>();
    const proofs = proveCrossHost(() =>
      postgresSpendStore({ query: fakePostgres(shared), sharedAcrossHosts: true }),
    );
    expect(crossHostProven(proofs), formatCrossHostProof(proofs)).toBe(true);
  });

  it("the schema it documents is the schema its SQL requires", () => {
    // A README that drifts from the code is how a deploy-time table ends up missing a constraint.
    expect(POSTGRES_SCHEMA).toContain("receipt   TEXT PRIMARY KEY");
    expect(POSTGRES_SCHEMA).toContain("containment_spent_receipts");
    expect(POSTGRES_SCHEMA, "must be safe to run on every deploy").toContain("IF NOT EXISTS");
  });

  it("an unproven store is DOWNGRADED to single-host rather than trusted", () => {
    // The honest default. A Postgres store used from one process is correct; it simply has not
    // demonstrated the stronger property, and the ledger must not repeat a claim nobody checked.
    const store = postgresSpendStore({
      query: fakePostgres(new Map()),
      sharedAcrossHosts: true,
    });
    const unverified = durableLedger({ store });
    expect(
      unverified.guarantees.crossHostSafe,
      "an unverified claim was passed straight through",
    ).toBe(false);
    expect(unverified.guarantees.caveat).toContain("NOT honoured");
  });

  it("a proven store carries the claim, and its own caveat with it", () => {
    const shared = new Map<string, SpentRecord>();
    const connect = () =>
      postgresSpendStore({ query: fakePostgres(shared), sharedAcrossHosts: true });
    const ledger = durableLedger({
      store: connect(),
      verifiedCrossHost: crossHostProven(proveCrossHost(connect)),
    });
    expect(ledger.guarantees.crossHostSafe).toBe(true);
    expect(ledger.guarantees.crashSafe).toBe(true);
    // The caveat must still name the condition the proof cannot reach: that every host really does
    // point at one database.
    expect(
      ledger.guarantees.caveat,
      "a proven ledger still has to say what the proof did not cover",
    ).toContain("SAME database");
  });

  it("a caller who does not declare a shared store does not get the claim, however atomic it is", () => {
    // Atomicity is necessary and not sufficient: a Postgres in a container on one laptop is atomic
    // and is not cross-host. The adapter cannot tell from a connection string, so it asks.
    const store = postgresSpendStore({
      query: fakePostgres(new Map()),
      sharedAcrossHosts: false,
    });
    expect(store.claims.crossHostSafe).toBe(false);
    expect(store.claims.caveat).toContain("not stated to be shared");
  });

  it("the durable ledger passes the general adapter conformance suite too", () => {
    // Cross-host safety does not exempt it from the ordinary contract: idempotent spend,
    // first-spend-wins, no throwing on ordinary input.
    const checks = checkLedger(() => durableLedger({ store: fakeTransactionalStore() }));
    expect(
      checks
        .filter((c) => !c.passed)
        .map((c) => c.name)
        .join(", "),
      formatLedgerChecks(checks),
    ).toBe("");
  });

  it("the guard never asks isSpent before acting - it routes through the atomic spend", () => {
    // The subtle way to lose cross-host safety after buying it: a caller that queries first and acts
    // on the answer has reintroduced the race in its own code. Asserted by counting: a decision that
    // burns a receipt must produce exactly one insert attempt, and no advisory read it depends on.
    let inserts = 0;
    let reads = 0;
    const rows = new Map<string, SpentRecord>();
    const inner = fakeTransactionalStore(rows);
    const counting = {
      claims: inner.claims,
      insertIfAbsent: (r: SpentRecord) => {
        inserts++;
        return inner.insertIfAbsent(r);
      },
      has: (r: ReceiptId) => {
        reads++;
        return inner.has(r);
      },
      all: () => inner.all(),
    };
    const guard = createGuard({ clock: () => 1, ledger: durableLedger({ store: counting }) });
    // A decision with no receipts spends nothing; the interesting count is that the guard does not
    // probe the store speculatively on the way in.
    const before = reads;
    guard.commit({ decision: "ALLOW", reasons: [], spends: [id("r-1")] } as never, "action-1");
    expect(inserts, "commit must record through the atomic path").toBe(1);
    expect(reads - before, "commit must not read-then-write").toBe(0);
  });

  it("a second commit of the same receipt is idempotent, not a double record", () => {
    const store = fakeTransactionalStore();
    const guard = createGuard({ clock: () => 7, ledger: durableLedger({ store }) });
    guard.commit({ decision: "ALLOW", reasons: [], spends: [id("r-9")] } as never, "action-a");
    guard.commit({ decision: "ALLOW", reasons: [], spends: [id("r-9")] } as never, "action-b");
    const rows = store.all().filter((r) => (r.receipt as unknown as string) === "r-9");
    expect(rows.length, "a retried request produced two records").toBe(1);
    expect(rows[0]?.actionId, "the audit trail must keep the FIRST use").toBe("action-a");
  });

  it("requireGuarantees can now actually be satisfied for crossHostSafe", () => {
    // Before v0.7 this was unsatisfiable by anything in the package - the requirement existed and no
    // adapter could meet it.
    const shared = new Map<string, SpentRecord>();
    const connect = () =>
      postgresSpendStore({ query: fakePostgres(shared), sharedAcrossHosts: true });
    const ledger = durableLedger({
      store: connect(),
      verifiedCrossHost: crossHostProven(proveCrossHost(connect)),
    });
    expect(() =>
      createGuard({ clock: () => 1, ledger, requireGuarantees: { crossHostSafe: true } }),
    ).not.toThrow();
    // And it still refuses an adapter that cannot meet it.
    expect(() =>
      createGuard({
        clock: () => 1,
        ledger: durableLedger({ store: fakeTransactionalStore() }),
        requireGuarantees: { crossHostSafe: true },
      }),
    ).toThrow(/crossHostSafe/);
  });
});

describe("defect §10: the guard must learn who won the race", () => {
  // The store was always right. `proveCrossHost` showed exactly one caller is told "inserted", and
  // that was true. What was not true was the guarantee, because `ReceiptLedger.spend` returned void:
  // the one bit that mattered died at the interface, both hosts kept their stale ALLOW, and both
  // performed the action while the store held one row.
  //
  // These tests reproduce the ordering that exposes it. Sequential decide()/decide() cannot: the
  // first call commits before the second reads. Two hosts JUDGE before either COMMIT lands, and that
  // is the shape.

  const SCOPE = {
    nonce: "defect-10",
    issuedAt: 1_000,
    expiresAt: null,
    source: sourceId("inbox"),
  } as const;

  const receipt = () =>
    admitUserConfirmedValue({
      candidate: "ops@corp.example",
      presented: "Send to ops@corp.example?",
      capability: "email_send",
      role: "sink_identity",
      argName: "to",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });

  const inputWith = (r: NonNullable<ReturnType<typeof receipt>>) => ({
    action: {
      id: actionId("send-1"),
      capability: "email_send" as const,
      tool: "smtp.send",
      args: [
        {
          name: "to",
          role: "sink_identity" as const,
          derivedFrom: [sourceId("inbox")],
          value: "ops@corp.example",
        },
      ],
    },
    sources: [
      { id: sourceId("task"), provenance: "USER" as const },
      { id: sourceId("inbox"), provenance: "EMAIL" as const },
    ],
    receipts: [r],
  });

  /** Two guards over ONE store - which is what `crossHostSafe` claims to make safe. */
  const twoHosts = () => {
    const shared = new Map<string, SpentRecord>();
    const g = () =>
      createGuard({
        clock: () => 1_000,
        ledger: durableLedger({ store: fakeTransactionalStore(shared), verifiedCrossHost: true }),
      });
    return { a: g(), b: g(), shared };
  };

  it("spend reports whether THIS call recorded it", () => {
    const store = fakeTransactionalStore();
    const ledger = durableLedger({ store });
    const r = { receipt: id("r-1"), spentAt: 1, actionId: "a" };
    expect(ledger.spend(r), "the first spend must say it recorded").toBe("recorded");
    expect(ledger.spend({ ...r, actionId: "b" }), "the second must say it did not").toBe(
      "already_spent",
    );
  });

  it("the loser of a cross-host race is refused, not left holding a stale ALLOW", () => {
    const { a, b } = twoHosts();
    const r = receipt();
    if (r === undefined) throw new Error("fixture");
    const first = a.decide(inputWith(r));
    const second = b.decide(inputWith(r));
    expect(first.decision, "the winner should be admitted").toBe("ALLOW");
    expect(second.decision, "BOTH hosts were admitted on one single-use receipt").not.toBe("ALLOW");
  });

  it("the refusal comes from the engine, not from the wrapper", () => {
    // It would be one line to return a DENY from the guard, and it would put policy outside
    // policy.ts - after which an auditor reading a log cannot tell an engine refusal from a
    // wrapper's opinion. The reason code has to be the engine's own.
    const { a, b } = twoHosts();
    const r = receipt();
    if (r === undefined) throw new Error("fixture");
    a.decide(inputWith(r));
    const loser = b.decide(inputWith(r));
    expect(
      loser.reasons.map((x) => x.code),
      "the loser was refused for some reason other than the receipt being gone",
    ).toContain("receipt_already_consumed");
    expect(loser.reasons.length, "a refusal with no reasons is not auditable").toBeGreaterThan(0);
  });

  it("commit tells a manual caller which receipts it lost", () => {
    // decideOnly + commit is the transactional path, and there the obligation is the caller's. It
    // can only be met if commit reports the loss.
    const { a, b } = twoHosts();
    const r = receipt();
    if (r === undefined) throw new Error("fixture");
    const vA = a.decideOnly(inputWith(r));
    const vB = b.decideOnly(inputWith(r));
    expect(vA.decision).toBe("ALLOW");
    expect(vB.decision, "both judged before either wrote, so both see an unspent receipt").toBe(
      "ALLOW",
    );
    expect(a.commit(vA, "action-a"), "the winner lost nothing").toEqual([]);
    expect(
      b.commit(vB, "action-b").map(String),
      "commit did not report the lost receipt, so a manual caller cannot know it lost",
    ).toEqual([String(r.id)]);
  });

  it("the store still holds exactly one record - it was never the broken part", () => {
    const { a, b, shared } = twoHosts();
    const r = receipt();
    if (r === undefined) throw new Error("fixture");
    a.decide(inputWith(r));
    b.decide(inputWith(r));
    expect(shared.size, "the store recorded the receipt more than once").toBe(1);
  });

  it("an adapter that always says recorded fails the conformance suite", () => {
    // The way defect §10 comes back: one adapter at a time. The suite has to be able to say no.
    const always: ReceiptLedger = {
      guarantees: memoryLedger().guarantees,
      isSpent: () => false,
      spend: () => "recorded",
      entries: () => [],
    };
    const checks = checkLedger(() => always);
    expect(
      checks.filter((c) => !c.passed).map((c) => c.name),
      "an adapter that never admits losing a race was accepted",
    ).toContain("spend says whether THIS call recorded it");
  });
});

describe("defect §10's re-decide branch, tested so it can fail", () => {
  // FOUND BY AN AUDIT AFTER v0.9 SHIPPED THE CLAIM. The §10 tests above are sequential: by the time
  // the second guard reads the spent set, the first has already committed, so it refuses without the
  // re-decide branch ever running. Deleting that branch left 74 of 74 tests passing - and §10 was
  // graded FIXED and PROVEN on exactly that evidence.
  //
  // The branch only runs when a row appears between `judge()` and `commit()` INSIDE one synchronous
  // call. No shipped store can do that, because `spentSet()` and `spend` read the same map. A real
  // cross-host race can, so the store below models one: it reports the receipt as unspent when the
  // guard reads, and as already-taken when the guard writes. That is precisely what another host
  // committing in the gap looks like from here.

  const raceStore = (taken: Set<string>): SpendStore => ({
    claims: fakeTransactionalStore().claims,
    // The read the guard does BEFORE deciding. Empty: as far as this host knows, nothing is spent.
    all: () => [],
    has: () => false,
    // The write, after the decision. Another host got there first.
    insertIfAbsent: (record) => {
      taken.add(record.receipt as unknown as string);
      return "already_present";
    },
  });

  const SCOPE10 = {
    nonce: "race",
    issuedAt: 1_000,
    expiresAt: null,
    source: sourceId("inbox"),
  } as const;

  const raceInput = (r: ReceiptEvidence) => ({
    action: {
      id: actionId("send-race"),
      capability: "email_send" as const,
      tool: "smtp.send",
      args: [
        {
          name: "to",
          role: "sink_identity" as const,
          derivedFrom: [sourceId("inbox")],
          value: "ops@corp.example",
        },
      ],
    },
    sources: [
      { id: sourceId("task"), provenance: "USER" as const },
      { id: sourceId("inbox"), provenance: "EMAIL" as const },
    ],
    receipts: [r],
  });

  const receipt10 = () =>
    admitUserConfirmedValue({
      candidate: "ops@corp.example",
      presented: "Send to ops@corp.example?",
      capability: "email_send",
      role: "sink_identity",
      argName: "to",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE10,
    });

  it("a receipt taken between the read and the write turns ALLOW into a refusal", () => {
    const taken = new Set<string>();
    const guard = createGuard({
      clock: () => 1_000,
      ledger: durableLedger({ store: raceStore(taken), verifiedCrossHost: true }),
    });
    const r = receipt10();
    if (r === undefined) throw new Error("fixture");

    const v = guard.decide(raceInput(r));
    expect(
      v.decision,
      "the guard returned the stale verdict it computed before losing the race - defect §10 is back",
    ).not.toBe("ALLOW");
    expect(taken.has(String(r.id)), "the guard never attempted the write").toBe(true);
  });

  it("and the refusal is the ENGINE's, with its own reason code", () => {
    // It would be one line to return a DENY from the guard. That would put policy outside policy.ts,
    // after which an auditor reading a log cannot tell an engine refusal from a wrapper's opinion.
    const guard = createGuard({
      clock: () => 1_000,
      ledger: durableLedger({ store: raceStore(new Set()), verifiedCrossHost: true }),
    });
    const r = receipt10();
    if (r === undefined) throw new Error("fixture");
    const v = guard.decide(raceInput(r));
    expect(
      v.reasons.map((x) => x.code),
      "the loser was refused for some reason other than the receipt being gone",
    ).toContain("receipt_already_consumed");
  });

  it("winning the race still returns the verdict unchanged", () => {
    // The other half. A guard that re-decided unconditionally would be paying for the branch on every
    // call and would look identical from the outside.
    const store = fakeTransactionalStore();
    const guard = createGuard({ clock: () => 1_000, ledger: durableLedger({ store }) });
    const r = receipt10();
    if (r === undefined) throw new Error("fixture");
    expect(guard.decide(raceInput(r)).decision).toBe("ALLOW");
  });
});
