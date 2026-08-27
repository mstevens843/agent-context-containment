// Validating a capability manifest, and being honest about what that can and cannot catch.
//
// THE PROBLEM THIS DOES NOT SOLVE, first, because overselling it would be the same error as calling
// this library information-flow control. The engine enforces flow GIVEN the declaration. If a tool
// that emails your inbox to a stranger is declared `read_only_tool`, containment permits it - and on
// the imported data-stealing split that is not a corner case, it is **32 of 32**. No function over a
// manifest detects that, because nothing inside the declaration contradicts anything else inside it.
// A lie that is internally consistent is invisible from the inside.
//
// So the catalogue is partitioned by DETECTABILITY, and only the first bucket is code:
//
//   STRUCTURAL     a contradiction inside the declaration. A pure function settles it. This file.
//   CORROBORATED   needs exactly one named artifact - a tool's parameter schema, a decision log, an
//                  observed effect. Listed here, checked elsewhere or by a human.
//   UNDECIDABLE    requires knowing what the tool MEANS. No artifact settles it. Listed anyway, so
//                  the boundary is a written thing rather than an absence.
//
// What declaring a tool's transport buys is not detection - it is SPECIFICITY. A more specific claim
// is one a schema or a probe can contradict, which moves an item from undecidable to corroborated.
// That is the whole mechanism and it is worth stating plainly, because "we validate the manifest"
// invites the reading that a validated manifest is a true one.
//
// WHY THIS IS A FUNCTION AND NOT A TEST. Every invariant in this repository used to live in a
// `describe()` block over the shipped `CAPABILITY_POLICY`. But `decide(input, policy)` accepts ANY
// policy, and `packages/conformance/src/profiles.ts` builds four at run time and publishes numbers
// from them - none of which were ever checked against the rules the shipped table has to satisfy. A
// rule that only ever runs against one constant is a rule about that constant.

import { type CapabilityPolicy, type CapabilityRow, ceilingFor } from "./policy.js";
import {
  ALL_CAPABILITIES,
  ALL_PARAM_ROLES,
  type Capability,
  type ParamRole,
  type Taint,
} from "./types.js";

export type ManifestSeverity =
  /** A contradiction. The manifest is wrong however the tools behave, and this must be fixed. */
  | "contradiction"
  /** Defensible, and the shape of a known mistake. Worth a human deciding on purpose. */
  | "suspicion";

export interface ManifestFinding {
  readonly code: string;
  readonly severity: ManifestSeverity;
  readonly capability: string;
  readonly detail: string;
}

const ORDER: readonly Taint[] = ["CLEAN", "USER_CONTROLLED", "TOOL_DERIVED", "UNTRUSTED_EXTERNAL"];
const rank = (t: Taint): number => ORDER.indexOf(t);
const STEERING: readonly ParamRole[] = ["sink_identity", "magnitude", "control"];

/**
 * Check a capability manifest against every rule the shipped table has to satisfy.
 *
 * Returns findings rather than throwing. A manifest problem is a CONFIG-TIME problem and belongs at
 * startup or in CI, not inside `decide()` - detecting it at decision time would be too late to help
 * and would tempt a caller to wrap a policy decision in a try/catch, and that catch block is a bypass.
 */
