// The feedback-guided search, and the measurement that says it does not help.
//
// This file does NOT assert that guidance wins, because it does not. `compareGuidedToRandom` puts a
// feedback-free control on the same generator, seed and budget, and the two come out level:
// measured 0.94 to 1.17 across two seeds and three budgets. The engine's reachable behaviour space -
// ten capabilities, a dozen reason codes, no receipts in this generator - is small enough that random
// sampling saturates it inside a few thousand iterations, so there is nothing for a coverage signal
// to steer toward.
//
// What these tests pin is narrower and still worth pinning:
//
//   1. the loop is actually RUNNING - a corpus with entries, and mutations drawn from it. A refactor
//      that silently disables it would otherwise look identical, since the coverage is the same.
//   2. it does not HURT. Parity is the recorded result; a guided run that dropped well below the
//      random one would mean the mutation operators are destroying structure rather than exploring.
//   3. the property still holds on every input it reaches.
//
// See DEFECTS_FOUND.md section 41.

import { CAPABILITY_POLICY } from "@agent-context-containment/core";
import { describe, expect, it } from "vitest";
import { formatFindings } from "../src/adversary.js";
import { compareGuidedToRandom, searchGuided } from "../src/guided.js";

/** Fixed, so a failure in CI reproduces on a laptop with no further information. */
const SEED = 0x901d_ed00;

describe("a search that chooses its next input from the engine's answer", () => {
  const run = searchGuided({ iterations: 6_000, seed: SEED });

  it("finds no property violation in the shipped engine", () => {
    expect(run.findings.length, `the search found violations:\n${formatFindings(run)}`).toBe(0);
  });

  it("never allows an argument above its ceiling, by its own walk", () => {
    expect(run.findings.filter((f) => f.kind === "under_block")).toHaveLength(0);
  });

  it("the feedback loop is actually running", () => {
    // THE ONE THING THAT WOULD OTHERWISE BE INVISIBLE. Coverage is the same with the loop off, so a
    // refactor that broke it would change no number anybody looks at.
    expect(run.corpusSize, "the corpus is empty - nothing was ever kept").toBeGreaterThan(0);
    expect(
      run.mutated,
      "no iteration was a mutation of a kept input - the loop is not feeding back",
    ).toBeGreaterThan(run.explored / 4);
  });

  it("reaches a behaviour space wider than one capability's worth", () => {
    // A floor on the coverage metric itself. If this collapses, the signature has stopped
    // distinguishing rows and the comparison below stops meaning anything - which is exactly what
    // the first version of the signature did.
    expect(run.signatures, "the coverage metric has collapsed").toBeGreaterThan(20);
  });

  it("does not do WORSE than generating at random", () => {
    // NOT A CLAIM THAT IT WINS. Parity is the measured result and it is recorded in the source and
    // in section 41. This floors only that the mutation operators are not destroying structure: a
    // guided run well below the random one would mean the corpus is being walked into a dead end.
    const c = compareGuidedToRandom({ iterations: 4_000, seed: SEED });
    expect(c.random, "the control reached nothing, so the ratio is meaningless").toBeGreaterThan(
      20,
    );
    expect(
      c.ratio,
      `guided coverage fell well below random (${c.guided} vs ${c.random}) - the mutation operators are destroying structure rather than exploring`,
    ).toBeGreaterThan(0.85);
  });

  it("the control really is feedback-free, and not just the same run twice", () => {
    // The near-miss: if `noFeedback` did nothing, the comparison above would be a run against itself
    // and would pass at a ratio of exactly 1 forever.
    const off = searchGuided({ iterations: 2_000, seed: SEED, noFeedback: true });
    expect(
      off.corpusSize,
      "the control kept a corpus - noFeedback is not switching the loop off",
    ).toBe(0);
    expect(off.mutated, "the control mutated - noFeedback is not switching the loop off").toBe(0);
  });

  it("is deterministic, and a different seed explores a different space", () => {
    const a = searchGuided({ iterations: 1_500, seed: SEED });
    const b = searchGuided({ iterations: 1_500, seed: SEED });
    expect(a.signatures).toBe(b.signatures);
    expect(a.shapes).toEqual(b.shapes);
    const other = searchGuided({ iterations: 1_500, seed: 0x1234_5678 });
    expect(other.shapes).not.toEqual(a.shapes);
  });
});

describe("the guided search can fail", () => {
  /** Every ceiling raised. Judged against the SHIPPED table, or it is a tautology. */
  const loosened = () =>
    Object.fromEntries(
      Object.entries(CAPABILITY_POLICY).map(([k, row]) => [
        k,
        {
          ...row,
          defaultCeiling: "UNTRUSTED_EXTERNAL",
          roleCeilings: Object.fromEntries(
            Object.keys(row.roleCeilings).map((r) => [r, "UNTRUSTED_EXTERNAL"]),
          ),
        },
      ]),
    ) as never;

  it("catches an engine whose ceilings were raised, judged against the shipped table", () => {
    const control = searchGuided({
      iterations: 3_000,
      seed: SEED,
      policy: loosened(),
      oraclePolicy: CAPABILITY_POLICY,
    });
    expect(
      control.findings.length,
      "a policy that admits untrusted values everywhere produced no finding - the property proves nothing",
    ).toBeGreaterThan(0);
    expect(control.findings.filter((f) => f.kind === "under_block").length).toBeGreaterThan(0);
  });

  it("and reports nothing when that same engine is judged by its own table", () => {
    // THE NEAR-MISS, and the reason `oraclePolicy` exists at all. Without it the oracle reads its
    // ceilings off the row the engine just loosened, both move together, and the control above
    // becomes a run agreeing with itself. The first version of this file had no such parameter.
    const tautology = searchGuided({ iterations: 3_000, seed: SEED, policy: loosened() });
    expect(tautology.findings).toHaveLength(0);
  });

  it("refuses a partial oracle policy rather than judging those rows by the engine's own table", () => {
    expect(() =>
      searchGuided({
        iterations: 10,
        seed: SEED,
        policy: CAPABILITY_POLICY,
        oraclePolicy: { email_send: CAPABILITY_POLICY.email_send } as never,
      }),
    ).toThrow(/missing .* capability row/);
  });
});
