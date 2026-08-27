// The search, and the controls that stop it being a green light nobody earned.
//
// Every other suite in this repository checks an EXPECTED ANSWER against a case somebody wrote. This
// one checks a PROPERTY against structures nobody wrote, and the difference is the whole reason it
// exists: `docs/LIMITATIONS.md` has said since v0.6 that nobody iterates against the engine, and
// three defects found by an outside reader in v1.0.1 were all in shapes no case and no test had ever
// declared.
//
// THE CONTROLS MATTER MORE THAN THE PASS. A search reporting zero findings is indistinguishable from
// a search that explores nothing, which is defect section 19 in a new costume. So:
//
//   1. the run must actually reach every graph shape, and a floor on each is asserted
//   2. an engine on a LOOSENED table, judged against the shipped one, must produce under-blocks
//   3. the mutation audit re-introduces defect section 23 and this file must go red - that entry is
//      `dag-path-scoped` in scripts/audit-mutations.mjs, and it names this file
//
// Point 3 is the one worth stating plainly: with the diamond defect put back, the search finds it in
// the hundreds within a few thousand iterations. It would have caught a defect that every gate in
// this repository missed, which is the argument for property search over case enumeration, made
// concretely rather than in the abstract.

import { CAPABILITY_POLICY } from "@agent-context-containment/core";
import { describe, expect, it } from "vitest";
import { formatFindings, loosenedPolicy, searchAdversarially } from "../src/adversary.js";

/** Fixed, so a failure in CI reproduces on a laptop with no further information. */
const SEED = 0xc0ffee;

describe("an automated search over the decision space", () => {
  const run = searchAdversarially({ iterations: 8_000, seed: SEED });

  it("finds no property violation in the shipped engine", () => {
    expect(run.findings.length, `the search found violations:\n${formatFindings(run)}`).toBe(0);
  });

  it("actually explored, rather than reporting a clean run over nothing", () => {
    // The empty-set floor. A generator that degenerated to one shape would still report zero
    // findings, and zero findings over nothing is the shape of every defect in DEFECTS_FOUND.md.
    expect(run.explored).toBe(8_000);
    for (const shape of [
      "chain",
      "diamond",
      "stacked_diamond",
      "cycle",
      "dangling",
      "fan_in",
      "flat",
    ]) {
      expect(run.shapes[shape] ?? 0, `shape ${shape} was never generated`).toBeGreaterThan(100);
    }
  });

  it("reaches fully clean graphs, where a spurious refusal would show", () => {
    // Without this, the taint-agreement property could be satisfied entirely by graphs that are
    // untrusted anyway - and the over-refusal half of section 23 would be unreachable.
    expect(run.cleanExplored, "no fully clean decision was explored").toBeGreaterThan(500);
  });

  it("is deterministic: the same seed explores the same space", () => {
    const again = searchAdversarially({ iterations: 2_000, seed: SEED });
    const once = searchAdversarially({ iterations: 2_000, seed: SEED });
    expect(again.shapes).toEqual(once.shapes);
    expect(again.findings.length).toBe(once.findings.length);
  });

  it("a different seed explores a different space", () => {
    // Otherwise the seed is decorative and one run is all the coverage there will ever be.
    const other = searchAdversarially({ iterations: 2_000, seed: 0x1234_5678 });
    const base = searchAdversarially({ iterations: 2_000, seed: SEED });
    expect(other.shapes).not.toEqual(base.shapes);
  });
});

describe("the search can fail", () => {
  it("catches an engine whose ceilings were raised, judged against the shipped table", () => {
    // THE NEGATIVE CONTROL. Note the two tables: the engine runs on the loosened one and the result
    // is judged against the shipped one. Judging it against its own loosened table is a tautology -
    // raise every ceiling to the top of the lattice and nothing can exceed one - and the first
    // version of this control did exactly that and reported a clean run on an engine that permitted
    // everything. That is the failure mode this file is supposed to be immune to, met on the way in.
    const control = searchAdversarially({
      iterations: 3_000,
      seed: SEED,
      policy: loosenedPolicy(),
      oraclePolicy: CAPABILITY_POLICY,
    });
    expect(
      control.findings.length,
      "a policy that permits untrusted values everywhere produced no finding - the search proves nothing",
    ).toBeGreaterThan(0);
    expect(control.findings.every((f) => f.kind === "under_block")).toBe(true);
  });

  it("every finding carries the input that produced it", () => {
    // A finding nobody can replay is a bug report without a reproduction.
    const control = searchAdversarially({
      iterations: 1_000,
      seed: SEED,
      policy: loosenedPolicy(),
      oraclePolicy: CAPABILITY_POLICY,
    });
    for (const f of control.findings.slice(0, 5)) {
      expect(f.input.action.capability).toBeDefined();
      expect(f.input.sources.length).toBeGreaterThan(0);
      expect(f.iteration).toBeGreaterThanOrEqual(0);
    }
  });
});
