// The receipt search, and the controls that stop it being a green light nobody earned.
//
// WHY IT EXISTS. `docs/LIMITATIONS.md` row 14 named receipts as the largest gap in the property
// searches: both existing ones pass `receipts: []` or junk, so admission, binding and spending were
// defended entirely by hand-written tests. A refutation pass then measured two shapes inside that
// gap which were weaker than the row claimed - **a wrong role** was caught only by
// `unguarded.test.ts`, and **the same receipt reused inside one action** was caught by NOTHING: the
// whole suite stayed green with that branch deleted.
//
// Both are now reached by a search. Measured, by deleting each branch and counting findings at
// 12,000 iterations: reuse-in-one-action 902, the role half of receipt binding 589, expiry 593.
//
// AND IT CORRECTS A DISPOSITION. Section 20 filed `P05` - the one-receipt-one-slot guard - as
// UNREACHABLE, on the strength of "an exhaustive sweep of argument and receipt shapes reaches it
// zero times". It is reachable: deleting it changes the answer on hundreds of generated inputs, and
// a two-argument action with one receipt id reaches it directly. See DEFECTS_FOUND.md section 34.
//
// THE CONTROLS MATTER MORE THAN THE PASS:
//
//   1. the run must reach every receipt shape, and a floor on each is asserted
//   2. it must reach ADMISSION, not only refusal - a search where no receipt ever works cannot tell
//      a correct engine from one that refuses everything, and the first version of this file could
//      not, because every generated receipt used a rule its capability row does not lift by
//   3. a mutation entry names this file and requires it to go red

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPABILITY_POLICY } from "@agent-context-containment/core";
import { describe, expect, it } from "vitest";
import { formatFindings } from "../src/adversary.js";
import { RECEIPT_SHAPES, receiptSearchScope, searchReceipts } from "../src/receiptadversary.js";

const REPO = join(import.meta.dirname, "..", "..", "..");

/** Fixed, so a failure in CI reproduces on a laptop with no further information. */
const SEED = 0x0dec_0001;

/**
 * The control: an engine whose ceilings admit everything, judged against the shipped table.
 *
 * WHAT IT LICENSES, AND WHAT IT DOES NOT. Measured at 3,000 iterations on the seed below: 347
 * `under_block` findings against the shipped oracle, and zero when judged against its own loosened
 * table - so it is a real control and not a tautology. But every one of those findings is a CEILING
 * breach. This control says the search can produce findings; it does NOT say the search can detect a
 * receipt-BINDING defect, because a loosened engine needs no receipts at all.
 *
 * What licenses the binding claim is the mutation set, each measured by deletion at 12,000 iterations
 * on seed 0x0dec0001: P05 reuse 1,232, the argName branch 1,034, the lift level 1,028, value binding
 * 1,968, source binding 989, expiry 902, the role half 887, the label-ambiguity guard 576, rule 4
 * collision suffixing 544, and `liftableBy` 1,022. Two of those - `receipt-one-slot` and
 * `slot-collision-suffixing` - are entries in `pnpm audit:mutations`, so they are re-checked rather
 * than recorded. See DEFECTS_FOUND.md section 37.
 *
 * An earlier version emptied `liftableBy` instead. That stopped working once the generator began
 * SELECTING rows by liftability: the control had no rows left to run on and reported zero by having
 * nothing to do, which is the "proves the search works by never running it" failure in its other
 * direction.
 */
const loosenedCeilings = () =>
  Object.fromEntries(
    Object.entries(CAPABILITY_POLICY).map(([k, row]) => [
      k,
      { ...row, roleCeilings: {}, defaultCeiling: "UNTRUSTED_EXTERNAL" },
    ]),
  ) as never;

