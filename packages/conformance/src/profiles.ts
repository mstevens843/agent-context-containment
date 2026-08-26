// Three policies that are all defensible, and the tradeoff between them.
//
// EVERY NUMBER BEFORE THIS FILE COMPARED CONTAINMENT TO SOMETHING WORSE. Mutants are wrong on
// purpose; the classifier baseline is a different technique the project argues against. Both
// comparisons are fair and both are rigged in the same direction: the shipped policy is the only
// participant nobody tried to make lose.
//
// A profile is not a mutant. `M5 paranoid` refuses everything and is WRONG. `strict` below also
// refuses more than the reference does, and is not wrong at all - it is what a deployment with a
// treasury and a compliance officer would actually configure. Same engine, same corpus, different
// risk appetite. The interesting question is not which profile scores best, because that depends
// entirely on which column you were going to be fired over.
//
// So this file exists to show the shape of the tradeoff, not to crown the reference. If `strict`
// blocks more attacks than the reference, that is reported plainly. It should: it was built to. The
// number worth reading beside it is what `strict` costs in benign work refused - and if the reference
// were sitting at a bad point on that curve, this is the file that would say so.

import {
  CAPABILITY_POLICY,
  type CapabilityPolicy,
  type Taint,
  contradictions,
  decide,
  formatManifestFindings,
  validatePolicy,
} from "@agent-containment/core";
import type { ContainmentPolicy, ContainmentRequest, ContainmentResponse } from "./ports.js";

/** The lattice as ordinals, so "one notch tighter" is arithmetic rather than a table of cases. */
const ORDER: readonly Taint[] = ["CLEAN", "USER_CONTROLLED", "TOOL_DERIVED", "UNTRUSTED_EXTERNAL"];
const step = (t: Taint, by: number): Taint =>
  ORDER[Math.min(ORDER.length - 1, Math.max(0, ORDER.indexOf(t) + by))] ?? t;

/**
 * Every profile is validated at construction, and a contradiction is fatal.
 *
 * These tables are BUILT AT RUN TIME by mapping over the shipped one, and until v0.8 nothing checked
 * them against the rules the shipped table has to satisfy - because every invariant lived in a
 * `describe()` block over one constant. A profile that violated them still produced numbers, and
 * those numbers went into a published report.
 *
 * Throwing is right here and would be wrong inside `decide()`. This is construction, at module load,
 * with no request in flight: the only thing a caller could do with a caught error is run anyway.
 */
const validated = (name: string, policy: CapabilityPolicy): CapabilityPolicy => {
  const bad = contradictions(validatePolicy(policy));
  if (bad.length > 0) {
    throw new Error(
      `policy profile "${name}" is internally contradictory and would publish numbers from an invalid table:\n${formatManifestFindings(bad)}`,
    );
  }
  return policy;
};

/**
 * Every table these profiles are built from, recorded as they are constructed.
 *
 * A `ContainmentPolicy` is a name and a closure, and you cannot validate a closure - so the tables
 * are kept alongside for `scripts/manifest-report.mjs` to check and diff. Registered by `runWith`
 * rather than listed by hand, because a hand-written list is one edit away from omitting the profile
 * somebody just added, and the omitted one is the one nobody validates.
 */
const TABLES: [string, CapabilityPolicy][] = [];
export const POLICY_TABLES: readonly (readonly [string, CapabilityPolicy])[] = TABLES;

const runWith = (name: string, rawPolicy: CapabilityPolicy): ContainmentPolicy => {
  TABLES.push([name, rawPolicy]);
  return {
    name,
    decide: (r: ContainmentRequest): ContainmentResponse => {
      const v = decide(
        { action: r.action, sources: r.sources, receipts: r.receipts, confirmed: r.confirmed },
        validated(name, rawPolicy),
      );
      return { decision: v.decision, reasons: v.reasons.map((x) => x.code) };
    },
  };
};

/** The shipped table. The middle of the three, and not privileged by being the middle. */
export const referenceProfile: ContainmentPolicy = runWith("reference", CAPABILITY_POLICY);

/**
 * One notch tighter on every ceiling of every capability that acts or leaks.
 *
 * The deployment this models: an agent with production credentials, where an escalation costs a
 * human minute and a mistake costs a wire transfer. Rows with no effect and no egress are left
 * alone - tightening `text_response` would buy nothing and cost every benign answer.
 *
 * Confirmation is also forced on anything irreversible. That is the axis-honest version of strict:
 * confirmation belongs to the EFFECT axis, so a stricter appetite raises it there rather than
 * pretending everything is more tainted than it is.
 */
