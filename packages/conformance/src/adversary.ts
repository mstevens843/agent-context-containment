// A search that iterates against the engine, rather than a list of attacks somebody wrote down.
//
// WHY THIS IS NOT `planner.ts` OR `generate.ts`. Both of those ENUMERATE STRUCTURES I DESCRIBED:
// six plan shapes crossed with every capability, or every transform applied to every base case. They
// reach combinations I would not have bothered to write out, which is worth something, but the
// shapes are still mine. LIMITATIONS.md has said since v0.6 that there is no real adaptive attacker
// here and that nobody iterates against the engine. This does not produce an adaptive attacker -
// nothing written by one author does - but it is the first thing in the repository that explores
// shapes NOBODY described and checks a property rather than an expected answer.
//
// THE ORACLE IS INDEPENDENT OF THE WALK, WHICH IS NARROWER THAN INDEPENDENT. `expectedTaint` below
// re-derives the join from the declared graph with its own traversal, and it does NOT call the
// engine's `resolveTaint` - a search that asks the engine whether it agrees with itself finds
// nothing. But it imports `taintOf` and `joinTaint` from the same module the engine uses, so a wrong
// entry in `PROVENANCE_TAINT` or `TAINT_RANK` moves BOTH SIDES and is invisible here. What is
// duplicated is the graph walk, not the lattice. Say "walk", never "specification".
//
// THREE PROPERTIES, TWO OF THEM LIVE HERE. Measured, not assumed - each mutation in
// scripts/audit-mutations.mjs was reintroduced and both searches re-run at 8,000 iterations:
//
//   taint_mismatch  the engine's join must EQUAL the oracle's. Section 23: every node clean, verdict
//                   NEEDS_DECLASSIFICATION, because two paths reconverged. CATCHES IT - 1,386
//                   findings.
//   under_block     no ALLOW above the row's ceiling, where the ceiling is derived by `oracleCeiling`
//                   below and NOT by `ceilingFor`. Section 25: a misspelled role collected the
//                   loosest ceiling on the row. CATCHES IT - 2,564 findings.
//
//                   It did not, until the ceiling oracle was written. The first version imported
//                   `ceilingFor` from core - the same function `decide` uses - so a bug inside it
//                   moved both sides of the comparison and the property reported zero. An oracle
//                   that shares the function under test is not an oracle. See section 31.
//   never_throws    `decide` answers every input. Section 24. CATCHES NOTHING HERE, and cannot:
//                   `buildGraph` only emits well-formed `DecisionInput`s, so the malformed shapes
//                   that defect was about are never generated. Kept because it costs nothing and
//                   guards against a different engine. The real coverage is `malformed.ts`, which
//                   catches that mutation 3,376 times and found section 32 on its first run.
//
// DETERMINISTIC. A seeded generator, no clock, no `Math.random`. A finding is reproducible from its
// seed and iteration index, and a run that is not reproducible cannot be bisected.

import {
  ALL_PARAM_ROLES,
  type ActionArg,
  CAPABILITY_POLICY,
  type Capability,
  type CapabilityPolicy,
  type CapabilityRow,
  type DecisionInput,
  type ParamRole,
  type Provenance,
  type Source,
  type SourceId,
  type Taint,
  actionId,
  decide,
  joinTaint,
  sourceId,
  taintOf,
} from "@agent-context-containment/core";

/** What the search found. `input` is carried so a finding can be replayed directly. */
export interface AdversaryFinding {
  readonly kind:
    | "never_throws"
    | "under_block"
    | "taint_mismatch"
    | "over_block"
    | "wrong_admission";
  readonly iteration: number;
  readonly capability: string;
  readonly detail: string;
  readonly input: DecisionInput;
}

export interface AdversaryResult {
  readonly explored: number;
  readonly findings: readonly AdversaryFinding[];
  /** How many explored inputs resolved to a fully CLEAN join, where a refusal would be spurious. */
  readonly cleanExplored: number;
  /** Distinct graph shapes actually produced, so a search that degenerated is visible. */
  readonly shapes: Readonly<Record<string, number>>;
}

/**
 * A seeded 32-bit generator. Small, dependency-free, and good enough to shuffle structure.
 *
 * Not cryptographic and not trying to be. What matters is that the same seed produces the same run
 * on every machine, so a failure carries its own reproduction.
 */
const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
};

