// A third search, over RECEIPTS.
//
// WHY IT EXISTS. Both existing searches pass `receipts: []` or junk; neither has ever produced a
// well-formed receipt, so admission, binding and spending were defended entirely by hand-written
// tests. `docs/LIMITATIONS.md` row 14 named that as the largest gap in the search, and a refutation
// pass measured two shapes inside it that were weaker than the row claimed: **a wrong role** was
// caught only by `unguarded.test.ts`, and **the same receipt reused inside one action** was caught
// by NOTHING - the whole suite stayed green with that branch deleted. That branch is `P05`, filed in
// section 20 as unreachable-but-kept. This search reaches it.
//
// THE ORACLE IS A SECOND IMPLEMENTATION OF THE BINDING RULE, not a call into the engine. `covers`
// below decides, from the receipt and the argument alone, whether the receipt should admit: same
// capability, same role, same slot, the value it was issued for, the source it was issued against,
// inside its expiry, not already spent, and not already used by an earlier argument of this action.
// Disagreement between that and `decide` is the finding.
//
// WHAT IT SHARES, said plainly because section 33 was written about not saying it: the lattice
// (`taintOf`, `joinTaint`) and the capability table's DATA. A wrong `TAINT_RANK` or a widened
// `roleCeilings` moves both sides and is invisible here, exactly as in the graph search.
//
// OUT OF SCOPE, and not implied anywhere: no ledger adapter is exercised - `spentReceipts` is a set
// this file builds, not a database - and no multi-step agent run is simulated. Cross-host replay and
// the async reserve/settle protocol are covered by `prove:crosshost`, `prove:asyncledger` and
// `prove:postgres`, not by this.

import {
  CAPABILITY_POLICY,
  type Capability,
  type CapabilityPolicy,
  type CapabilityRow,
  type DecisionInput,
  type ParamRole,
  type ReceiptEvidence,
  type ReceiptId,
  type Taint,
  actionId,
  decide,
  joinTaint,
  receiptId,
  sourceId,
  taintOf,
} from "@agent-context-containment/core";
import type { AdversaryFinding, AdversaryResult } from "./adversary.js";

/** Seeded, for the same reason as the other two searches: a finding must carry its reproduction. */
const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
};

/**
 * The receipt shapes. NOT "every way a receipt can be wrong" - the first version said that and it
 * was not true of its own list.
 *
 * SINGLE-BRANCH DETECTORS, each measured by deleting exactly one engine branch and counting:
 * `wrong_capability`, `wrong_role`, `wrong_name`, `wrong_slot`, `wrong_value`, `wrong_source`,
 * `wrong_rule`, `expired`, `spent`, `lifts_too_low`, `reused_in_action`, `duplicate_label`.
 *
 * `duplicate_path` IS a single-branch detector, and section 36 was wrong to say it could not be one.
 * It builds the section 11 shape - two arguments carrying the SAME explicit path. Section 36 argued
 * that `slotsOf`'s collision suffixing and the `P05` reuse guard cover for each other so no single
 * deletion isolates it. The real reason nothing was isolated is that the shape issued ONE receipt, so
 * the second argument went uncovered and the action was DENIED whether or not the suffixing ran -
 * deleting rule 4 produced zero findings, measured. With a receipt per slot the two guards separate:
 * deleting rule 4 now produces 544 `over_block` findings at 12,000 iterations on seed 0x0dec0001, and
 * `slot-collision-suffixing` is a mutation entry. See DEFECTS_FOUND.md section 37.
 */
export const RECEIPT_SHAPES = [
  "valid",
  "wrong_capability",
  "wrong_role",
  "wrong_name",
  "wrong_slot",
  "wrong_value",
  "wrong_source",
  "expired",
  "spent",
  "duplicate_label",
  "duplicate_path",
  "reused_in_action",
  "wrong_rule",
  "lifts_too_low",
  "no_receipt",
] as const;
export type ReceiptShape = (typeof RECEIPT_SHAPES)[number];

const AT_ISSUE = 1_000;
const NOW = AT_ISSUE + 1_000;

