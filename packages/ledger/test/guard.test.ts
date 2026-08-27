// The safe integration path.
//
// The hazard this package exists for is a TYPE hazard, not a logic one. `decide()` accepts `now` and
// `spentReceipts` as optional arguments; omitting them silently disables expiry checking and permits
// unlimited receipt reuse. Nothing warns you. The pure core cannot fix that without holding state,
// which would cost the property the whole design rests on.
//
// So the fix is a shell whose input type does not have those fields. The first test below is the
// only one that really matters: it asserts the mistake is unrepresentable rather than discouraged.

import {
  type ReceiptId,
  actionId,
  admitUserConfirmedValue,
  decide,
  sourceId,
} from "@agent-context-containment/core";
import { describe, expect, it } from "vitest";
import { createGuard, jsonFileLedger, memoryLedger } from "../src/index.js";

const AT = 1_000;
const receipt = (over: { value?: string; expiresAt?: number | null; argName?: string } = {}) =>
  admitUserConfirmedValue({
    candidate: over.value ?? "alice@ourcorp.com",
    presented: `Send to ${over.value ?? "alice@ourcorp.com"}?`,
    capability: "email_send",
    role: "sink_identity",
    argName: over.argName ?? "to",
    lifts: "UNTRUSTED_EXTERNAL",
    scope: {
      nonce: "n",
      issuedAt: AT,
      expiresAt: over.expiresAt === undefined ? AT + 60_000 : over.expiresAt,
      source: null,
    },
  });

const input = (r: ReturnType<typeof receipt>, value = "alice@ourcorp.com") => ({
  action: {
    id: actionId("a1"),
    capability: "email_send" as const,
    tool: "gmail.send",
    args: [{ name: "to", role: "sink_identity" as const, derivedFrom: [sourceId("msg")], value }],
  },
  sources: [{ id: sourceId("msg"), provenance: "EMAIL" as const }],
  receipts: r === undefined ? [] : [r],
});

describe("the guard makes the mistake unrepresentable", () => {
  it("does not accept `now` or `spentReceipts` at all", () => {
    // The point of the whole package, asserted at the type level. Both lines below are compile
    // errors, and the suppression directives on them fail the build if they ever STOP being errors -
    // which is what would happen if someone widened ContainmentInput back to the raw DecisionInput
    // shape. The assertion is that the mistake is unrepresentable, not that it is discouraged.
    const guard = createGuard({ clock: () => AT });
    const base = input(receipt());
    // @ts-expect-error `now` is the guard's to supply, not the caller's to forget
    guard.decideOnly({ ...base, now: 0 });
    // @ts-expect-error `spentReceipts` is the guard's to supply
    guard.decideOnly({ ...base, spentReceipts: new Set<ReceiptId>() });
    expect(guard.decideOnly(base).decision).toBe("ALLOW");
  });

  it("supplies a clock, so expiry is checked whether the caller thought about it or not", () => {
    // The same call through the raw engine, with `now` omitted, allows an expired receipt. That is
    // the accident being prevented, and it is worth pinning both halves so the difference is visible.
    const stale = receipt({ expiresAt: 1 });
    const raw = decide({ ...input(stale), receipts: [stale].filter((r) => r !== undefined) });
    expect(raw.decision, "the raw engine ignores expiry when given no clock").toBe("ALLOW");

    const guard = createGuard({ clock: () => AT + 999_999 });
    const guarded = guard.decideOnly(input(stale));
    expect(guarded.decision).not.toBe("ALLOW");
    expect(guarded.reasons.map((r) => r.code)).toContain("receipt_expired");
  });
});

describe("spending", () => {
  it("burns once and refuses the replay", () => {
    const guard = createGuard({ clock: () => AT });
    const r = receipt();
    expect(guard.decide(input(r)).decision).toBe("ALLOW");
    const replay = guard.decide(input(r));
    expect(replay.decision).not.toBe("ALLOW");
    expect(replay.reasons.map((x) => x.code)).toContain("receipt_already_consumed");
  });

  it("is idempotent on duplicate delivery", () => {
    // A retried request or a doubled queue message is ordinary traffic, not an attack. Committing the
    // same verdict twice must not produce two records, or the audit trail starts lying about volume.
    const guard = createGuard({ clock: () => AT });
    const r = receipt();
    const v = guard.decideOnly(input(r));
    guard.commit(v, "a1");
    guard.commit(v, "a1");
    expect(guard.ledger.entries().length).toBe(1);
  });

  it("burns nothing on a refusal", () => {
    const guard = createGuard({ clock: () => AT });
    guard.decide(input(receipt(), "mallory@evil.tld"));
    expect(guard.ledger.entries()).toEqual([]);
  });

  it("records when and on what, not just that", () => {
    const guard = createGuard({ clock: () => AT });
    guard.decide(input(receipt()));
    const [entry] = guard.ledger.entries();
    expect(entry?.spentAt).toBe(AT);
    expect(entry?.actionId).toBe("a1");
  });

  it("decideOnly leaves the burn to the caller, for transactional shells", () => {
    // The honest caveat in the Guard docs: `decide` burns at DECISION time, not PERFORM time. A shell
    // that needs the burn to be atomic with its own effect uses this instead.
    const guard = createGuard({ clock: () => AT });
    const r = receipt();
    expect(guard.decideOnly(input(r)).decision).toBe("ALLOW");
    expect(guard.ledger.entries()).toEqual([]);
    expect(guard.decideOnly(input(r)).decision).toBe("ALLOW");
  });
});