export const strictProfile: ContainmentPolicy = runWith(
  "strict",
  Object.fromEntries(
    Object.entries(CAPABILITY_POLICY).map(([k, row]) => [
      k,
      row.effect === "none" && row.egress === "none"
        ? row
        : {
            ...row,
            defaultCeiling: step(row.defaultCeiling, -1),
            roleCeilings: Object.fromEntries(
              Object.entries(row.roleCeilings).map(([role, t]) => [role, step(t as Taint, -1)]),
            ),
            requiresConfirmation: row.requiresConfirmation || row.effect === "irreversible",
          },
    ]),
  ) as CapabilityPolicy,
);

/**
 * One notch looser, but only where the blast radius is bounded.
 *
 * The deployment this models: an internal assistant where a stalled task is the expensive outcome
 * and no single action can move money or mail a stranger. The loosening is deliberately NOT uniform -
 * a profile that relaxed `payment.sink_identity` would not be a risk appetite, it would be a bug with
 * a rationale attached, and it would make the comparison meaningless by putting an obviously broken
 * engine in the looser column.
 *
 * So it loosens only rows that are reversible-or-less on effect AND below full on egress. Everything
 * irreversible, and everything with full egress, keeps the reference ceilings exactly.
 */
export const permissiveProfile: ContainmentPolicy = runWith(
  "permissive",
  Object.fromEntries(
    Object.entries(CAPABILITY_POLICY).map(([k, row]) => [
      k,
      row.effect === "irreversible" || row.egress === "full"
        ? row
        : {
            ...row,
            defaultCeiling: step(row.defaultCeiling, 1),
            roleCeilings: Object.fromEntries(
              Object.entries(row.roleCeilings).map(([role, t]) => [role, step(t as Taint, 1)]),
            ),
          },
    ]),
  ) as CapabilityPolicy,
);

/**
 * Escalate instead of refusing, wherever a human could plausibly decide.
 *
 * The deployment this models: a product with an operations team already in the loop, where a review
 * queue is cheap and a refused task is a support ticket. It is not "between" strict and reference on
 * any axis - it moves work from the REFUSED column to the ESCALATED one, which is a different move
 * entirely and is why the frontier needs more than one dimension to show it.
 *
 * Implemented on the effect axis, not the taint axis: confirmation is a property of what an action
 * DOES, so widening it means requiring confirmation on everything reversible as well as everything
 * irreversible. The ceilings are untouched, so nothing untrusted gains a steering path - the queue
 * gets longer, the boundary does not move.
 */
export const escalatingProfile: ContainmentPolicy = runWith(
  "escalating",
  Object.fromEntries(
    Object.entries(CAPABILITY_POLICY).map(([k, row]) => [
      k,
      row.effect === "none" ? row : { ...row, requiresConfirmation: true },
    ]),
  ) as CapabilityPolicy,
);

/**
 * Tightest on egress, ordinary elsewhere.
 *
 * The deployment this models: the data-loss case, where what leaves matters more than what changes.
 * A support agent that can update a ticket freely and must not be able to mail a stranger the
 * contents of one. Only rows with `egress: "full"` tighten, so it is the one profile whose cost lands
 * on a single axis and can be read against `strict`, which taxes both.
 *
 * Worth having because it tests a claim the two-axis model makes: that effect and egress are
 * genuinely independent, so a deployment can buy one without paying for the other. If tightening
 * egress alone produced the same numbers as `strict`, the second axis would be decoration.
 */
export const egressStrictProfile: ContainmentPolicy = runWith(
  "egress_strict",
  Object.fromEntries(
    Object.entries(CAPABILITY_POLICY).map(([k, row]) => [
      k,
      row.egress !== "full"
        ? row
        : {
            ...row,
            defaultCeiling: step(row.defaultCeiling, -1),
            roleCeilings: Object.fromEntries(
              Object.entries(row.roleCeilings).map(([role, t]) => [role, step(t as Taint, -1)]),
            ),
          },
    ]),
  ) as CapabilityPolicy,
);

/**
 * Ordered loosest-last on the refuse/allow axis, so a reader scans the tradeoff in one direction.
 *
 * `escalating` sits out of that order deliberately: it is not looser or tighter, it reroutes. Putting
 * it in a rank would imply a single dimension the frontier report exists to deny.
 */
export const PROFILES: readonly ContainmentPolicy[] = [
  strictProfile,
  egressStrictProfile,
  referenceProfile,
  escalatingProfile,
  permissiveProfile,
];

/**
 * What each profile is FOR. Printed with the numbers, because a column of scores with no statement
 * of intent invites the reader to treat the best score as the right answer.
 */
export const PROFILE_INTENT: Readonly<Record<string, string>> = {
  strict:
    "production credentials; escalate rather than act; confirmation on everything irreversible",
  reference: "the shipped table; per-role ceilings tuned so ordinary work still completes",
  permissive:
    "internal assistant; a stalled task is the expensive outcome; irreversible rows untouched",
  egress_strict: "data-loss first: tighten only what can leave, leave what merely changes alone",
  escalating: "an ops team is already in the loop; a review queue is cheaper than a refused task",
};
