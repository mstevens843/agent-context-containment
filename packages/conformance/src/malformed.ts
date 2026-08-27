// A second search, over inputs that are not well formed.
//
// WHY IT IS A SEPARATE FILE. `searchAdversarially` in adversary.ts only ever emits VALID
// `DecisionInput`s, so the defect in section 24 - `decide` throwing on `null`, on a missing
// `action`, on a non-array `sources`, on a chain ten thousand deep - was outside the space it
// explores. It reported zero findings against that mutation not because the engine was sound but
// because the search never asked, and the file's header claimed the coverage anyway. That is
// section 31. A property search that cannot reach a defect must not be cited as covering it, so
// this reaches it instead, and the split into two files is what keeps the two claims apart.
//
// TWO PROPERTIES, and the second is the one that matters:
//
//   never_throws  `decide` returns a verdict for every input. A policy engine that throws is one
//                 whose caller writes a try/catch, and that catch block is the bypass - the comment
//                 above `decide` says exactly this, and it was false when it was written.
//   under_block   a malformed request is never ALLOWed. Not throwing is worthless on its own: an
//                 engine that answers "yes" to an unparseable request has satisfied "never throws"
//                 and removed containment.
//
// THE GENERATOR MOSTLY MUTATES, AND SOMETIMES ENUMERATES. Four of its six shapes start from a
// well-formed request and break one field or several, which reaches combinations nobody wrote down.
// The other two - `not_an_object` and `action_junk` - take the whole input, or its `action`, straight
// from the fixed JUNK list, and every broken field VALUE in every shape is drawn from that list too.
// About six per cent of what it emits is enumerated rather than mutated. The first version of this
// comment claimed the distinction cleanly and did not hold for two of its own shapes.

import {
  CAPABILITY_POLICY,
  type CapabilityPolicy,
  type DecisionInput,
  decide,
} from "@agent-context-containment/core";
import type { AdversaryFinding, AdversaryResult } from "./adversary.js";

/**
 * A seeded generator, duplicated from adversary.ts rather than shared.
 *
 * Six lines, and sharing them would make this module depend on that one for the only thing that
 * makes a failure here reproducible. Determinism is the property; a shared helper is not worth a
 * coupling that could change under it.
 */
const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
};

/** Values that are not what the field's type says, including several that look nearly right. */
const JUNK: readonly unknown[] = [
  null,
  undefined,
  0,
  -1,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  "",
  "  ",
  "not-a-thing",
  true,
  false,
  [],
  {},
  [null],
  [{}],
  { id: null },
  () => 0,
  new Map(),
];

/** Roles: the five real ones, a misspelling, and things that are not strings at all. */
const ROLES: readonly unknown[] = [
  "sink_identity",
  "magnitude",
  "selector",
  "payload",
  "control",
  "sink_identiy",
  "",
  null,
  42,
];

/**
 * AN INDEPENDENT VALIDITY ORACLE, and the reason the property needed one.
 *
 * The first version of this search asserted "nothing this generator emits may be ALLOWed", which is
 * wrong and produced 793 false findings on the first run: a twelve-thousand-node chain of SYSTEM
 * sources is perfectly well formed, and so is a request whose only mutation happened to land on a
 * field that was already optional. The generator emits BROKEN and INTACT inputs; only the broken
 * ones carry the property.
 *
 * So validity is decided here, structurally, WITHOUT calling `decide` or importing the engine's
 * `structuralFault`. Two implementations of the same rule, and a disagreement is the finding - the
 * same arrangement as the taint oracle in adversary.ts and for the same reason. It is also what
 * caught section 32: this checks the ELEMENTS of `receipts`, and the engine's gate did not.
 */
const looksMalformed = (input: unknown): boolean => {
  if (typeof input !== "object" || input === null) return true;
  const i = input as Record<string, unknown>;
  const action = i.action;
  if (typeof action !== "object" || action === null) return true;
  const a = action as Record<string, unknown>;
  if (!Array.isArray(a.args)) return true;
  for (const arg of a.args) {
    if (typeof arg !== "object" || arg === null) return true;
    const g = arg as Record<string, unknown>;
    if (g.derivedFrom !== undefined && !Array.isArray(g.derivedFrom)) return true;
  }
  if (!Array.isArray(i.sources)) return true;
  for (const src of i.sources) {
    if (typeof src !== "object" || src === null) return true;
    const s = src as Record<string, unknown>;
    if (s.derivedFrom !== undefined && !Array.isArray(s.derivedFrom)) return true;
  }
  if (i.receipts !== undefined) {
    if (!Array.isArray(i.receipts)) return true;
    for (const r of i.receipts) if (typeof r !== "object" || r === null) return true;
  }
  return false;
};