/** The ceiling rule, restated - the same duplication and the same reason as in adversary.ts. */
const STEERING: ReadonlySet<string> = new Set(["sink_identity", "magnitude", "control"]);
const KNOWN: ReadonlySet<string> = new Set([
  "sink_identity",
  "magnitude",
  "selector",
  "payload",
  "control",
]);
const RANK: Readonly<Record<string, number>> = {
  CLEAN: 0,
  USER_CONTROLLED: 1,
  TOOL_DERIVED: 2,
  UNTRUSTED_EXTERNAL: 3,
};
const ceilingOf = (row: CapabilityRow, role: string): Taint => {
  const explicit = (row.roleCeilings as Readonly<Record<string, Taint>>)[role];
  if (explicit !== undefined) return explicit;
  if (!KNOWN.has(role)) return "CLEAN";
  if (!STEERING.has(role)) return row.defaultCeiling;
  return (RANK[row.defaultCeiling] ?? 3) <= 1 ? row.defaultCeiling : "USER_CONTROLLED";
};

/** One generated argument, with everything the oracle needs to judge it. */
interface Arg {
  readonly name: string;
  readonly role: ParamRole;
  readonly value: string;
  readonly slot: string;
  readonly from: string;
  readonly taint: Taint;
}

/**
 * THE ORACLE. Does this receipt admit this argument?
 *
 * Written from the binding rule as documented, not by calling `coverFor`. `usedIds` is what makes
 * the reuse property expressible at all: a receipt is one admission, so a receipt already spent by
 * an earlier argument of the SAME action cannot admit a second one.
 */
const covers = (
  r: ReceiptEvidence,
  arg: Arg,
  capability: Capability,
  row: CapabilityRow,
  spent: ReadonlySet<string>,
  usedIds: ReadonlySet<string>,
): boolean => {
  // A RULE THE ROW DOES NOT ACCEPT ADMITS NOTHING, and missing this made the whole search vacuous
  // on its first run: every generated receipt used `user_confirmed_value`, `web_fetch` lifts only
  // by allowlist/selection/echo, so nothing was ever admitted and the ALLOW path was never reached.
  // 18,947 of 20,000 iterations reported "needed a receipt and lacked one" - which read like
  // thorough coverage and was the opposite. See DEFECTS_FOUND.md section 34.
  if (!row.liftableBy.has(r.rule)) return false;
  if (spent.has(r.id as string)) return false;
  if (usedIds.has(r.id as string)) return false;
  if (r.capability !== capability) return false;
  if (r.role !== arg.role) return false;
  const slot = r.argPath ?? r.argName;
  if (slot !== arg.slot) return false;
  if (r.admitted !== undefined && r.admitted !== arg.value) return false;
  const scope = r.scope;
  if (scope !== undefined) {
    if (scope.expiresAt !== null && scope.expiresAt <= NOW) return false;
    if (scope.source !== null && (scope.source as string) !== arg.from) return false;
  }
  if ((RANK[r.lifts] ?? 0) < (RANK[arg.taint] ?? 3)) return false;
  return true;
};

/**
 * Which rows a receipt search can say anything about, DERIVED FROM THE TABLE.
 *
 * A row that lifts by nothing can never admit a receipt, so generating one for it would be testing
 * a path the policy says does not exist. That is the honest exclusion, and it is computed here so
 * the report cannot drift from the reason. Confirming rows are NOT excluded: they need
 * `confirmed: true` to reach ALLOW, which the generator supplies, and payment and
 * transaction_broadcast are exactly the rows where a receipt matters most.
 */
export const receiptSearchScope = (
  policy: CapabilityPolicy = CAPABILITY_POLICY,
): {
  readonly searched: readonly string[];
  readonly excluded: readonly { row: string; why: string }[];
} => {
  const searched: string[] = [];
  const excluded: { row: string; why: string }[] = [];
  for (const [name, row] of Object.entries(policy)) {
    if (row.liftableBy.size === 0) {
      excluded.push({ row: name, why: "lifts by nothing - no receipt can admit anything here" });
      continue;
    }
    searched.push(name);
  }
  return { searched, excluded };
};