export function validatePolicy(policy: CapabilityPolicy): readonly ManifestFinding[] {
  const out: ManifestFinding[] = [];
  const push = (
    code: string,
    severity: ManifestSeverity,
    capability: string,
    detail: string,
  ): void => {
    out.push({ code, severity, capability, detail });
  };

  const known = new Set<string>(ALL_CAPABILITIES);
  for (const [key, row] of Object.entries(policy) as [string, CapabilityRow][]) {
    // ---- the namespace ------------------------------------------------------------------------
    // A MISSING row fails closed - `decide` refuses a capability it cannot find. An EXTRA row fails
    // OPEN: `decide` does `policy[action.capability]` and honours whatever it finds, so a policy
    // loaded from JSON can carry a row for a capability nobody vetted, with ceilings its author
    // chose. That asymmetry is why this check exists at all.
    if (!known.has(key)) {
      push(
        "UNKNOWN_CAPABILITY",
        "contradiction",
        key,
        "not in ALL_CAPABILITIES. decide() honours any row it finds, so an unvetted capability fails OPEN, unlike a missing one",
      );
    }
    if (row.capability !== key) {
      push(
        "ROW_KEY_MISMATCH",
        "contradiction",
        key,
        `row.capability is "${row.capability}"; a copy-pasted row that forgets to change this is otherwise invisible`,
      );
    }

    const inert = row.effect === "none" && row.egress === "none";

    // ---- the fail-closed clamp, and the availability failure it can cause ----------------------
    // `ceilingFor` clamps an unrated STEERING role to USER_CONTROLLED whatever `defaultCeiling` says.
    // That is right for every row that acts. On an INERT row it is an availability failure: with no
    // liftable rule there is no route out, so the capability that changes nothing and sends nothing
    // returns a flat DENY. That is defect §12, and it shipped on `text_response` - the row the whole
    // design leans on.
    // `draftOnly` is exempt: the flag exists precisely so an over-ceiling argument escalates to
    // NEEDS_REVIEW instead of refusing, which IS the route out. Flagging it was this validator's own
    // first false positive - it fired on `transaction_prepare`, whose v0.3 fix is the reason the rule
    // is needed at all everywhere else.
    if (inert && row.draftOnly !== true) {
      for (const role of STEERING) {
        if (row.roleCeilings[role] === undefined && row.liftableBy.size === 0) {
          push(
            "INERT_ROW_UNRATED_STEERING_ROLE",
            "contradiction",
            key,
            `has no effect and no egress but leaves "${role}" unrated, so ceilingFor clamps it to USER_CONTROLLED with no liftable rule - a flat DENY on a capability that cannot do anything`,
          );
        }
      }
    }

    // ---- ceilings that cannot be satisfied ----------------------------------------------------
    for (const role of ALL_PARAM_ROLES) {
      const declared = row.roleCeilings[role];
      if (declared === undefined) continue;
      if (rank(declared) > rank(row.defaultCeiling) && !inert) {
        push(
          "ROLE_LOOSER_THAN_DEFAULT",
          "suspicion",
          key,
          `"${role}" is rated ${declared}, looser than defaultCeiling ${row.defaultCeiling}. Legitimate for payload and selector; on a steering role it is how a ceiling gets widened by accident`,
        );
      }
    }

    // ---- the invariant another mechanism silently depends on -----------------------------------
    // `decide` reports mixed provenance as a REASON rather than enforcing it as a gate, and that
    // choice is only safe while every steering role on an acting capability sits at or below
    // USER_CONTROLLED: an argument spliced from a principal source and a non-principal one already
    // exceeds its ceiling, so the ceiling subsumes the splice. Loosen one such role and the band the
    // splice check covers reopens, with nothing gating it - and nothing anywhere says so, because the
    // dependency lives in a comment in a test about the shipped table.
    //
    // A suspicion, not a contradiction: a deployment may genuinely want this. But it must be a
    // decision somebody made knowing what else it turns off.
    if (row.effect !== "none") {
      for (const role of STEERING) {
        if (rank(ceilingFor(row, role)) >= rank("TOOL_DERIVED")) {
          push(
            "STEERING_ADMITS_TOOL_DERIVED",
            "suspicion",
            key,
            `"${role}" admits ${ceilingFor(row, role)} on a capability with effect="${row.effect}". This reopens the band the mixed-provenance splice check covers, and that check is DIAGNOSTIC ONLY - it reports and does not gate. Promote it to a gate, or keep this role at or below USER_CONTROLLED`,
          );
        }
      }
    }

    // ---- the effect axis ----------------------------------------------------------------------
    if (row.effect === "irreversible" && !row.requiresConfirmation) {
      push(
        "IRREVERSIBLE_WITHOUT_CONFIRMATION",
        "suspicion",
        key,
        "irreversible and requires no confirmation. Defensible - confirmation fatigue is real - but it must be a decision somebody made, not a field nobody filled in",
      );
    }
    if (row.draftOnly === true && !inert) {
      push(
        "DRAFT_THAT_ACTS",
        "contradiction",
        key,
        `draftOnly with effect="${row.effect}" and egress="${row.egress}". The flag downgrades a refusal to a review, so on anything that acts it is a general safety downgrade wearing a narrow name`,
      );
    }
    if (row.draftOnly === true && row.requiresConfirmation) {
      push(
        "DRAFT_REQUIRING_CONFIRMATION",
        "suspicion",
        key,
        "a draft escalates to review already; also requiring confirmation asks a human twice for one artifact",
      );
    }

    // ---- unliftable ceilings ------------------------------------------------------------------
    if (row.liftableBy.size === 0 && !inert) {
      for (const role of STEERING) {
        if (rank(ceilingFor(row, role)) < rank("UNTRUSTED_EXTERNAL")) {
          push(
            "UNLIFTABLE_STEERING_CEILING",
            "suspicion",
            key,
            `"${role}" is below the top of the lattice and no rule can lift it, so every refusal here is a flat DENY with no route to approval. Correct for a signing key; an availability failure anywhere else`,
          );
          break;
        }
      }
    }

    // ---- tuple policies -----------------------------------------------------------------------
    for (const t of row.tuplePolicies ?? []) {
      const roles = new Set(t.roles);
      if (roles.size < 2) {
        push(
          "TUPLE_WITHOUT_DISTINCT_ROLES",
          "contradiction",
          key,
          `tuple "${t.id}" names ${t.roles.length} slot(s) across ${roles.size} distinct role(s); a combination of one thing is not a combination`,
        );
      }
      // THE TUPLE GATE EXISTS FOR VALUES ADMITTED SEPARATELY. It catches the case where each argument
      // was individually lifted by its own receipt and the COMBINATION is the attack - an allowlisted
      // payee plus an in-policy amount. So a row with an empty `liftableBy` can admit nothing
      // separately, and every tuple on it is dead: it reads as protection in the table and can never
      // run. Found by this validator on its first pass, against a repository that already had a
      // "declares no combination that could never fire" invariant - that one checks the TOP of the
      // lattice (a role nothing needs lifting into) and had no rule for the bottom. See §13.
      if (row.liftableBy.size === 0) {
        push(
          "DEAD_TUPLE_POLICY",
          "contradiction",
          key,
          `tuple "${t.id}" can never fire: the row has no liftable rule, so no argument is ever admitted SEPARATELY and the combination gate is never reached`,
        );
      }
    }

    // ---- the gap this file cannot close, surfaced rather than assumed -------------------------
    // Not a finding about the manifest being wrong. A finding about how much a wrong one would cost,
    // so the rows worth auditing hardest are named rather than left for a reader to work out.
    if (row.egress === "full" && row.effect === "irreversible") {
      push(
        "HIGH_BLAST_RADIUS",
        "suspicion",
        key,
        "irreversible with full egress: the rows where an under-declaration costs most. Nothing here can check the declaration is honest - audit which tools are bound to this row",
      );
    }
  }

  // ---- coverage -------------------------------------------------------------------------------
  for (const c of ALL_CAPABILITIES) {
    if (policy[c] === undefined) {
      push(
        "MISSING_CAPABILITY",
        "contradiction",
        c,
        "declared in ALL_CAPABILITIES and absent from the policy. decide() fails closed on it, so every action naming it is refused",
      );
    }
  }

  return out;
}