/** The shapes of brokenness, named so a degenerate run is legible in the report. */
export const MALFORMED_SHAPES = [
  "mutated_fields",
  "no_action",
  "no_sources",
  "not_an_object",
  "action_junk",
  "deep_chain",
] as const;

export function searchMalformed(opts: {
  readonly iterations: number;
  readonly seed?: number;
  readonly policy?: CapabilityPolicy;
}): AdversaryResult {
  const policy = opts.policy ?? CAPABILITY_POLICY;
  const next = rng(opts.seed ?? 0x0bad_bad0);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
  const capabilities: readonly unknown[] = [...Object.keys(policy), "not_a_capability", "", null];

  const findings: AdversaryFinding[] = [];
  const shapes: Record<string, number> = {};
  let cleanExplored = 0;

  for (let i = 0; i < opts.iterations; i++) {
    const argCount = 1 + Math.floor(next() * 3);
    const args: unknown[] = [];
    for (let a = 0; a < argCount; a++) {
      args.push({
        name: next() < 0.15 ? pick(JUNK) : `arg${a}`,
        role: pick(ROLES),
        value: next() < 0.15 ? pick(JUNK) : `v${a}`,
        derivedFrom: next() < 0.3 ? pick(JUNK) : [`s${a}`],
      });
    }
    const sources: unknown[] = [];
    for (let a = 0; a < argCount; a++) {
      sources.push({
        id: next() < 0.15 ? pick(JUNK) : `s${a}`,
        provenance: next() < 0.3 ? pick(JUNK) : "WEB",
        ...(next() < 0.4 ? { derivedFrom: next() < 0.5 ? pick(JUNK) : [`s${a}`] } : {}),
      });
    }

    let shape: string =
      next() < 0.12
        ? pick(["no_action", "no_sources", "not_an_object", "action_junk"])
        : "mutated_fields";

    // DEPTH IS A SHAPE. Section 24 was two defects wearing one name: malformed values, and a chain
    // deep enough to exhaust the stack. The graph search caps its chains at a handful of nodes, so
    // only this reaches the second one.
    if (next() < 0.04) {
      const depth = 12_000;
      sources.length = 0;
      sources.push({ id: "d0", provenance: "SYSTEM" });
      for (let d = 1; d <= depth; d++) {
        sources.push({ id: `d${d}`, provenance: "SYSTEM", derivedFrom: [`d${d - 1}`] });
      }
      args.length = 0;
      args.push({ name: "deep", role: "sink_identity", value: "x", derivedFrom: [`d${depth}`] });
      shape = "deep_chain";
    }
    shapes[shape] = (shapes[shape] ?? 0) + 1;

    let input: unknown;
    switch (shape) {
      case "not_an_object":
        input = pick(JUNK);
        break;
      case "no_action":
        input = { sources, receipts: [] };
        break;
      case "no_sources":
        input = { action: { id: "a", tool: "t", capability: pick(capabilities), args } };
        break;
      case "action_junk":
        input = { action: pick(JUNK), sources, receipts: pick(JUNK) };
        break;
      default:
        input = {
          action: {
            id: next() < 0.1 ? pick(JUNK) : `mal-${i}`,
            tool: next() < 0.1 ? pick(JUNK) : `tool-${i}`,
            capability: pick(capabilities),
            args: next() < 0.1 ? pick(JUNK) : args,
          },
          sources: next() < 0.12 ? pick(JUNK) : sources,
          receipts: next() < 0.12 ? pick(JUNK) : [],
        };
    }

    let decision: string;
    try {
      decision = decide(input as DecisionInput, policy).decision;
    } catch (e) {
      findings.push({
        kind: "never_throws",
        iteration: i,
        capability: shape,
        detail: `decide threw ${(e as Error).name}: ${String((e as Error).message).slice(0, 120)}`,
        input: input as DecisionInput,
      });
      continue;
    }

    // Only inputs the INDEPENDENT oracle calls broken carry this property. An intact request
    // reaching ALLOW is the engine working, not a finding.
    if (looksMalformed(input)) {
      cleanExplored++;
      if (decision === "ALLOW") {
        findings.push({
          kind: "under_block",
          iteration: i,
          capability: shape,
          detail: `an input this module reads as malformed was ALLOWed (shape ${shape})`,
          input: input as DecisionInput,
        });
      }
    }
  }

  return { explored: opts.iterations, findings, cleanExplored, shapes };
}