/**
 * The independent oracle: the join over a node's whole ancestry.
 *
 * A dangling edge and a cycle both resolve to the top of the lattice, which is the specification the
 * engine is also written against. Memoised, and the seen-set is the CURRENT PATH - written this way
 * deliberately, because writing it the other way is the defect this search exists to catch.
 *
 * RECURSIVE ON PURPOSE, and the engine is not. An oracle earns its keep by being obviously correct
 * at a glance, and the recursive form is the one a reader can check against the specification in a
 * few seconds; `decide` carries an explicit stack because it must survive inputs a caller controls,
 * which this never sees. The trade is a stack bound, and `buildGraph` stays far under it - the
 * deepest shape it emits is a handful of nodes. Raising those sizes materially means making this
 * iterative too, and the test asserting each shape is generated is what would surface the change.
 */
const expectedTaint = (
  root: SourceId,
  byId: ReadonlyMap<string, Source>,
  memo: Map<string, Taint> = new Map(),
  onPath: Set<string> = new Set(),
): Taint => {
  const key = root as string;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const node = byId.get(key);
  if (node === undefined || onPath.has(key)) return "UNTRUSTED_EXTERNAL";
  onPath.add(key);
  let t = taintOf(node.provenance);
  for (const parent of node.derivedFrom ?? []) {
    t = joinTaint(t, expectedTaint(parent, byId, memo, onPath));
  }
  onPath.delete(key);
  memo.set(key, t);
  return t;
};

/**
 * THE CEILING, DERIVED INDEPENDENTLY. Deliberately does not call `ceilingFor`.
 *
 * The first version of the under-block property imported `ceilingFor` from core - the same function
 * `decide` uses - so a bug inside it moved BOTH sides of the comparison and the property could never
 * disagree with itself. Reintroducing the section 25 mutation produced zero findings, which is how
 * the problem was found: an oracle that shares the function under test is not an oracle.
 *
 * So the RULE is restated here, from the row's data:
 *
 *   an explicitly rated role wins outright
 *   an UNRECOGNISED role admits clean input only - not a role at all is not the same as not steering
 *   a known non-steering role gets the row's default
 *   a known steering role gets the stricter of the default and USER_CONTROLLED
 *
 * `STEERING` below is duplicated rather than imported for the same reason: core does not export it,
 * and importing it would put the set under test on both sides again. Duplication is the cost of an
 * oracle, and the cost is the point. If this rule and `ceilingFor` ever disagree, the search says so
 * and a human decides which one is wrong.
 */
export const ORACLE_STEERING: ReadonlySet<string> = new Set([
  "sink_identity",
  "magnitude",
  "control",
]);
const ORACLE_RANK: Readonly<Record<string, number>> = {
  CLEAN: 0,
  USER_CONTROLLED: 1,
  TOOL_DERIVED: 2,
  UNTRUSTED_EXTERNAL: 3,
};
export const oracleCeiling = (row: CapabilityRow, role: string): Taint => {
  const explicit = (row.roleCeilings as Readonly<Record<string, Taint>>)[role];
  if (explicit !== undefined) return explicit;
  if (!ORACLE_KNOWN_ROLES.has(role)) return "CLEAN";
  if (!ORACLE_STEERING.has(role)) return row.defaultCeiling;
  return (ORACLE_RANK[row.defaultCeiling] ?? 3) <= 1 ? row.defaultCeiling : "USER_CONTROLLED";
};
/**
 * Also duplicated, and DELIBERATELY not derived from `ALL_PARAM_ROLES`.
 *
 * Deriving it would put the list under test on both sides again: the generator draws its roles from
 * `ALL_PARAM_ROLES`, so if the oracle also read that list, a role added to it would be treated as
 * known by both and the "unrecognised role" branch would never be exercised.
 *
 * The cost of duplicating is DRIFT, and drift here is a false-positive generator rather than a hole:
 * adding a legitimate sixth role to `ALL_PARAM_ROLES` without adding it here produces hundreds of
 * spurious `under_block` findings on a correct engine, which is worse than useless because it
 * spends the credibility of the real ones. Measured at 276 findings when tried.
 *
 * So it stays duplicated and `adversary.test.ts` asserts the two sets are equal. Exported for that
 * test alone - a drift check that cannot see both lists is not a drift check.
 */