/** Contradictions only. What a startup check or a CI gate should refuse to run with. */
export const contradictions = (findings: readonly ManifestFinding[]): readonly ManifestFinding[] =>
  findings.filter((f) => f.severity === "contradiction");

export function formatManifestFindings(findings: readonly ManifestFinding[]): string {
  if (findings.length === 0) return "  no findings: every structural rule is satisfied.";
  const lines: string[] = [];
  for (const sev of ["contradiction", "suspicion"] as const) {
    const mine = findings.filter((f) => f.severity === sev);
    if (mine.length === 0) continue;
    lines.push(`  ${sev.toUpperCase()}S (${mine.length})`);
    for (const f of mine) lines.push(`    ${f.capability.padEnd(22)}${f.code}\n      ${f.detail}`);
    lines.push("");
  }
  lines.push(
    "  A manifest with no contradictions is CONSISTENT, not TRUE. Nothing here can detect a tool",
    "  declared weaker than it is - measured at 32/32 on the imported data-stealing split - because",
    "  nothing inside such a declaration contradicts anything else inside it.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// Diffing two manifests
// ---------------------------------------------------------------------------------------------

export interface ManifestChange {
  readonly capability: string;
  readonly what: string;
  readonly from: string;
  readonly to: string;
  /** True when the change WIDENS what untrusted content may do. */
  readonly loosening: boolean;
}

/**
 * What changed, and which way.
 *
 * A capability table is configuration, and configuration is reviewed by whoever is on rotation at the
 * time. A one-word diff - `CLEAN` to `TOOL_DERIVED` on one role of one row - is the smallest edit
 * that fully disables containment for a capability, and it looks like nothing in a pull request.
 * This exists so a review can be about the loosenings rather than about spotting them.
 */
export function diffPolicies(
  before: CapabilityPolicy,
  after: CapabilityPolicy,
): readonly ManifestChange[] {
  const out: ManifestChange[] = [];
  const add = (capability: string, what: string, from: string, to: string, loosening: boolean) => {
    out.push({ capability, what, from, to, loosening });
  };

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[key as Capability];
    const a = after[key as Capability];
    if (b === undefined && a !== undefined) {
      add(key, "row added", "absent", "present", true);
      continue;
    }
    if (b !== undefined && a === undefined) {
      // Removing a row is TIGHTENING: decide() fails closed on a capability it cannot find.
      add(key, "row removed", "present", "absent", false);
      continue;
    }
    if (b === undefined || a === undefined) continue;

    if (b.effect !== a.effect) {
      add(key, "effect", b.effect, a.effect, rankEffect(a.effect) < rankEffect(b.effect));
    }
    if (b.egress !== a.egress) {
      add(key, "egress", b.egress, a.egress, rankEgress(a.egress) < rankEgress(b.egress));
    }
    if (b.defaultCeiling !== a.defaultCeiling) {
      add(
        key,
        "defaultCeiling",
        b.defaultCeiling,
        a.defaultCeiling,
        rank(a.defaultCeiling) > rank(b.defaultCeiling),
      );
    }
    for (const role of ALL_PARAM_ROLES) {
      const bc = ceilingFor(b, role);
      const ac = ceilingFor(a, role);
      if (bc !== ac) add(key, `ceiling ${role}`, bc, ac, rank(ac) > rank(bc));
    }
    if (b.requiresConfirmation !== a.requiresConfirmation) {
      add(
        key,
        "requiresConfirmation",
        String(b.requiresConfirmation),
        String(a.requiresConfirmation),
        b.requiresConfirmation && !a.requiresConfirmation,
      );
    }
    if ((b.draftOnly ?? false) !== (a.draftOnly ?? false)) {
      add(
        key,
        "draftOnly",
        String(b.draftOnly ?? false),
        String(a.draftOnly ?? false),
        a.draftOnly === true,
      );
    }
    const bl = [...b.liftableBy].sort().join(",");
    const al = [...a.liftableBy].sort().join(",");
    if (bl !== al)
      add(key, "liftableBy", bl || "(none)", al || "(none)", a.liftableBy.size > b.liftableBy.size);
    const bt = (b.tuplePolicies ?? [])
      .map((t) => t.id)
      .sort()
      .join(",");
    const at = (a.tuplePolicies ?? [])
      .map((t) => t.id)
      .sort()
      .join(",");
    if (bt !== at) {
      add(
        key,
        "tuplePolicies",
        bt || "(none)",
        at || "(none)",
        (a.tuplePolicies ?? []).length < (b.tuplePolicies ?? []).length,
      );
    }
  }
  return out;
}

const rankEffect = (e: string): number => ["none", "reversible", "irreversible"].indexOf(e);
const rankEgress = (e: string): number => ["none", "metadata", "full"].indexOf(e);

export function formatPolicyDiff(changes: readonly ManifestChange[]): string {
  if (changes.length === 0) return "  no change.";
  const loosenings = changes.filter((c) => c.loosening);
  const lines: string[] = [];
  if (loosenings.length > 0) {
    lines.push(`  LOOSENINGS (${loosenings.length}) - each widens what untrusted content may do`);
    for (const c of loosenings) {
      lines.push(`    ${c.capability.padEnd(22)}${c.what}: ${c.from} -> ${c.to}`);
    }
    lines.push("");
  }
  const rest = changes.filter((c) => !c.loosening);
  if (rest.length > 0) {
    lines.push(`  TIGHTENINGS AND NEUTRAL CHANGES (${rest.length})`);
    for (const c of rest) {
      lines.push(`    ${c.capability.padEnd(22)}${c.what}: ${c.from} -> ${c.to}`);
    }
  }
  return lines.join("\n");
}
