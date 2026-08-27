// The malformed-input search, and the controls that stop it being a green light nobody earned.
//
// This file exists because of section 31. `adversary.ts` claimed to cover section 24 - `decide`
// throwing on malformed input - and could not: its generator only ever emits valid `DecisionInput`s,
// so it reported zero findings against that mutation not because the engine was sound but because
// the search never asked. A search that cannot reach a defect must not be cited as covering it.
//
// It found section 32 on its first run: `receipts: [null]` walked past the structural gate, because
// the gate checked `Array.isArray(receipts)` and never looked at the elements. That is a defect in
// the gate written to make the engine total.
//
// THE CONTROLS MATTER MORE THAN THE PASS:
//
//   1. the run must reach every malformed shape, and a floor on each is asserted
//   2. it must reach genuinely malformed inputs, judged by an oracle written here rather than by
//      asking the engine - otherwise the property is satisfied by inputs that are simply valid
//   3. the mutation audit reintroduces sections 24 and 32 and this file must go red

import { describe, expect, it } from "vitest";
import { formatFindings } from "../src/adversary.js";
import { MALFORMED_SHAPES, searchMalformed } from "../src/malformed.js";

/** Fixed, so a failure in CI reproduces on a laptop with no further information. */
const SEED = 0x0bad_bad0;

describe("a search over inputs that are not well formed", () => {
  const run = searchMalformed({ iterations: 12_000, seed: SEED });

  it("finds no property violation in the shipped engine", () => {
    expect(run.findings.length, `the search found violations:\n${formatFindings(run)}`).toBe(0);
  });

  it("decide never throws, on any shape the generator produced", () => {
    // Stated separately from the line above so that a future finding of a different KIND cannot
    // quietly satisfy this one. The engine's own comment says a throw here puts a bypass in
    // somebody's catch block; that sentence was false when it was written.
    expect(run.findings.filter((f) => f.kind === "never_throws")).toHaveLength(0);
  });

  it("no input this module reads as malformed was ALLOWed", () => {
    expect(run.findings.filter((f) => f.kind === "under_block")).toHaveLength(0);
  });

  it("actually reached malformed inputs, rather than passing over valid ones", () => {
    // THE EMPTY-SET FLOOR, and it is not decoration. The first version of this property asserted
    // that nothing the generator emitted could be ALLOWed, which produced 793 false findings: a
    // twelve-thousand-node chain of SYSTEM sources is perfectly well formed. Only inputs an
    // independent oracle calls broken carry the property, so the count of those is what must be
    // floored - a run where nothing was malformed would pass every assertion above.
    expect(
      run.cleanExplored,
      "no genuinely malformed input was explored - the properties above are vacuous",
    ).toBeGreaterThan(2_000);
  });

  it("reaches every named shape, including the deep chain", () => {
    for (const shape of MALFORMED_SHAPES) {
      expect(run.shapes[shape] ?? 0, `shape ${shape} was never generated`).toBeGreaterThan(20);
    }
  });

  it("is deterministic, and a different seed explores a different space", () => {
    const a = searchMalformed({ iterations: 2_000, seed: SEED });
    const b = searchMalformed({ iterations: 2_000, seed: SEED });
    expect(a.shapes).toEqual(b.shapes);
    const other = searchMalformed({ iterations: 2_000, seed: 0x1234_5678 });
    expect(other.shapes).not.toEqual(a.shapes);
  });
});
