// A reviewer that decides, rather than one told what to decide.
//
// Until v0.9 a scenario carried `review: { approves: true }` and the harness branched on it. That
// proved the receipt PATH - minting, slot binding, value binding, the tuple gate, the burn, the
// replay refusal - and every bit of it is real. None of it was judgement. The scenario was telling
// itself the answer.
//
// THE STRUCTURAL IDEA, and it is what keeps this from being the policy engine written twice:
//
//   THE ENGINE GETS LABELS AND NOT BYTES.   `DecisionInput` carries `Source = {id, provenance}` with
//                                           no text. `decide()` never reads a character of content.
//   THE REVIEWER GETS BYTES AND NOT LABELS. It sees what a human would see - the values, the
//                                           evidence, the consequence in prose - and it is denied
//                                           `Taint`, `ceilingFor`, `CAPABILITY_POLICY`, the verdict
//                                           and the reasons.
//
// That complementarity is free: it already holds in the type system. And it means the two can
// DISAGREE, which is the only condition under which running both proves anything. A reviewer that
// refuses exactly what containment refuses is the same decision made twice.
//
// `reviewer.contract.test.ts` enforces the denial structurally, the way `contract.test.ts` enforces
// the purity of the core - by scanning this file for the vocabulary it must not contain.

import type { Provenance } from "@agent-containment/core";

/** What a field MEANS, in the words a dialog would use. Deliberately not the engine's role names. */
export type FieldMeaning = "who or where" | "how much" | "which" | "what content" | "a flag";

export interface ReviewField {
  readonly name: string;
  readonly means: FieldMeaning;
  readonly value: string | undefined;
  /** Which source the value was drawn from. Origin IDENTITY - never its rank in the lattice. */
  readonly fromId: string;
  readonly fromKind: Provenance;
}

export interface Evidence {
  readonly id: string;
  readonly kind: Provenance;
  /** The actual bytes. The engine never sees these; the reviewer sees nothing else. */
  readonly text: string;
}

export interface ReviewRequest {
  readonly step: string;
  readonly tool: string;
  /** The row's own `approvalBoundary`, as opaque prose. A consequence, not a threshold. */
  readonly consequence: string;
  /** Rendered from (tool, consequence, fields). NOT authored by the scenario - see `render`. */
  readonly presented: string;
  readonly fields: readonly ReviewField[];
  /** Fields the renderer showed as ONE decision. Whether to ratify them together is still a choice. */
  readonly asOne: readonly string[];
  readonly evidence: readonly Evidence[];
}

export type ReviewReason =
  | "value_matches_the_users_own_request"
  | "value_appears_only_in_content_from_elsewhere"
  | "value_appears_nowhere_i_was_shown"
  | "combination_never_shown_together"
  | "content_is_not_a_destination";

export type ReviewDecision =
  | { readonly verdict: "approve_each"; readonly fields: readonly string[] }
  /** A SEPARATE answer. Ratifying two values individually is not ratifying the pair. */
  | { readonly verdict: "approve_together"; readonly fields: readonly string[] }
  | { readonly verdict: "reject"; readonly because: ReviewReason }
  /**
   * The answer a yes/no reviewer cannot give, and the one a real person gives most.
   *
   * Without it, a reviewer forced to choose says yes - which is how approval dialogs become
   * click-through. It is not a refusal and it is not an approval: it stalls, and the stall is
   * counted.
   */
  | { readonly verdict: "cannot_tell"; readonly because: ReviewReason };

/** Sources a reviewer treats as the principal's own words. Identity, not rank. */
const PRINCIPAL: ReadonlySet<Provenance> = new Set<Provenance>(["USER", "SYSTEM"]);

/**
 * Token-boundary containment, not substring.
 *
 * `includes` would let "acct-1" match "acct-19", which is the confused-deputy bug in miniature and
 * exactly the sort of near-match a hurried human also misses. Numbers compare numerically so that
 * `89` matches `89.00` - a reviewer who rejected a refund because the dialog said `89` and the field
 * said `89.00` would be wrong, and pedantry that produces wrong answers is not rigour.
 */