export const ORACLE_KNOWN_ROLES: ReadonlySet<string> = new Set([
  "sink_identity",
  "magnitude",
  "selector",
  "payload",
  "control",
]);
/**
 * The comparison OPERATOR, restated. Not the whole comparison, and the difference matters.
 *
 * The right operand comes from `oracleCeiling` and is genuinely independent. The LEFT operand does
 * not: it is folded with the engine's own `joinTaint` and `taintOf`, so a wrong `TAINT_RANK` or
 * `PROVENANCE_TAINT` collapses it and this check goes quiet. Measured - `TAINT_RANK` for
 * UNTRUSTED_EXTERNAL set to 0, or `PROVENANCE_TAINT.WEB` set to CLEAN, each flips a WEB-derived
 * recipient on `email_send` from NEEDS_DECLASSIFICATION to ALLOW and produces ZERO findings here.
 *
 * THREE THINGS THIS CHECK CANNOT SEE, none of them hypothetical:
 *
 *   the lattice        shared with the engine, as above.
 *   the TABLE'S DATA   `oracleCeiling` restates the RULE but reads `roleCeilings` and
 *                      `defaultCeiling` off the same `CapabilityRow` the engine reads. Widening a
 *                      ceiling in the shipped table reproduces the section 25 attack exactly and
 *                      this reports nothing.
 *   confirming rows    the property is gated on `decision === "ALLOW"`, so it is blind on every row
 *                      with `requiresConfirmation` - payment, wallet_sign, account_modify,
 *                      transaction_broadcast, which are the four highest-stakes rows in the table.
 *                      All of its findings land on the six rows that can reach ALLOW.
 *
 * What it does catch is a bug in the ceiling RULE, which is what section 25 was. That is worth
 * having and it is less than "no part of the ceiling check comes from the engine", which is what
 * this comment said before the refutation pass measured it. See DEFECTS_FOUND.md section 33.
 */
const oracleAtMost = (a: Taint, ceiling: Taint): boolean =>
  (ORACLE_RANK[a] ?? 3) <= (ORACLE_RANK[ceiling] ?? 0);

/** The graph shapes the generator can emit. Named so a degenerate run is legible in the report. */
type Shape = "chain" | "diamond" | "stacked_diamond" | "cycle" | "dangling" | "fan_in" | "flat";
const SHAPES: readonly Shape[] = [
  "chain",
  "diamond",
  "stacked_diamond",
  "cycle",
  "dangling",
  "fan_in",
  "flat",
];

/** Build a provenance graph of the requested shape, and return it with its leaf node. */
const buildGraph = (
  shape: Shape,
  pick: <T>(xs: readonly T[]) => T,
  provenances: readonly Provenance[],
): { sources: Source[]; leaf: string } => {
  const p = () => pick(provenances);
  const s = (id: string, prov: Provenance, ...from: string[]): Source => ({
    id: sourceId(id),
    provenance: prov,
    ...(from.length > 0 ? { derivedFrom: from.map((f) => sourceId(f)) } : {}),
  });
  switch (shape) {
    case "flat":
      return { sources: [s("a", p())], leaf: "a" };
    case "chain": {
      const n = 2 + Math.floor(pick([0, 1, 2, 3, 4]));
      const out: Source[] = [s("n0", p())];
      for (let i = 1; i <= n; i++) out.push(s(`n${i}`, p(), `n${i - 1}`));
      return { sources: out, leaf: `n${n}` };
    }
    case "diamond":
      return {
        sources: [s("root", p()), s("l", p(), "root"), s("r", p(), "root"), s("j", p(), "l", "r")],
        leaf: "j",
      };
    case "stacked_diamond": {
      const levels = 2 + Math.floor(pick([0, 1, 2, 3]));
      const out: Source[] = [s(`L${levels}`, p())];
      for (let i = 0; i < levels; i++) {
        out.push(s(`L${i}`, p(), `a${i}`, `b${i}`));
        out.push(s(`a${i}`, p(), `L${i + 1}`));
        out.push(s(`b${i}`, p(), `L${i + 1}`));
      }
      return { sources: out, leaf: "L0" };
    }
    case "cycle":
      return { sources: [s("x", p(), "y"), s("y", p(), "x"), s("z", p(), "x")], leaf: "z" };
    case "dangling":
      return { sources: [s("d", p(), "nobody")], leaf: "d" };
    case "fan_in": {
      const width = 2 + Math.floor(pick([0, 1, 2, 3, 4, 5]));
      const out: Source[] = [s("base", p())];
      const names: string[] = [];
      for (let i = 0; i < width; i++) {
        names.push(`f${i}`);
        out.push(s(`f${i}`, p(), "base"));
      }
      out.push(s("all", p(), ...names));
      return { sources: out, leaf: "all" };
    }
  }
};