describe("scope is still enforced through the guard", () => {
  const guard = () => createGuard({ clock: () => AT });

  it("a receipt for one argument does not admit another", () => {
    const r = receipt({ argName: "cc" });
    expect(guard().decideOnly(input(r)).decision).not.toBe("ALLOW");
  });

  it("a receipt for one value does not admit another", () => {
    expect(guard().decideOnly(input(receipt(), "mallory@evil.tld")).decision).not.toBe("ALLOW");
  });

  it("a receipt for one capability does not admit another", () => {
    const r = admitUserConfirmedValue({
      candidate: "alice@ourcorp.com",
      presented: "Send to alice@ourcorp.com?",
      capability: "payment",
      role: "sink_identity",
      argName: "to",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: { nonce: "n", issuedAt: AT, expiresAt: null, source: null },
    });
    expect(guard().decideOnly(input(r)).decision).not.toBe("ALLOW");
  });
});

describe("ledgers", () => {
  it("memoryLedger is idempotent and keeps the first spend", () => {
    const l = memoryLedger();
    l.spend({ receipt: "r1" as ReceiptId, spentAt: 1, actionId: "a" });
    l.spend({ receipt: "r1" as ReceiptId, spentAt: 2, actionId: "b" });
    expect(l.entries().length).toBe(1);
    expect(l.entries()[0]?.spentAt, "a duplicate rewrote when the spend happened").toBe(1);
    expect(l.isSpent("r1" as ReceiptId)).toBe(true);
  });

  it("jsonFileLedger survives a restart", () => {
    // The property an in-memory ledger does not have, and the reason a durable one exists: a ledger
    // that forgets on restart permits replay after every deploy.
    const files = new Map<string, string>();
    const io = {
      path: "/ledger.json",
      readFile: (p: string) => files.get(p),
      writeFile: (p: string, c: string) => void files.set(p, c),
    };
    const first = jsonFileLedger(io);
    first.spend({ receipt: "r1" as ReceiptId, spentAt: 1, actionId: "a" });

    const afterRestart = jsonFileLedger(io);
    expect(afterRestart.isSpent("r1" as ReceiptId)).toBe(true);
    expect(afterRestart.entries().length).toBe(1);
  });

  it("a guard backed by a durable ledger refuses a replay across restarts", () => {
    const files = new Map<string, string>();
    const io = {
      path: "/l.json",
      readFile: (p: string) => files.get(p),
      writeFile: (p: string, c: string) => void files.set(p, c),
    };
    const r = receipt();
    expect(
      createGuard({ clock: () => AT, ledger: jsonFileLedger(io) }).decide(input(r)).decision,
    ).toBe("ALLOW");
    expect(
      createGuard({ clock: () => AT, ledger: jsonFileLedger(io) }).decide(input(r)).decision,
    ).not.toBe("ALLOW");
  });
});

describe("decideOnly carries its own replay protection", () => {
  // MUTATION X01: `spentSet()` -> `new Set()` in createGuard. `guard.decide(...)` still refuses,
  // because the §10 re-decide path catches it via `commit`'s `already_spent` - so the whole suite
  // passed with the primary replay check removed. That is §14's shape: a defect hidden by a
  // mechanism unrelated to it, here rescuing the engine rather than a mutant.
  //
  // It matters because `decideOnly` is the read-only half of the API. A caller doing
  // "check, then act elsewhere, then commit" - which is exactly what the async ledger's two-phase
  // protocol does - reads its answer from here. See DEFECTS_FOUND.md §20.

  it("refuses a receipt the ledger has already recorded, without needing a commit to notice", () => {
    const guard = createGuard({ clock: () => AT });
    const r = receipt();
    expect(guard.decide(input(r)).decision, "the fixture never spent the receipt").toBe("ALLOW");

    const v = guard.decideOnly(input(r));
    expect(
      v.decision,
      "decideOnly permitted an already-spent receipt - the read-only half of the API has no replay protection",
    ).not.toBe("ALLOW");
    expect(
      v.reasons.map((x) => x.code),
      "decideOnly refused, but not for replay - the refusal is coming from something else",
    ).toContain("receipt_already_consumed");
  });

  it("and the refusal comes from the engine, not from the wrapper", () => {
    // The §10 design rule: the reason code, the decision word and the effects all come from
    // `policy.ts`, or an auditor cannot tell an engine refusal from a wrapper's opinion.
    const guard = createGuard({ clock: () => AT });
    const r = receipt();
    guard.decide(input(r));
    const v = guard.decideOnly(input(r));
    expect(v.spends.length, "a refused verdict reported spent receipts").toBe(0);
  });
});
