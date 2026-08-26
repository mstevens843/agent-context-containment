// A conformance suite for anything implementing `ReceiptLedger`.
//
// The interface is three methods and a metadata block, which makes a Postgres or Redis adapter an
// afternoon's work - and makes a SUBTLY WRONG adapter an afternoon's work too. The three guarantees
// in the interface comment are the ones that matter, and all three fail silently when they are
// missing: a ledger that throws on a duplicate turns an ordinary retry into an outage, a ledger that
// forgets permits replay after a restart, and a ledger that throws inside a decision hands its caller
// a catch block that is a bypass.
//
// None of those show up in a smoke test. So this ships as a runnable suite rather than as prose in a
// README: an implementor calls it against their adapter and finds out, instead of reading three
// bullet points and believing they complied.
//
// Pure and dependency-free, so it runs under any test runner - or none.

import type { ReceiptId } from "@agent-containment/core";
import type { LedgerGuarantees, ReceiptLedger, SpentRecord } from "./index.js";

export interface ConformanceCheck {
  readonly name: string;
  readonly passed: boolean;
  /** What went wrong, and why it matters. Empty when it passed. */
  readonly detail: string;
}

const rec = (id: string, at: number): SpentRecord => ({
  receipt: id as unknown as ReceiptId,
  spentAt: at,
  actionId: `action-${id}`,
});

/**
 * Run every check against a freshly-built ledger.
 *
 * Takes a FACTORY, not an instance: several checks need a ledger nobody has touched, and reusing one
 * would make the results depend on the order they run in.
 *
 * BUT IT DOES NOT ASSUME THE FACTORY OBLIGES. A file-backed or database-backed adapter reads durable
 * state at construction, so "fresh" gives you the same rows back - and requiring a pristine store
 * would make this suite unrunnable against exactly the adapters that matter most. So each check uses
 * its own receipt ids, and the suite is correct whether or not the factory forgets. That was found
 * the hard way: the v0.8 check added for defect §10 failed against `jsonFileLedger` purely because an
 * earlier check had already spent `r1` on the same disk.
 */
