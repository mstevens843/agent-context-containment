// The seam. What a third party implements to be graded by this suite.
//
// Deliberately one method. Anything wider and nobody implements it; anything narrower and the suite
// cannot tell a refusal apart from a refusal for the wrong reason.

import {
  type Capability,
  type CorpusCase,
  type CorpusReceiptSpec,
  type Decision,
  type ProposedAction,
  type ReceiptEvidence,
  type Source,
  admitAllowlistMember,
  admitAttestedToolOutput,
  admitCleanSelection,
  admitEchoOfClean,
  admitNumericEnvelope,
  admitUserConfirmedValue,
  sourceId,
} from "@agent-context-containment/core";

/** Everything the policy is allowed to see. */
export interface ContainmentRequest {
  readonly action: ProposedAction;
  readonly sources: readonly Source[];
  /** The bytes of each source, keyed by source id. A text-reading policy may use these. */
  readonly content: Readonly<Record<string, string>>;
  /** Declassifications the caller obtained. Empty for the overwhelming majority of cases. */
  readonly receipts: readonly ReceiptEvidence[];
  /** Whether a human confirmed this action. */
  readonly confirmed: boolean;
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
 *      that catch block is the bypass. Refuse instead. This is a REQUIREMENT ON YOUR ENGINE and the
 *      suite cannot check it for you - it drives the cases it was given, not every malformed shape.
 *      The shipped engine is asserted by `packages/core/test/total.test.ts`; yours needs its own.
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

/**
 * Mint a receipt by calling the real rule the case names.
 *
 * Deliberately not a cast of the spec into a receipt shape. The point of the declarative form is
 * that the corpus exercises the rules: if `admitUserConfirmedValue` stops rejecting a bidi override,
 * or `admitAllowlistMember` starts returning the input instead of the matched member, a corpus case
 * goes red. A case carrying a pre-built receipt object would test none of that.
 *
 * A rule that refuses returns `undefined`, and the receipt simply does not exist - which is itself a
 * meaningful outcome a case can assert, since a refused mint means the action must be refused too.
 */
function mint(spec: CorpusReceiptSpec): ReceiptEvidence | undefined {
  const slot = {
    capability: spec.capability,
    role: spec.role,
    argName: spec.argName,
    // Carried through so a case can bind a receipt to a SLOT rather than a label. Omitted when the
    // case does not say, which is the common and correct shape for an unambiguous label.
    ...(spec.argPath !== undefined ? { argPath: spec.argPath } : {}),
    lifts: spec.lifts,
    // A fixed scope. Corpus cases are about the POLICY, and a per-case nonce or clock would make the
    // suite non-deterministic for no gain. Replay, expiry and source binding are exercised directly
    // in packages/core/test/replay.test.ts, where a caller-supplied clock and ledger belong.
    scope: {
      nonce: `corpus-${spec.argPath ?? spec.argName}`,
      issuedAt: 0,
      expiresAt: spec.expiresAt ?? null,
      source: spec.boundToSource !== undefined ? sourceId(spec.boundToSource) : null,
    },
  } as const;
  switch (spec.rule) {
    case "user_confirmed_value":
      return admitUserConfirmedValue({
        ...slot,
        candidate: spec.candidate,
        presented: spec.presented,
      });
    case "allowlist_member":
      return admitAllowlistMember({
        ...slot,
        candidate: spec.candidate,
        allowlist: spec.allowlist,
      });
    case "echo_of_clean":
      return admitEchoOfClean({ ...slot, candidate: spec.candidate, cleanValue: spec.cleanValue });
    case "clean_selection":
      return admitCleanSelection({ ...slot, index: spec.index, collection: spec.collection });
    case "attested_tool_output":
      return admitAttestedToolOutput({
        ...slot,
        candidate: spec.candidate,
        attestation: {
          keyId: spec.keyId,
          subject: spec.subject,
          purpose: { capability: spec.capability, role: spec.role },
        },
        // The stand-in verifier. Real signature checking belongs in a host, not in a corpus fixture.
        verify: (a) => spec.trustedKeys.includes(a.keyId),
      });
    case "numeric_envelope":
      return admitNumericEnvelope({
        ...slot,
        candidate: spec.candidate,
        low: spec.low,
        high: spec.high,
        granularity: spec.granularity,
      });
  }
}

/** Build a request from a corpus case, stripping everything a policy must not see. */
export const requestOf = (c: CorpusCase): ContainmentRequest => ({
  action: c.proposedAction,
  sources: c.sources,
  content: c.content,
  receipts: (c.receipts ?? []).map(mint).filter((r): r is ReceiptEvidence => r !== undefined),
  confirmed: c.confirmed === true,
});
