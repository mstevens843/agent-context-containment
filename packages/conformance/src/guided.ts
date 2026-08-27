// A search that READS THE ENGINE'S ANSWER AND CHOOSES ITS NEXT INPUT FROM IT.
//
// WHAT WAS TRUE BEFORE THIS FILE. `docs/LIMITATIONS.md` row 10 said of the three existing searches:
// "it does not learn and does not read the engine to choose its next move". That was accurate. All
// three draw from a fixed shape vocabulary, judge the result, and throw it away - iteration 9,000 is
// generated exactly as iteration 1 was, however interesting iteration 8,999 turned out to be.
//
// This one keeps a corpus. Every decision is reduced to a SIGNATURE - the decision plus the sorted
// set of reason codes - and an input whose signature has never been seen is kept and mutated later.
// That is coverage-guided fuzzing, the shape AFL made ordinary, applied to a policy engine.
//
// WHAT IT IS NOT, and the row must keep saying so:
//
//   - it is NOT a model, and it has no goal. It cannot decide that payments look interesting and
//     concentrate there. It maximises reason-code novelty, which is a proxy chosen by the author.
//   - the MUTATION OPERATORS are still mine: swap a role, swap a provenance, add an edge, toggle
//     confirmation. An attacker who thought of an operator that is not in that list is still outside
//     the space, exactly as before.
//   - it shares the lattice and the capability table with the engine, like the other three.
//
// So "does not read the engine to choose its next move" stops being true and "not an adaptive
// attacker" stays true. Those are different sentences and row 10 now says both.
//
// AND IT DOES NOT OUTPERFORM RANDOM GENERATION. That is the measurement, and it is the point of
// shipping this rather than a reason to hide it.
//
//   budget    guided   random   ratio
//    1,000     30-35    30-32   0.94 - 1.17
//    4,000     37-39    35-37   1.00 - 1.11
//   12,000        39       38          1.03
//
// Two seeds each, `compareGuidedToRandom`. The loop runs - 8,365 of 12,000 iterations are mutations
// of kept inputs - and it buys nothing measurable. The reason is a property of the engine rather than
// a defect in the search: a total, table-driven policy over ten capabilities has a SMALL reachable
// behaviour space, and random generation saturates it inside a few thousand iterations. There is
// nothing left for guidance to steer toward.
//
// The first version was worse and for a duller reason: its coverage point ignored WHICH capability
// produced the outcome, leaving about eleven signatures in total. Naming the row is the correct
// granularity, not a thumb on the scale, and it roughly quadrupled the space without changing the
// conclusion.
//
// So this file ships as an INSTRUMENT and a recorded negative result. It also explores a different
// distribution from the graph search - diamonds and cycles arise here by edge mutation rather than
// from a named shape list - which is worth having on its own. The tests floor that the loop is
// actually running and that it does not HURT; none of them asserts it wins, because it does not.
// See DEFECTS_FOUND.md section 41.

import {
  CAPABILITY_POLICY,
  type Capability,
  type CapabilityPolicy,
  type CapabilityRow,
  type DecisionInput,
  type ParamRole,
  type Provenance,
  type Taint,
  decide,
  joinTaint,
  taintOf,
} from "@agent-context-containment/core";
import type { AdversaryFinding, AdversaryResult } from "./adversary.js";

const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
};

const RANK: Readonly<Record<string, number>> = {
  CLEAN: 0,
  USER_CONTROLLED: 1,
  TOOL_DERIVED: 2,
  UNTRUSTED_EXTERNAL: 3,
};

const STEERING = new Set(["sink_identity", "magnitude", "control"]);
const KNOWN = new Set(["sink_identity", "magnitude", "selector", "payload", "control"]);

/** The ceiling rule, restated rather than imported, so a wrong rule cannot move both sides. */
const oracleCeiling = (row: CapabilityRow, role: string): Taint => {
  const explicit = (row.roleCeilings as Readonly<Record<string, Taint>>)[role];
  if (explicit !== undefined) return explicit;
  if (!KNOWN.has(role)) return "CLEAN";
  if (!STEERING.has(role)) return row.defaultCeiling;
  return (RANK[row.defaultCeiling] ?? 3) <= 1 ? row.defaultCeiling : "USER_CONTROLLED";
};

const ROLES: readonly ParamRole[] = [
  "sink_identity",
  "magnitude",
  "selector",
  "payload",
  "control",
];
// EVERY provenance the lattice defines, so the search is not quietly narrowed to the ones the author
// finds interesting. `TOOL_RESULT` was in this list and is not a Provenance at all - the type caught
// it, which a plain string array would not have.
const PROVENANCES: readonly Provenance[] = [
  "SYSTEM",
  "USER",
  "RETRIEVED",
  "WEB",
  "EMAIL",
  "DOCUMENT",
  "EXTERNAL_API",
  "TOOL_OUTPUT",
];