function mentions(text: string, value: string, numeric: boolean): boolean {
  if (value === "") return false;
  if (numeric) {
    const want = Number(value.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(want)) {
      for (const tok of text.match(/-?[\d,]+(?:\.\d+)?/g) ?? []) {
        if (Number(tok.replace(/,/g, "")) === want) return true;
      }
      return false;
    }
  }
  const tokens = text.split(/[\s,;:()[\]{}"'<>]+/).filter((t) => t !== "");
  return tokens.some((t) => t === value || t.replace(/[.!?]+$/, "") === value);
}

/**
 * Render the question a human is shown.
 *
 * DERIVED, not authored, and that is the point. When the scenario wrote this string it supplied both
 * the question and the answer, and `admitUserConfirmedValue`'s "the presented text must contain the
 * candidate" check was really checking the author's typing. Generating it here makes that a check on
 * the renderer, which is a thing that can be wrong.
 */
export function render(tool: string, consequence: string, fields: readonly ReviewField[]): string {
  const parts = fields
    .filter((f) => f.value !== undefined)
    .map((f) => `${f.name} = ${f.value ?? ""}`);
  return `${tool}: ${consequence} Confirm ${parts.join(" and ")}?`;
}

/**
 * Decide, from what a person would have.
 *
 * The rules, in order, and each is a thing a careful human actually does:
 *
 *   1. A value they cannot find anywhere they were shown -> `cannot_tell`. Not a rejection: they do
 *      not know, and a reviewer who guesses in either direction is worse than one who escalates.
 *   2. A "who or where" or "how much" value that appears ONLY in content from somewhere else ->
 *      reject. This is the self-authorization shape: the untrusted text naming its own destination.
 *   3. A value that matches the principal's own words -> approve that field.
 *   4. Content fields are never destinations and are approved on that basis alone.
 *   5. Ratifying the combination is a SEPARATE question, answered only when the values were shown
 *      together AND each is individually approvable.
 */
export function review(request: ReviewRequest): ReviewDecision {
  const fromPrincipal = request.evidence.filter((e) => PRINCIPAL.has(e.kind));
  const fromElsewhere = request.evidence.filter((e) => !PRINCIPAL.has(e.kind));

  const steering = request.fields.filter(
    (f) => f.means === "who or where" || f.means === "how much",
  );

  for (const f of steering) {
    if (f.value === undefined) continue;
    const numeric = f.means === "how much";
    const inPrincipal = fromPrincipal.some((e) => mentions(e.text, f.value ?? "", numeric));
    const inElsewhere = fromElsewhere.some((e) => mentions(e.text, f.value ?? "", numeric));

    if (!inPrincipal && !inElsewhere) {
      return { verdict: "cannot_tell", because: "value_appears_nowhere_i_was_shown" };
    }
    if (!inPrincipal && inElsewhere) {
      // The whole attack, seen from the reviewer's chair: a destination that exists only in the
      // message asking for it.
      return { verdict: "reject", because: "value_appears_only_in_content_from_elsewhere" };
    }
  }

  const approved = request.fields.filter((f) => f.value !== undefined).map((f) => f.name);

  // The combination is its own decision. Two values each approved individually is exactly the
  // situation the tuple gate exists for, and a reviewer who ratifies the pair by default has
  // answered a question nobody asked.
  if (request.asOne.length > 1) {
    const shownTogether = fromPrincipal.some((e) =>
      request.asOne.every((n) => {
        const f = request.fields.find((x) => x.name === n);
        return f?.value !== undefined && mentions(e.text, f.value, f.means === "how much");
      }),
    );
    if (!shownTogether) {
      return { verdict: "cannot_tell", because: "combination_never_shown_together" };
    }
    return { verdict: "approve_together", fields: request.asOne };
  }

  return { verdict: "approve_each", fields: approved };
}