describe("a search over receipt shapes", () => {
  const run = searchReceipts({ iterations: 12_000, seed: SEED });

  it("finds no property violation in the shipped engine", () => {
    expect(run.findings.length, `the search found violations:\n${formatFindings(run)}`).toBe(0);
  });

  it("never allows an action no valid receipt covers", () => {
    expect(run.findings.filter((f) => f.kind === "under_block")).toHaveLength(0);
  });

  it("never refuses on taint when every argument IS covered", () => {
    // The utility direction. Without it the `valid` shape contributes nothing and a policy that
    // refused every receipt would pass everything above.
    expect(run.findings.filter((f) => f.kind === "over_block")).toHaveLength(0);
  });

  it("reaches every receipt shape", () => {
    for (const shape of RECEIPT_SHAPES) {
      expect(run.shapes[shape] ?? 0, `shape ${shape} was never generated`).toBeGreaterThan(100);
    }
  });

  it("reaches ADMISSION, not only refusal", () => {
    // THE VACUITY FLOOR, and the first version of this search failed it silently. Every generated
    // receipt used `user_confirmed_value`; `web_fetch` lifts only by allowlist/selection/echo, so
    // nothing was ever admitted and the ALLOW path was never exercised. The run reported
    // "18,947 of 20,000 lacked a valid receipt", which reads like thorough coverage and was the
    // opposite of it. `cleanExplored` counts the refusal population, so admission is the remainder.
    // `cleanExplored` IS the admission count for this search: iterations where a receipt
    // genuinely admitted an over-ceiling argument. The first version floored the complement, which
    // also counted iterations where NO argument needed a receipt - honest only by accident of the
    // generator, and it passed at zero real admissions when the provenance list was made clean.
    // See DEFECTS_FOUND.md section 35.
    expect(
      run.cleanExplored,
      "no receipt was ever admitted - the search cannot see over-blocking",
    ).toBeGreaterThan(800);
  });

  it("the scope it claims is the scope the table computes", () => {
    // THE DRIFT THIS CATCHES ALREADY HAPPENED. `docs/LIMITATIONS.md` row 14 and the NOT COVERED block
    // in `pnpm adversary` both said the search ran on "four of the ten" rows and named `payment` and
    // `transaction_broadcast` among those never generated. Both are searched, and have been since
    // confirming rows were brought in. `receiptSearchScope` computed the right answer the whole time
    // and had ZERO callers, so nothing connected the function to the sentence.
    // See DEFECTS_FOUND.md section 37.
    const scope = receiptSearchScope();
    expect(scope.searched.length + scope.excluded.length).toBe(
      Object.keys(CAPABILITY_POLICY).length,
    );
    // RECOMPUTED HERE, not read back from a run. The first version of this assertion collected the
    // capabilities named by `findings` - and a clean run has no findings, so the loop walked an empty
    // set and asserted nothing. That is the empty-set walker this repository has now caught in four
    // separate places, including in the test written to catch a drift caused by an uncalled function.
    const liftable = Object.entries(CAPABILITY_POLICY)
      .filter(([, row]) => row.liftableBy.size > 0)
      .map(([name]) => name)
      .sort();
    expect([...scope.searched].sort()).toEqual(liftable);
    for (const row of scope.excluded) {
      expect(
        CAPABILITY_POLICY[row.row as keyof typeof CAPABILITY_POLICY].liftableBy.size,
        `${row.row} is excluded as lifting by nothing, but its row lifts by something`,
      ).toBe(0);
    }
    const limitations = readFileSync(join(REPO, "docs/LIMITATIONS.md"), "utf8");
    expect(
      limitations,
      "LIMITATIONS row 14 does not state the computed row count",
      // Spelled out, because the digit alone would match a dozen unrelated sentences.
    ).toContain("It runs on six of the ten capability rows");
    expect(scope.searched.length, "the computed count moved away from the sentence").toBe(6);
  });

  it("is deterministic, and a different seed explores a different space", () => {
    const a = searchReceipts({ iterations: 2_000, seed: SEED });
    const b = searchReceipts({ iterations: 2_000, seed: SEED });
    expect(a.shapes).toEqual(b.shapes);
    const other = searchReceipts({ iterations: 2_000, seed: 0x1234_5678 });
    expect(other.shapes).not.toEqual(a.shapes);
  });

  it("every finding carries the input that produced it", () => {
    // Checked on the control below rather than on a clean run, which has no findings to inspect.
    const control = searchReceipts({
      iterations: 500,
      seed: SEED,
      policy: loosenedCeilings(),
      oraclePolicy: CAPABILITY_POLICY,
    });
    // FLOORED, because the loop below runs zero times on an empty control and the test would pass
    // having asserted nothing - the same shape as an empty-set walker.
    expect(
      control.findings.length,
      "the control found nothing, so this asserts nothing",
    ).toBeGreaterThan(0);
    for (const f of control.findings.slice(0, 5)) {
      expect(f.input.action.capability).toBeDefined();
      expect(f.input.receipts).toBeDefined();
      expect(f.iteration).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("the receipt search can fail", () => {
  it("catches an engine whose ceilings were raised, judged against the shipped table", () => {
    const control = searchReceipts({
      iterations: 3_000,
      seed: SEED,
      policy: loosenedCeilings(),
      oraclePolicy: CAPABILITY_POLICY,
    });
    expect(
      control.findings.length,
      "a policy that admits untrusted values everywhere produced no finding - the search proves nothing",
    ).toBeGreaterThan(0);
  });

  it("refuses a partial oracle policy rather than judging the engine by its own table", () => {
    expect(() =>
      searchReceipts({
        iterations: 10,
        seed: SEED,
        policy: CAPABILITY_POLICY,
        oraclePolicy: { email_send: CAPABILITY_POLICY.email_send } as never,
      }),
    ).toThrow(/missing .* capability row/);
  });
});
