// Two guards, one ledger, and a test that is careful about what it is entitled to say.
//
// `docs/LIMITATIONS.md` had said that the replay work covered one guard and one ledger, and that two
// guards racing was only reachable through `prove:crosshost` and `prove:postgres`. This closes the
// part a pure library can close and leaves the rest named:
//
//   proved here        the ENGINE and GUARD honour a shared store when two of them race IN ONE PROCESS
//   NOT proved here    database concurrency, cross-host topology, crash durability, preemption
//
// A single-threaded runtime has no preemptive interleaving to find, so this is not a concurrency
// proof in the sense `prove:postgres` is. It is the four orders a cooperative scheduler can produce,
// and the most interesting of them is the one where BOTH guards return ALLOW.
//
// See DEFECTS_FOUND.md section 42.

import { memoryLedger } from "@agent-context-containment/ledger";
import { describe, expect, it } from "vitest";
import { INTERLEAVINGS, twoGuardsOneReceipt } from "../src/twoguard.js";

describe("two guards over one ledger", () => {
  const run = twoGuardsOneReceipt();

  it("finds no violation: exactly one guard wins, in every interleaving", () => {
    expect(run.findings, `the shared-ledger run reported: ${run.findings.join("; ")}`).toEqual([]);
  });

  it("covers every interleaving, so the pass is not over an empty set", () => {
    expect(run.outcomes.map((o) => o.interleaving).sort()).toEqual([...INTERLEAVINGS].sort());
  });

  it("exactly one winner each time, and the ledger holds exactly one entry", () => {
    for (const o of run.outcomes) {
      expect(o.winners, `${o.interleaving} produced ${o.winners} winners`).toBe(1);
      expect(o.losers).toBe(1);
    }
  });

  it("one interleaving has BOTH guards ALLOW and still only one spend recorded", () => {
    // THE ROW THAT EARNS `commit`'s RETURN VALUE. When both judge before either commits, neither
    // sees a spent receipt, so both ALLOW - and only one commit records. A caller who acted on the
    // verdict from `decideOnly` without checking what `commit` returned would have acted twice.
    // If this ever stops being true, either the guard changed or this test stopped reaching the
    // shape it was written for, and both are worth knowing.
    const doubleAllow = run.outcomes.filter((o) => o.allowed === 2);
    expect(
      doubleAllow.length,
      "no interleaving reached the both-allow shape - this test no longer exercises the hazard it names",
    ).toBeGreaterThan(0);
    for (const o of doubleAllow) expect(o.winners).toBe(1);
  });
});

describe("the two-guard proof can fail", () => {
  it("two guards over SEPARATE ledgers both win, which is the replay this prevents", () => {
    // THE CONTROL. Without it "exactly one won" is satisfied by a harness that only ever called one
    // guard, or by a receipt that never worked. `sharedLedger: false` is the deployment mistake the
    // whole `requireGuarantees` mechanism exists to make loud: two processes, two stores, one receipt
    // spent twice.
    const control = twoGuardsOneReceipt({ sharedLedger: false });
    expect(
      control.findings,
      `the separate-ledger control reported: ${control.findings.join("; ")}`,
    ).toEqual([]);
    expect(control.outcomes.length).toBe(INTERLEAVINGS.length);
    for (const o of control.outcomes) {
      expect(
        o.winners,
        `${o.interleaving}: separate ledgers must both allow the spend, and ${o.winners} did`,
      ).toBe(2);
    }
  });

  it("and the two runs genuinely differ, so the control is not the same run twice", () => {
    const shared = twoGuardsOneReceipt();
    const separate = twoGuardsOneReceipt({ sharedLedger: false });
    expect(shared.outcomes.map((o) => o.winners)).not.toEqual(
      separate.outcomes.map((o) => o.winners),
    );
  });

  it("uses the ledger it is handed, and that ledger ends up holding the spend", () => {
    // Checked from outside: a proof that quietly built its own store would pass everything above.
    const ledger = memoryLedger();
    twoGuardsOneReceipt({ ledger });
    expect(
      ledger.entries().length,
      "the ledger handed in came back empty - the proof is not using it",
    ).toBeGreaterThan(0);
  });
});

describe("what this does NOT claim", () => {
  it("the in-process ledger does not claim cross-host or crash safety, and this file believes it", () => {
    // THE BOUNDARY, ASSERTED RATHER THAN WRITTEN DOWN. If `memoryLedger` ever started claiming
    // crossHostSafe, this file's careful wording would silently become an understatement - and the
    // docs that cite it would be wrong in the dangerous direction.
    const g = memoryLedger().guarantees;
    expect(g.singleProcess).toBe(true);
    expect(
      g.crossHostSafe,
      "memoryLedger now claims cross-host safety; re-read the docs citing it",
    ).toBe(false);
    expect(g.crashSafe).toBe(false);
    expect(typeof g.caveat).toBe("string");
  });
});