/** A candidate, kept in a form that is cheap to mutate. */
interface Candidate {
  readonly capability: Capability;
  readonly confirmed: boolean;
  /** One entry per argument: its role, and the index of the source it derives from. */
  readonly args: readonly { readonly role: ParamRole; readonly from: number }[];
  /** One entry per source: its provenance, and the indices it derives from. */
  readonly sources: readonly {
    readonly provenance: Provenance;
    readonly from: readonly number[];
  }[];
}

const toInput = (c: Candidate, id: number): DecisionInput =>
  ({
    action: {
      id: `g-${id}`,
      capability: c.capability,
      tool: `tool-${id}`,
      args: c.args.map((a, i) => ({
        name: `arg${i}`,
        role: a.role,
        value: `v${i}`,
        path: `arg${i}`,
        derivedFrom: [`s${a.from}`],
      })),
    },
    sources: c.sources.map((s, i) => ({
      id: `s${i}`,
      provenance: s.provenance,
      ...(s.from.length > 0 ? { derivedFrom: s.from.map((f) => `s${f}`) } : {}),
    })),
    receipts: [],
    confirmed: c.confirmed,
  }) as unknown as DecisionInput;

/**
 * THE TAINT ORACLE, walked here rather than asked of the engine.
 *
 * Path-scoped, like the one in adversary.ts and for the same reason: a source reached by two paths
 * must not accumulate a seen-set across siblings, which is defect section 23.
 */
const oracleTaint = (c: Candidate, start: number): Taint => {
  const walk = (i: number, onPath: ReadonlySet<number>): Taint => {
    const s = c.sources[i];
    if (s === undefined || onPath.has(i)) return "CLEAN";
    const here = taintOf(s.provenance);
    const next = new Set(onPath).add(i);
    let acc: Taint = here;
    for (const f of s.from) acc = joinTaint(acc, walk(f, next));
    return acc;
  };
  return walk(start, new Set());
};

/**
 * Capability, decision, and sorted reason codes: what "somewhere new" means for this search.
 *
 * THE CAPABILITY IS PART OF THE COVERAGE POINT, and leaving it out is what made the first version of
 * this search pointless. `DENY|taint_exceeds_ceiling` on `payment` and on `web_fetch` are different
 * behaviours of different rows, and collapsing them left about eleven reachable signatures in total -
 * a space random generation saturates inside a thousand iterations, so there was nothing for feedback
 * to steer toward. Measured before the change: guided 11, random 11. See DEFECTS_FOUND.md section 41.
 */
const signatureOf = (
  capability: string,
  v: { decision: string; reasons: readonly { code: string }[] },
): string =>
  `${capability}|${v.decision}|${[...new Set(v.reasons.map((r) => r.code))].sort().join(",")}`;

export interface GuidedResult extends AdversaryResult {
  /** Distinct decision+reason-code signatures reached. The coverage number. */
  readonly signatures: number;
  /** How many inputs the feedback loop kept. Zero means the loop did nothing. */
  readonly corpusSize: number;
  /** Iterations that were mutations of a kept input rather than fresh random ones. */
  readonly mutated: number;
}