export function checkLedger(make: () => ReceiptLedger): readonly ConformanceCheck[] {
  const out: ConformanceCheck[] = [];
  let scope = 0;
  const check = (name: string, fn: (k: (suffix: string) => string) => string): void => {
    const n = ++scope;
    const key = (suffix: string): string => `chk${n}-${suffix}`;
    let detail: string;
    try {
      detail = fn(key);
    } catch (e) {
      detail = `threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    out.push({ name, passed: detail === "", detail });
  };

  check("a fresh ledger has spent nothing", (k) =>
    make().isSpent(k("r1") as unknown as ReceiptId)
      ? "isSpent returned true for a receipt nobody spent"
      : "",
  );

  check("spend then isSpent", (k) => {
    const l = make();
    l.spend(rec(k("r1"), 1));
    return l.isSpent(k("r1") as unknown as ReceiptId)
      ? ""
      : "a receipt this ledger accepted does not read back as spent - this permits replay";
  });

  check("spend is idempotent", (k) => {
    const l = make();
    l.spend(rec(k("r1"), 1));
    l.spend(rec(k("r1"), 2));
    const n = l.entries().filter((r) => (r.receipt as unknown as string) === k("r1")).length;
    return n === 1
      ? ""
      : `a duplicate delivery produced ${n} records; a retry is traffic, not an attack`;
  });

  check("the first spend wins", (k) => {
    const l = make();
    l.spend(rec(k("r1"), 1));
    l.spend(rec(k("r1"), 2));
    const found = l.entries().find((r) => (r.receipt as unknown as string) === k("r1"));
    return found?.spentAt === 1
      ? ""
      : `a duplicate rewrote spentAt to ${found?.spentAt}; the audit trail must record the FIRST use`;
  });

  check("spend says whether THIS call recorded it", (k) => {
    // Defect §10. Every adapter here serialised correctly and returned `void`, so the winner was
    // never told - two hosts both got ALLOW on one single-use receipt while the store held one row.
    // A store that is right and an interface that drops the answer produce the same outcome as a
    // store that is wrong.
    const l = make();
    if (l.spend(rec(k("r1"), 1)) !== "recorded") {
      return "a first spend did not report itself as recorded, so no caller can know it won the race";
    }
    return l.spend(rec(k("r1"), 2)) === "already_spent"
      ? ""
      : "a duplicate spend reported itself as recorded - two callers will both believe they won, which is a double-spend";
  });

  check("distinct receipts do not collide", (k) => {
    const l = make();
    l.spend(rec(k("r1"), 1));
    return l.isSpent(k("r2") as unknown as ReceiptId)
      ? "spending one receipt marked a different one spent"
      : "";
  });

  check("entries reflects what was accepted", (k) => {
    const l = make();
    l.spend(rec(k("r1"), 1));
    l.spend(rec(k("r2"), 2));
    const ids = l.entries().map((r) => r.receipt as unknown as string);
    return ids.includes(k("r1")) && ids.includes(k("r2"))
      ? ""
      : `entries() returned ${JSON.stringify(ids)}, losing an accepted record`;
  });

  check("ordinary input never throws", (k) => {
    const l = make();
    // Values a real caller produces: empty-ish ids, long ids, repeated calls.
    for (const id of ["", "x".repeat(512), k("r1"), k("r1")]) l.spend(rec(id, 1));
    for (const id of ["", "nope", k("r1")]) l.isSpent(id as unknown as ReceiptId);
    return "";
  });

  check("guarantees are declared and internally consistent", (k) => {
    const g: LedgerGuarantees = make().guarantees;
    if (!g.singleProcess) {
      return "an adapter that is not even single-process safe cannot be used at all";
    }
    if (g.crossHostSafe && !g.singleHost) {
      return "claims cross-host safety without single-host safety, which cannot both be true";
    }
    if (g.crossHostSafe && !g.crashSafe) {
      return "claims cross-host safety without surviving a crash; another host's live record would be lost";
    }
    if (g.caveat.trim().length < 20) {
      return "the caveat is too thin to act on - name the condition where this adapter stops being safe";
    }
    return "";
  });

  return out;
}

export function formatLedgerChecks(checks: readonly ConformanceCheck[]): string {
  const lines = checks.map(
    (c) => `  ${c.passed ? "pass" : "FAIL"}  ${c.name}${c.passed ? "" : `\n        ${c.detail}`}`,
  );
  const failed = checks.filter((c) => !c.passed).length;
  lines.push("");
  lines.push(
    failed === 0
      ? `  ${checks.length}/${checks.length} - the adapter honours every documented guarantee.`
      : `  ${failed} of ${checks.length} FAILED. Each one above permits a replay or an outage.`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// The demonstration a paragraph cannot make
// ---------------------------------------------------------------------------------------------

/**
 * Two "hosts" sharing storage that is eventually consistent, as a fake.
 *
 * No network, no timers - `sync()` is called explicitly, so the interleaving is chosen by the test
 * rather than by the scheduler, and the result is the same every run.
 *
 * The point is to make one specific thing concrete: a ledger that only claims `singleHost` does not
 * fail loudly across hosts. It returns `false` from `isSpent` on a receipt another host already
 * spent, the guard permits the action, and NOTHING ANYWHERE LOGS A PROBLEM. That silence is why the
 * guarantee is a required field instead of a line in a README.
 */
export function twoHostSimulation(): {
  readonly hostA: ReceiptLedger;
  readonly hostB: ReceiptLedger;
  /** Push every record both hosts know about to both hosts. Convergence, on demand. */
  sync(): void;
} {
  const a = new Map<string, SpentRecord>();
  const b = new Map<string, SpentRecord>();
  const guarantees: LedgerGuarantees = {
    singleProcess: true,
    singleHost: true,
    crossHostSafe: false,
    crashSafe: false,
    staleLockReclaim: false,
    caveat: "a fake for tests: two hosts converge only when sync() is called explicitly",
  };
  const of = (m: Map<string, SpentRecord>): ReceiptLedger => ({
    guarantees,
    isSpent: (r) => m.has(r as unknown as string),
    spend: (record) => {
      const k = record.receipt as unknown as string;
      if (m.has(k)) return "already_spent";
      m.set(k, record);
      return "recorded";
    },
    entries: () => [...m.values()],
  });
  return {
    hostA: of(a),
    hostB: of(b),
    sync: () => {
      for (const [k, v] of a) if (!b.has(k)) b.set(k, v);
      for (const [k, v] of b) if (!a.has(k)) a.set(k, v);
    },
  };
}