export function searchReceipts(opts: {
  readonly iterations: number;
  readonly seed?: number;
  readonly policy?: CapabilityPolicy;
  /** Judged against this table, for the same reason `searchAdversarially` takes one. Must be whole. */
  readonly oraclePolicy?: CapabilityPolicy;
}): AdversaryResult {
  const policy = opts.policy ?? CAPABILITY_POLICY;
  const oraclePolicy = opts.oraclePolicy ?? policy;
  if (opts.oraclePolicy !== undefined) {
    const missing = Object.keys(policy).filter((c) => oraclePolicy[c as Capability] === undefined);
    if (missing.length > 0) {
      throw new Error(
        `searchReceipts: the oracle policy is missing ${missing.length} capability row(s) (${missing.join(", ")}). A partial table would judge those rows against the engine's own policy.`,
      );
    }
  }
  const next = rng(opts.seed ?? 0x0dec0001);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;

  // EVERY ROW THAT CAN LIFT, including the confirming ones.
  //
  // The first version excluded `requiresConfirmation` rows because such a row answers NEEDS_REVIEW
  // even when every argument is admitted, so ALLOW could not express "the receipt worked". That
  // dropped payment and transaction_broadcast - the two highest-stakes rows a receipt can lift - and
  // it was the graph search's blindness repeated in the search built to answer it. The generator
  // now supplies `confirmed: true` on a confirming row, which is what a shell does after asking,
  // so the receipt path reaches ALLOW there too.
  //
  // A row that lifts by NOTHING stays out, and that is honest rather than convenient: wallet_sign,
  // account_modify, text_response and transaction_prepare admit no receipt at all, so generating
  // one would test a path the table says does not exist.
  const liftable = (Object.keys(policy) as Capability[]).filter(
    (c) => policy[c].liftableBy.size > 0,
  );
  const capabilities = liftable;
  // A TABLE WHERE NOTHING LIFTS HAS NOTHING FOR THIS SEARCH TO SAY, and saying so beats picking
  // from an empty array and reading `liftableBy` off undefined three lines later.
  if (capabilities.length === 0) {
    throw new Error(
      "searchReceipts: no capability row in this policy lifts by anything, so no receipt can ever be admitted and the search has nothing to explore. Pass a policy with at least one liftable row.",
    );
  }

  const findings: AdversaryFinding[] = [];
  const shapes: Record<string, number> = {};
  let cleanExplored = 0;

  for (let i = 0; i < opts.iterations; i++) {
    const capability = pick(liftable.length > 0 ? liftable : capabilities);
    const row = oraclePolicy[capability] as CapabilityRow;
    const shape = pick(RECEIPT_SHAPES);
    shapes[shape] = (shapes[shape] ?? 0) + 1;

    // Two arguments sometimes, because duplicate labels and same-action reuse need two.
    const wantTwo =
      shape === "duplicate_label" ||
      shape === "duplicate_path" ||
      shape === "reused_in_action" ||
      next() < 0.3;
    const argCount = wantTwo ? 2 : 1;
    // PAYLOAD AND SELECTOR ARE IN HERE, and were not.
    //
    // The generator drew only from the steering roles, so a total bypass of receipt binding for
    // `payload` and `selector` passed the whole suite. It is not a live hole in the SHIPPED table -
    // no row rates those roles, so they inherit `defaultCeiling`, and every row whose default is
    // below the top requires confirmation - but it is live for any deployer manifest that tightens
    // them, which is exactly what docs/CAPABILITY_MANIFESTS.md tells a deployer to consider.
    // `payment` already makes them tight: its default is TOOL_DERIVED, so an UNTRUSTED_EXTERNAL
    // payload there needs a receipt. See DEFECTS_FOUND.md section 36.
    const role = pick(["sink_identity", "magnitude", "control", "payload", "selector"] as const);
    const provenance = pick(["WEB", "EMAIL", "DOCUMENT", "RETRIEVED"] as const);
    const sharedName = shape === "duplicate_label" || shape === "duplicate_path";

    const args: Arg[] = [];
    for (let a = 0; a < argCount; a++) {
      const name = sharedName ? "dup" : `arg${a}`;
      // A colliding EXPLICIT path is suffixed by slotsOf rule 4: two args both declaring path "p"
      // get slots "p" and "p#1". The oracle has to model that or it disagrees with the engine on a
      // correct input, which is a false-positive generator rather than a finding.
      const collidingPath = shape === "duplicate_path";
      args.push({
        name,
        role,
        value: `v${a}`,
        // A repeated NAME is not a slot: the engine disambiguates positionally. Defect section 11.
        slot: collidingPath ? (a === 0 ? "p" : `p#${a}`) : sharedName ? `${name}[${a}]` : name,
        from: `s${a}`,
        taint: joinTaint("CLEAN", taintOf(provenance)),
      });
    }

    const target = args[0] as Arg;
    // Drawn from the ROW, not fixed: a receipt whose rule the row does not accept is refused before
    // any binding check runs, so a generator that always used one rule could never reach admission.
    const rules = [...row.liftableBy];
    const goodRule = rules[Math.floor(next() * rules.length)] ?? "user_confirmed_value";
    const badRule =
      (
        ["user_confirmed_value", "allowlist_member", "numeric_envelope", "echo_of_clean"] as const
      ).find((r) => !row.liftableBy.has(r)) ?? "numeric_envelope";

    const mk = (over: Partial<ReceiptEvidence> = {}): ReceiptEvidence =>
      ({
        id: receiptId(`r-${i}`),
        rule: goodRule,
        capability,
        role: target.role,
        argName: target.name,
        argPath: target.slot,
        lifts: "UNTRUSTED_EXTERNAL",
        admitted: target.value,
        scope: {
          nonce: `n-${i}`,
          issuedAt: AT_ISSUE,
          expiresAt: AT_ISSUE + 60_000,
          source: sourceId(target.from),
        },
        ...over,
      }) as ReceiptEvidence;

    let receipts: ReceiptEvidence[] = [mk()];
    const spent = new Set<string>();
    switch (shape) {
      case "no_receipt":
        receipts = [];
        break;
      case "wrong_rule":
        receipts = [mk({ rule: badRule })];
        break;
      case "wrong_capability":
        receipts = [mk({ capability: pick(capabilities.filter((c) => c !== capability)) })];
        break;
      case "wrong_role":
        receipts = [mk({ role: pick(["selector", "payload"] as const) })];
        break;
      case "wrong_name":
        // argPath DELIBERATELY ABSENT. The engine consults `argName` only when `argPath` is missing
        // or empty, so setting both made this a second copy of `wrong_slot` - it exercised the path
        // branch and never the name branch. Measured: deleting the name branch produced zero
        // findings. See DEFECTS_FOUND.md section 35.
        receipts = [mk({ argName: "somethingElse", argPath: undefined })];
        break;
      case "lifts_too_low":
        // The one dimension the shape list did not cover: a receipt that binds correctly but lifts
        // to a level below the argument's taint.
        receipts = [mk({ lifts: "TOOL_DERIVED" })];
        break;
      case "wrong_slot":
        receipts = [mk({ argPath: `${target.name}[9]` })];
        break;
      case "wrong_value":
        receipts = [mk({ admitted: "a-different-value" })];
        break;
      case "wrong_source":
        receipts = [
          mk({
            scope: {
              nonce: `n-${i}`,
              issuedAt: AT_ISSUE,
              expiresAt: AT_ISSUE + 60_000,
              source: sourceId("some-other-source"),
            },
          }),
        ];
        break;
      case "expired":
        receipts = [
          mk({
            scope: {
              nonce: `n-${i}`,
              issuedAt: AT_ISSUE,
              expiresAt: AT_ISSUE + 1,
              source: sourceId(target.from),
            },
          }),
        ];
        break;
      case "spent":
        spent.add(`r-${i}`);
        break;
      case "reused_in_action": {
        // ONE receipt id, TWO arguments that both need one. It may admit at most one of them.
        //
        // THE SECOND COPY MUST BE VALID IN EVERY OTHER DIMENSION, and the first version was not: it
        // kept the FIRST argument's `scope.source`, so the source-binding check rejected the second
        // argument before the reuse check was ever reached. Engine and oracle then agreed for the
        // wrong reason, and the shape found nothing even with the reuse branch deleted - a generated
        // case that masked the branch it existed to reach. See DEFECTS_FOUND.md section 34.
        const second = args[1] as Arg;
        receipts = [
          mk(),
          mk({
            id: receiptId(`r-${i}`),
            argName: second.name,
            argPath: second.slot,
            admitted: second.value,
            scope: {
              nonce: `n-${i}`,
              issuedAt: AT_ISSUE,
              expiresAt: AT_ISSUE + 60_000,
              source: sourceId(second.from),
            },
          }),
        ];
        break;
      }
      case "duplicate_path": {
        // COLLIDING EXPLICIT PATHS, which is the shape section 11 is actually about. Two arguments
        // both declare path "p"; `slotsOf` rule 4 suffixes the second to "p#1".
        //
        // ONE RECEIPT PER SLOT, AND THE COUNT IS THE WHOLE POINT. Two earlier versions failed here.
        // The first gave the arguments DIFFERENT explicit paths, which made this a second copy of
        // `wrong_slot`. The second gave them the same path but issued a SINGLE receipt - and that
        // cannot discriminate rule 4 at all, because the second argument goes uncovered either way
        // and the action is DENIED either way. Deleting the suffixing changed nothing this search
        // could see: measured, zero findings, while two hand-written tests caught it.
        //
        // With a receipt for each slot the mutant is separable. Suffixing intact: slots "p" and
        // "p#1", each matched, ALLOW. Suffixing removed: both slots are "p", the "p" receipt admits
        // the first argument, the "p#1" receipt matches nothing, P05 refuses to reuse the first -
        // DENY, while the oracle still says ALLOW. That disagreement is an `over_block`.
        // See DEFECTS_FOUND.md section 37.
        const secondSlot = args[1] as Arg;
        receipts = [
          mk({ argName: "dup", argPath: "p" }),
          mk({
            id: receiptId(`r-${i}-b`),
            argName: "dup",
            argPath: secondSlot.slot,
            admitted: secondSlot.value,
            scope: {
              nonce: `n-${i}-b`,
              issuedAt: AT_ISSUE,
              expiresAt: AT_ISSUE + 60_000,
              source: sourceId(secondSlot.from),
            },
          }),
        ];
        break;
      }
      case "duplicate_label": {
        // One receipt naming a LABEL that two arguments share. Defect section 11's class.
        receipts = [
          mk({ argName: "dup", ...(shape === "duplicate_label" ? { argPath: undefined } : {}) }),
        ];
        break;
      }
      default:
        break;
    }

    const input: DecisionInput = {
      action: {
        id: actionId(`rec-${i}`),
        capability,
        tool: `tool-${i}`,
        args: args.map((a) => ({
          name: a.name,
          role: a.role,
          value: a.value,
          // `path`, NOT `argPath`. The action argument's field is `path` (types.ts); `argPath` is
          // the RECEIPT's field. Writing the receipt's name here was silently ignored - TypeScript
          // allowed it - so `slotsOf` never saw an explicit path, rules 1 and 4 never ran, and the
          // oracle's slot model diverged from the engine's on every shared-name shape. The oracle
          // then counted admissions the engine never made, which inflated the very number the
          // admission floor asserts. See DEFECTS_FOUND.md section 37.
          path: a.slot.startsWith("p#") ? "p" : a.slot,
          derivedFrom: [sourceId(a.from)],
        })),
      },
      sources: args.map((a) => ({ id: sourceId(a.from), provenance })),
      receipts,
      spentReceipts: new Set([...spent].map((s) => receiptId(s) as ReceiptId)),
      // What a shell supplies after asking a human. Without it a confirming row answers
      // NEEDS_REVIEW however good the receipt is, and the receipt path cannot be observed at all.
      confirmed: row.requiresConfirmation === true,
      now: NOW,
    };

    let verdict: ReturnType<typeof decide>;
    try {
      verdict = decide(input, policy);
    } catch (e) {
      findings.push({
        kind: "never_throws",
        iteration: i,
        capability,
        detail: `decide threw ${(e as Error).name}: ${String((e as Error).message).slice(0, 120)}`,
        input,
      });
      continue;
    }

    // ---- the oracle's verdict on each argument ----------------------------------------------
    const usedIds = new Set<string>();
    let allAdmitted = true;
    // COUNTED SEPARATELY FROM `allAdmitted`, which is true both when a receipt worked and when no
    // argument needed one. The floor in the test must measure the first, or a generator drifted to
    // all-clean provenance would report full coverage while admitting nothing - which is the
    // section 34 vacuity in a new costume. See DEFECTS_FOUND.md section 35.
    let admittedSomething = false;
    /**
     * Argument SLOTS the oracle says are covered, for the per-argument property below.
     *
     * SLOTS, NOT NAMES, and the first version used names. Both `duplicate` shapes give their two
     * arguments the same label - that is what they are for - so a set of names collapsed them to one
     * entry and the check could not tell which argument the engine had admitted. The property that
     * existed to watch those two shapes was blind on exactly those two shapes.
     * See DEFECTS_FOUND.md section 37.
     */
    const oracleAdmitted = new Set<string>();
    for (const arg of args) {
      const ceiling = ceilingOf(row, arg.role);
      if ((RANK[arg.taint] ?? 3) <= (RANK[ceiling] ?? 0)) continue;
      const hit = receipts.find((r) => covers(r, arg, capability, row, spent, usedIds));
      if (hit === undefined) {
        allAdmitted = false;
        continue;
      }
      usedIds.add(hit.id as string);
      oracleAdmitted.add(arg.slot);
      admittedSomething = true;
    }
    // `cleanExplored` is this search's ADMISSION count: iterations where a receipt genuinely
    // admitted an over-ceiling argument. Named by the shared result type, meant precisely here.
    if (admittedSomething) cleanExplored++;

    if (verdict.decision === "ALLOW" && !allAdmitted) {
      findings.push({
        kind: "under_block",
        iteration: i,
        capability,
        detail: `ALLOWed with shape ${shape}: no receipt this module reads as valid covers every over-ceiling argument`,
        input,
      });
    }

    // ---- per-ARGUMENT admission, which is finer than the decision ---------------------------
    //
    // WHY A THIRD PROPERTY. `under_block` and `over_block` both key on the DECISION, so they can
    // only see a receipt failure that changes ALLOW to a refusal or back. The `duplicate_label` and
    // `duplicate_path` shapes cannot do that with one branch deleted: removing the label-ambiguity
    // guard lets the receipt admit the FIRST argument, and the second is still uncovered, so the
    // action is still refused and both decision properties stay quiet. Four simultaneous deletions
    // were needed before either shape said anything, which made them decorative as detectors.
    //
    // The engine names each admission in a `declassified` reason. Comparing that list against the
    // oracle's is a per-argument check, and it fires on ONE deletion. See DEFECTS_FOUND.md section 36.
    const enginedAdmitted = new Set(
      verdict.reasons
        .filter((r) => r.code === "declassified")
        // ANCHORED, and matching an empty slot. The first pattern took the first quoted run
        // anywhere in the message, so a rule or label containing a quote would have been read as
        // the slot, and `[^"]+` could not match a slot that is the empty string.
        .map((r) => (/^"([^"]*)" admitted by /.exec(r.message) ?? [])[1])
        .filter((n): n is string => n !== undefined),
    );
    for (const name of enginedAdmitted) {
      if (!oracleAdmitted.has(name)) {
        findings.push({
          kind: "wrong_admission",
          iteration: i,
          capability,
          detail: `shape ${shape}: the engine admitted slot "${name}" but no receipt this module reads as valid covers it`,
          input,
        });
      }
    }

    // THE OTHER DIRECTION, and without it the `valid` shape contributes nothing: when the oracle
    // says every over-ceiling argument IS covered, the engine must not still be refusing on taint.
    // A search that only looks for under-blocking cannot tell a correct engine from one that refuses
    // everything, which is the same complaint this project makes about a policy that only ever DENYs.
    if (allAdmitted && admittedSomething) {
      // KEYED ON THE DECISION, NOT ON REASON CODES. The first version asked whether
      // `taint_exceeds_ceiling` appeared anywhere in `verdict.reasons` - but `coverFor` emits that
      // code as a PER-RECEIPT rejection even when a later receipt admits the argument, so two
      // receipts for one slot at different lift levels made it fire on a correct ALLOW. It was
      // shielded from its own false positive only because every generated receipt happened to lift
      // to the top of the lattice. See DEFECTS_FOUND.md section 35.
      const stillRefusing = verdict.decision !== "ALLOW";
      if (stillRefusing) {
        findings.push({
          kind: "over_block",
          iteration: i,
          capability,
          detail: `shape ${shape}: every over-ceiling argument is covered by a receipt this module reads as valid, yet the engine still refuses on taint (${verdict.reasons.map((r) => r.code).join(", ")})`,
          input,
        });
      }
    }
  }

  return { explored: opts.iterations, findings, cleanExplored, shapes };
}