export function searchGuided(opts: {
  readonly iterations: number;
  readonly seed?: number;
  readonly policy?: CapabilityPolicy;
  /**
   * Turn the feedback OFF, for the control. Everything else - generator, oracle, budget, seed - is
   * identical, so a difference in coverage is attributable to the loop and to nothing else.
   */
  readonly noFeedback?: boolean;
  /**
   * Judged against this table, for the same reason `searchAdversarially` takes one.
   *
   * Without it a loosened-policy control is a TAUTOLOGY: the oracle reads its ceilings off the same
   * row the engine does, so both move together and the control reports zero by agreeing with itself.
   * The first version of this file had no such parameter and its "control" asserted nothing at all.
   */
  readonly oraclePolicy?: CapabilityPolicy;
}): GuidedResult {
  const policy = opts.policy ?? CAPABILITY_POLICY;
  const oraclePolicy = opts.oraclePolicy ?? policy;
  if (opts.oraclePolicy !== undefined) {
    const missing = Object.keys(policy).filter((c) => oraclePolicy[c as Capability] === undefined);
    if (missing.length > 0) {
      throw new Error(
        `searchGuided: the oracle policy is missing ${missing.length} capability row(s) (${missing.join(", ")}). A partial table would judge those rows against the engine's own policy.`,
      );
    }
  }
  const next = rng(opts.seed ?? 0x901d_ed00);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
  const capabilities = Object.keys(policy) as Capability[];

  const fresh = (): Candidate => {
    const nSources = 1 + Math.floor(next() * 4);
    const sources = Array.from({ length: nSources }, (_, i) => ({
      provenance: pick(PROVENANCES),
      from: i > 0 && next() < 0.5 ? [Math.floor(next() * i)] : [],
    }));
    const nArgs = 1 + Math.floor(next() * 3);
    return {
      capability: pick(capabilities),
      confirmed: next() < 0.5,
      args: Array.from({ length: nArgs }, () => ({
        role: pick(ROLES),
        from: Math.floor(next() * nSources),
      })),
      sources,
    };
  };

  /** One small change. The operators are the search's vocabulary and they are all listed here. */
  const mutate = (c: Candidate): Candidate => {
    switch (Math.floor(next() * 6)) {
      case 0:
        return { ...c, capability: pick(capabilities) };
      case 1:
        return { ...c, confirmed: !c.confirmed };
      case 2: {
        const i = Math.floor(next() * c.args.length);
        return {
          ...c,
          args: c.args.map((a, j) => (j === i ? { ...a, role: pick(ROLES) } : a)),
        };
      }
      case 3: {
        const i = Math.floor(next() * c.sources.length);
        return {
          ...c,
          sources: c.sources.map((s, j) => (j === i ? { ...s, provenance: pick(PROVENANCES) } : s)),
        };
      }
      case 4: {
        // Add an edge, which is how diamonds and cycles appear without being named as shapes.
        const i = Math.floor(next() * c.sources.length);
        const target = Math.floor(next() * c.sources.length);
        return {
          ...c,
          sources: c.sources.map((s, j) =>
            j === i ? { ...s, from: [...new Set([...s.from, target])] } : s,
          ),
        };
      }
      default: {
        const i = Math.floor(next() * c.args.length);
        return {
          ...c,
          args: c.args.map((a, j) =>
            j === i ? { ...a, from: Math.floor(next() * c.sources.length) } : a,
          ),
        };
      }
    }
  };

  const findings: AdversaryFinding[] = [];
  const shapes: Record<string, number> = {};
  const seen = new Set<string>();
  const corpus: Candidate[] = [];
  let mutated = 0;
  let cleanExplored = 0;

  for (let i = 0; i < opts.iterations; i++) {
    const useCorpus = !opts.noFeedback && corpus.length > 0 && next() < 0.7;
    const candidate = useCorpus ? mutate(pick(corpus)) : fresh();
    if (useCorpus) mutated++;
    shapes[useCorpus ? "mutated" : "fresh"] = (shapes[useCorpus ? "mutated" : "fresh"] ?? 0) + 1;

    const input = toInput(candidate, i);
    let verdict: ReturnType<typeof decide>;
    try {
      verdict = decide(input, policy);
    } catch (e) {
      findings.push({
        kind: "never_throws",
        iteration: i,
        capability: candidate.capability,
        detail: `decide threw ${(e as Error).name}: ${String((e as Error).message).slice(0, 120)}`,
        input,
      });
      continue;
    }

    const sig = signatureOf(candidate.capability, verdict);
    if (!seen.has(sig)) {
      seen.add(sig);
      // THE LOOP. A novel signature is what makes an input worth keeping, and the cap stops one
      // long run from turning the corpus into a memory leak.
      if (!opts.noFeedback && corpus.length < 512) corpus.push(candidate);
    }

    // ---- the property, judged by the oracle above and never by asking the engine ---------------
    const row = oraclePolicy[candidate.capability] as CapabilityRow;
    let worstOver = false;
    let allClean = true;
    for (const a of candidate.args) {
      const t = oracleTaint(candidate, a.from);
      if (t !== "CLEAN") allClean = false;
      if ((RANK[t] ?? 3) > (RANK[oracleCeiling(row, a.role)] ?? 0)) worstOver = true;
    }
    if (allClean) cleanExplored++;

    if (verdict.decision === "ALLOW" && worstOver) {
      findings.push({
        kind: "under_block",
        iteration: i,
        capability: candidate.capability,
        detail: "ALLOWed with an argument above its ceiling, by this module's own walk",
        input,
      });
    }
  }

  return {
    explored: opts.iterations,
    findings,
    cleanExplored,
    shapes,
    signatures: seen.size,
    corpusSize: corpus.length,
    mutated,
  };
}

/**
 * Run the guided search and a feedback-free control at the same budget, and report both.
 *
 * THE HONEST COMPARISON. Same generator, same seed, same iteration count, same oracle; the only
 * difference is whether a novel signature is kept and mutated. If guided coverage is not higher, the
 * loop is decoration and this function is what says so.
 */
export const compareGuidedToRandom = (opts: {
  readonly iterations: number;
  readonly seed?: number;
}): {
  readonly guided: number;
  readonly random: number;
  readonly ratio: number;
} => {
  const guided = searchGuided(opts);
  const random = searchGuided({ ...opts, noFeedback: true });
  return {
    guided: guided.signatures,
    random: random.signatures,
    ratio: random.signatures === 0 ? 0 : guided.signatures / random.signatures,
  };
};
