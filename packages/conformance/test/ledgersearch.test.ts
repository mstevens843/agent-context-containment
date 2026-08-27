// The cross-action replay search, and the controls that stop it being a green light nobody earned.
//
// WHY IT EXISTS. `docs/LIMITATIONS.md` row 14 named two gaps in the receipt search and this closes
// one of them: `spentReceipts` was a `Set` the generator pre-seeded, so "already spent" meant "the
// fixture said so", never "an earlier action used it". Nothing in the tree ran a SEQUENCE of actions
// against one store.
//
// This runs every iteration through a real `Guard` over a real `ReceiptLedger`, and the ledger carries
// across iterations. Measured at 8,000 iterations on seed 0x1ed6e401: 3,032 receipts genuinely burned
// and 2,834 iterations that re-presented a burned id.
//
// THE CONTROLS MATTER MORE THAN THE PASS:
//
//   1. the run must actually REPLAY - a run that never re-presents a burned id cannot tell a store
//      that refuses replays from one with no memory at all, and the floor asserts it
//   2. it must also SPEND - a replay of an id that never worked proves nothing
//   3. three mutation entries name this file: the engine's spent check, the guard's spent set, and
//      the ledger's own record-keeping
//
// See DEFECTS_FOUND.md section 41.

import { CAPABILITY_POLICY } from "@agent-context-containment/core";
import { memoryLedger } from "@agent-context-containment/ledger";
import { describe, expect, it } from "vitest";
import { formatFindings } from "../src/adversary.js";
import { LEDGER_SHAPES, searchLedgerReplay } from "../src/ledgersearch.js";

/** Fixed, so a failure in CI reproduces on a laptop with no further information. */
const SEED = 0x1ed6_e401;

describe("a search over sequences of actions sharing one ledger", () => {
  const run = searchLedgerReplay({ iterations: 8_000, seed: SEED });

  it("finds no property violation in the shipped engine and ledger", () => {
    expect(run.findings.length, `the search found violations:\n${formatFindings(run)}`).toBe(0);
  });

  it("never allows an action whose receipt an earlier action already spent", () => {
    expect(run.findings.filter((f) => f.kind === "under_block")).toHaveLength(0);
  });

  it("never refuses an unspent receipt that covers its argument", () => {
    // The utility direction. Without it a ledger that refused everything would pass everything above.
    expect(run.findings.filter((f) => f.kind === "over_block")).toHaveLength(0);
  });

  it("never reports a spend the ledger does not hold", () => {
    // THE CONTRACT A `Set` COULD NOT EXPRESS. A guard that reports a spend it did not record is
    // defect section 10's shape one layer up, and no `spentReceipts` fixture can catch it, because
    // the fixture IS the record.
    expect(run.findings.filter((f) => f.kind === "wrong_admission")).toHaveLength(0);
  });

  it("actually replays, rather than passing over a sequence of fresh receipts", () => {
    // THE VACUITY FLOOR. Every assertion above is satisfied by a run that never re-presents a burned
    // id - which is what the pre-seeded `Set` version amounted to.
    expect(
      run.replaysAttempted,
      "no burned receipt was ever re-presented - the properties above are vacuous",
    ).toBeGreaterThan(1_000);
  });

  it("and actually spends, so the replays are of receipts that once worked", () => {
    expect(
      run.spends,
      "nothing was ever admitted, so every 'replay' re-presented a receipt that never worked",
    ).toBeGreaterThan(1_000);
  });

  it("reaches every sequence shape", () => {
    for (const shape of LEDGER_SHAPES) {
      expect(run.shapes[shape] ?? 0, `shape ${shape} was never generated`).toBeGreaterThan(100);
    }
  });

  it("is deterministic, and a different seed explores a different space", () => {
    const a = searchLedgerReplay({ iterations: 1_500, seed: SEED });
    const b = searchLedgerReplay({ iterations: 1_500, seed: SEED });
    expect(a.shapes).toEqual(b.shapes);
    expect(a.replaysAttempted).toBe(b.replaysAttempted);
    const other = searchLedgerReplay({ iterations: 1_500, seed: 0x1234_5678 });
    expect(other.shapes).not.toEqual(a.shapes);
  });

  it("uses the ledger it was handed, and that ledger holds what the run burned", () => {
    // Checked from OUTSIDE the search. A search that quietly kept its own set would pass every
    // assertion above, and the whole point of this file is that the store is real.
    const ledger = memoryLedger();
    const r = searchLedgerReplay({ iterations: 1_500, seed: SEED, ledger });
    expect(r.spends, "the run spent nothing, so this asserts nothing").toBeGreaterThan(0);
    expect(
      ledger.entries().length,
      "the ledger handed to the search came back empty - it is not using it",
    ).toBeGreaterThan(0);
    for (const entry of ledger.entries()) expect(ledger.isSpent(entry.receipt)).toBe(true);
  });
});

describe("the replay search can fail", () => {
  it("catches a ledger that forgets, judged by the search's own spend model", () => {
    // THE CONTROL. A store whose `isSpent` is always false and whose `entries` stay empty has no
    // memory: every replay is permitted, and every one of those is a finding. The oracle's spend set
    // is written inside the search and never asks the ledger, which is what makes this expressible.
    const forgetful = {
      guarantees: {
        singleProcess: true,
        singleHost: false,
        crossHostSafe: false,
        crashSafe: false,
        staleLockReclaim: false,
        caveat: "a deliberately forgetful ledger, for the negative control",
      },
      isSpent: () => false,
      spend: () => "recorded" as const,
      entries: () => [],
    };
    const control = searchLedgerReplay({
      iterations: 3_000,
      seed: SEED,
      ledger: forgetful as never,
    });
    expect(
      control.findings.length,
      "a ledger that remembers nothing produced no finding - the search proves nothing",
    ).toBeGreaterThan(0);
    expect(
      control.findings.filter((f) => f.kind === "under_block").length,
      "the control fired, but on nothing that reads as a permitted replay",
    ).toBeGreaterThan(0);
  });

  it("refuses a policy where nothing can lift, rather than exploring an empty space", () => {
    // A table that lifts by nothing admits no receipt, so nothing is ever spent and every property
    // here is vacuously true. Throwing beats reporting a clean run over an empty space.
    const inert = Object.fromEntries(
      Object.entries(CAPABILITY_POLICY).map(([k, row]) => [
        k,
        { ...row, liftableBy: new Set<string>() },
      ]),
    );
    expect(() =>
      searchLedgerReplay({ iterations: 10, seed: SEED, policy: inert as never }),
    ).toThrow(/lifts by anything/);
  });
});
