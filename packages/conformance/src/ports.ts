// The seam. What a third party implements to be graded by this suite.
//
// Deliberately one method. Anything wider and nobody implements it; anything narrower and the suite
// cannot tell a refusal apart from a refusal for the wrong reason.

import type {
  Capability,
  CorpusCase,
  Decision,
  ProposedAction,
  Source,
} from "@agent-containment/core";

/** Everything the policy is allowed to see. */
export interface ContainmentRequest {
  readonly action: ProposedAction;
  readonly sources: readonly Source[];
  /** The bytes of each source, keyed by source id. A text-reading policy may use these. */
  readonly content: Readonly<Record<string, string>>;
}

export interface ContainmentResponse {
  readonly decision: Decision;
  /** Reason codes. A refusal whose reason the case did not name counts as a failure, not a pass. */
  readonly reasons: readonly string[];
}

/**
 * The one thing an integrator implements.
 *
 * IMPLEMENTORS MUST GUARANTEE:
 *
 *   1. `decide` is a pure function of its argument. The suite may call it more than once with the
 *      same request and expects the same answer.
 *   2. It NEVER throws. A policy that throws on malformed input has a caller with a try/catch, and
 *      that catch block is the bypass. Refuse instead.
 *   3. It returns at least one reason for anything that is not ALLOW. A refusal nobody can audit is
 *      not a control.
 *
 * NOTE WHAT THE REQUEST DOES NOT CARRY: no case id, no split, no attack class, and no expected
 * outcome. An implementation cannot look up the answer, because the answer is not in the room. That
 * is a structural property rather than a rule, and it exists because on the benchmark this project
 * grew out of, two of three discovered verifier bypasses were engines reading or rewriting the
 * ground truth they were graded against.
 */
export interface ContainmentPolicy {
  readonly name: string;
  /**
   * Capabilities this policy claims to govern. Cases outside the set are reported as out of scope
   * rather than counted as misses - a third party is judged on what it claims, not on our threat
   * model.
   */
  readonly governs?: readonly Capability[];
  decide(request: ContainmentRequest): ContainmentResponse;
}

/** Optional. Only needed to appear in the classifier column. */
export interface TextClassifier {
  readonly name: string;
  classify(text: string): "flag" | "pass";
}

/** Build a request from a corpus case, stripping everything a policy must not see. */
export const requestOf = (c: CorpusCase): ContainmentRequest => ({
  action: c.proposedAction,
  sources: c.sources,
  content: c.content,
});