/**
 * Explore the decision space and report every property violation.
 *
 * `policy` is the extension point that makes the negative control possible: hand it a deliberately
 * loosened table and the under-block property must start firing. A search that cannot be made to
 * fail is a search reporting its own optimism.
 */
export function searchAdversarially(opts: {
  readonly iterations: number;
  readonly seed?: number;
  readonly policy?: CapabilityPolicy;
  /** Include roles outside `ParamRole`. On by default: section 25 lived in exactly that gap. */
  readonly includeInvalidRoles?: boolean;
  /**
   * The table the RESULT is judged against, when it differs from the one the engine runs on.
   *
   * Both default to the shipped table and the distinction looks pedantic until you try to build the
   * negative control. Handing `decide` a loosened table and then asking whether it stayed within
   * THAT table's ceilings is a tautology: raise every ceiling to the top of the lattice and nothing
   * can exceed one, so the search reports a clean run on an engine that permits everything. The
   * control has to hold the SHIPPED ceilings fixed while the engine runs on the broken table.
   */
  readonly oraclePolicy?: CapabilityPolicy;
}): AdversaryResult {
  const policy = opts.policy ?? CAPABILITY_POLICY;
  const oraclePolicy = opts.oraclePolicy ?? policy;
  // A PARTIAL ORACLE TABLE IS A PROGRAMMING ERROR, NOT A DEGRADED MODE.
  //
  // This used to read `oraclePolicy[capability] ?? policy[capability]` at the point of use, which
  // silently judged any capability the oracle table happened to omit against the ENGINE'S OWN row -
  // the exact tautology the `oraclePolicy` option exists to prevent, reachable through the option
  // that prevents it. Measured: against a fully loosened engine, a full oracle table found 172
  // violations, a one-row table found 40, and an empty table found none, with no warning at any
  // point. Refused up front instead, where a caller can see it. See DEFECTS_FOUND.md section 33.
  if (opts.oraclePolicy !== undefined) {
    const missing = Object.keys(policy).filter((c) => oraclePolicy[c as Capability] === undefined);
    if (missing.length > 0) {
      throw new Error(
        `searchAdversarially: the oracle policy is missing ${missing.length} capability row(s) the engine has (${missing.join(", ")}). A partial oracle table would judge those rows against the engine's own policy, which is the tautology this option exists to avoid. Pass a complete table or omit oraclePolicy.`,
      );
    }
  }
  const next = rng(opts.seed ?? 0x5eed_1234);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
  const capabilities = Object.keys(policy) as Capability[];
  const roles: string[] = [
    ...ALL_PARAM_ROLES,
    ...(opts.includeInvalidRoles === false ? [] : ["sink_identiy", "recipient", "", "CONTENT"]),
  ];
  const provenanceSets: readonly (readonly Provenance[])[] = [
    ["SYSTEM"], // the fully-clean world, where the over-block property applies
    ["SYSTEM", "USER"],
    ["SYSTEM", "TOOL_OUTPUT", "WEB"],
    ["WEB", "EMAIL", "DOCUMENT", "RETRIEVED", "EXTERNAL_API"],
    ["SYSTEM", "USER", "TOOL_OUTPUT", "WEB", "EMAIL", "DOCUMENT", "RETRIEVED", "EXTERNAL_API"],
  ];

  const findings: AdversaryFinding[] = [];
  const shapes: Record<string, number> = {};
  let cleanExplored = 0;

  for (let i = 0; i < opts.iterations; i++) {
    const capability = pick(capabilities);
    // No fallback: the completeness check above guarantees this row exists.
    const row = oraclePolicy[capability] as CapabilityRow;
    const shape = pick(SHAPES);
    const provs = pick(provenanceSets);
    shapes[shape] = (shapes[shape] ?? 0) + 1;

    const argCount = 1 + Math.floor(next() * 3);
    const sources: Source[] = [];
    const args: ActionArg[] = [];
    for (let a = 0; a < argCount; a++) {
      const g = buildGraph(shape, pick, provs);
      // Namespace each argument's graph so several can coexist without colliding.
      for (const src of g.sources) {
        sources.push({
          ...src,
          id: sourceId(`${a}_${src.id as string}`),
          ...(src.derivedFrom !== undefined
            ? { derivedFrom: src.derivedFrom.map((d) => sourceId(`${a}_${d as string}`)) }
            : {}),
        });
      }
      args.push({
        // A repeated name on purpose some of the time: labels are not identities (defect §11).
        name: next() < 0.25 ? "shared" : `arg${a}`,
        role: pick(roles) as ParamRole,
        value: `v${a}`,
        derivedFrom: [sourceId(`${a}_${g.leaf}`)],
      });
    }

    const input: DecisionInput = {
      action: { id: actionId(`adv-${i}`), capability, tool: `tool-${i}`, args },
      sources,
      // NO RECEIPTS, deliberately. With none, an ALLOW must be justified by the ceiling alone, which
      // is what makes the under-block property a clean statement instead of a receipt audit.
      receipts: [],
    };

    // ---- property 1: it answers ---------------------------------------------------------------
    let verdict: ReturnType<typeof decide>;
    try {
      verdict = decide(input, policy);
    } catch (e) {
      findings.push({
        kind: "never_throws",
        iteration: i,
        capability,
        detail: `decide threw ${(e as Error).name}: ${(e as Error).message}`,
        input,
      });
      continue;
    }

    const byId = new Map<string, Source>(sources.map((s) => [s.id as string, s]));
    const memo = new Map<string, Taint>();

    // ---- property 2: no ALLOW above the ceiling -----------------------------------------------
    if (verdict.decision === "ALLOW") {
      for (const arg of args) {
        const t = arg.derivedFrom.reduce<Taint>(
          (acc, f) => joinTaint(acc, expectedTaint(f, byId, memo)),
          "CLEAN",
        );
        const ceiling = oracleCeiling(row, arg.role as string);
        if (!oracleAtMost(t, ceiling)) {
          findings.push({
            kind: "under_block",
            iteration: i,
            capability,
            detail: `ALLOWed "${arg.name}" (role ${String(arg.role)}) at ${t}, ceiling ${ceiling}`,
            input,
          });
        }
      }
    }

    // ---- property 3: the engine's join equals the oracle's ------------------------------------
    // The sharpest available statement, and it subsumes both over- and under-reporting. Cycles and
    // dangling edges need no special case: the oracle resolves them to the top of the lattice too,
    // because that is what the specification says, so agreement is still the thing being checked.
    const oracle = args.reduce<Taint>(
      (acc, arg) =>
        arg.derivedFrom.reduce<Taint>(
          (inner, f) => joinTaint(inner, expectedTaint(f, byId, memo)),
          acc,
        ),
      "CLEAN",
    );
    if (oracle === "CLEAN") cleanExplored++;
    if (verdict.taint !== oracle) {
      findings.push({
        kind: "taint_mismatch",
        iteration: i,
        capability,
        detail: `shape ${shape}: engine says ${verdict.taint}, an independent walk says ${oracle}`,
        input,
      });
    }
  }

  return { explored: opts.iterations, findings, cleanExplored, shapes };
}

/** A loosened table, for the negative control. Raising a ceiling must make under-block fire. */
export const loosenedPolicy = (): CapabilityPolicy => {
  const out: Record<string, unknown> = {};
  for (const [name, row] of Object.entries(CAPABILITY_POLICY)) {
    out[name] = {
      ...row,
      defaultCeiling: "UNTRUSTED_EXTERNAL",
      roleCeilings: Object.fromEntries(
        Object.keys(row.roleCeilings).map((r) => [r, "UNTRUSTED_EXTERNAL"]),
      ),
    };
  }
  return out as CapabilityPolicy;
};

/** One line per finding, for a report or a failure message. */
export const formatFindings = (r: AdversaryResult): string =>
  r.findings.length === 0
    ? `no violations in ${r.explored} explored decisions (${r.cleanExplored} fully clean)`
    : r.findings
        .slice(0, 20)
        .map((f) => `  ${f.kind.padEnd(12)} iter ${f.iteration} ${f.capability}: ${f.detail}`)
        .join("\n");
