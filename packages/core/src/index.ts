// The public API. A curated barrel, not `export *`: this list IS the surface, and anything not
// named here is free to change without a major bump.
//
// ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
// │  READ THIS BEFORE CALLING `decide` DIRECTLY.                                                 │
// │                                                                                              │
// │  `decide` takes `now` and `spentReceipts` as OPTIONAL arguments. Omit them and you silently  │
// │  get no expiry checking and unlimited receipt reuse: one human confirmation authorises a     │
// │  retry loop, forever, and nothing warns you. Every test still passes.                        │
// │                                                                                              │
// │  This package cannot fix that. It reads no clock and holds no state - properties the design  │
// │  rests on, enforced by `test/contract.test.ts` - and a pure function cannot own a ledger.    │
// │                                                                                              │
// │  So use the guard instead:                                                                   │
// │                                                                                              │
// │      import { createGuard } from "@agent-context-containment/ledger";                                │
// │      const guard = createGuard({ clock: () => Date.now() });                                 │
// │      guard.decide({ action, sources, receipts });                                            │
// │                                                                                              │
// │  Its input type declares both fields as `never`, so forgetting them is a COMPILE ERROR.      │
// │                                                                                              │
// │  Reach for the raw engine in three cases, all of which are about controlling time and the    │
// │  ledger deliberately: writing a checker, replaying an audit log against a past policy, and   │
// │  testing. Everywhere else it is the wrong tool. See docs/INTEGRATION.md.                     │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘

export {
  // ---- identifiers
  type ActionId,
  type ConfirmationId,
  type ReceiptId,
  type SourceId,
  type ValueId,
  actionId,
  confirmationId,
  receiptId,
  sourceId,
  valueId,
  // ---- provenance and taint
  type Provenance,
  type Taint,
  ALL_PROVENANCES,
  PROVENANCE_TAINT,
  joinTaint,
  taintAtMost,
  taintOf,
  // ---- capabilities
  type Capability,
  type EffectClass,
  type EgressClass,
  type ParamRole,
  ALL_CAPABILITIES,
  ALL_PARAM_ROLES,
  // ---- actions
  type ActionArg,
  type ProposedAction,
  type Source,
  // ---- decisions
  type Decision,
  type Effect,
  type Reason,
  type ReasonCode,
  type Verdict,
  // ---- errors
  type ContainmentErrorCode,
  type ContainmentErrorPayload,
  ContainmentError,
} from "./types.js";

export {
  type CapabilityPolicy,
  type CapabilityRow,
  type DeclassificationRule,
  type DecisionInput,
  type ReceiptEvidence,
  type RoleCeilings,
  ALL_DECLASSIFICATION_RULES,
  CAPABILITY_POLICY,
  ceilingFor,
  slotsOf,
  decide,
  decisionOf,
} from "./policy.js";

export {
  type Tainted,
  type TaintLabel,
  clean,
  joinLabels,
  tainted,
} from "./taint.js";

export {
  type Attestation,
  type AttestationVerifier,
  type Codomain,
  type TupleEntry,
  type ReceiptScope,
  type Declassification,
  type Shape,
  admitAllowlistMember,
  admitAttestedToolOutput,
  admitCleanSelection,
  admitConfirmedTuple,
  admitEchoOfClean,
  admitNumericEnvelope,
  admitUserConfirmedValue,
  bitsOfChoice,
  declassifyShape,
} from "./declassify.js";

export {
  type CheckOptions,
  type DecisionRecord,
  type Violation,
  type ViolationCode,
  checkContainment,
  formatViolations,
  isContained,
} from "./check.js";

export {
  type AttackClass,
  type CaseId,
  type CaseSource,
  type CorpusCase,
  type CorpusReceiptSpec,
  type CorpusViolation,
  type CorpusViolationCode,
  type ExpectedOutcome,
  type HoldoutCaseId,
  type Split,
  ALL_SPLITS,
  SPLIT_INFIX,
  type TextualMarkers,
  type TuningCaseId,
  checkCorpus,
  formatCorpusViolations,
  holdoutCaseId,
  isCorpusValid,
  tuningCaseId,
} from "./corpus.js";

// ---------------------------------------------------------------------------------------------
// The advanced surface
// ---------------------------------------------------------------------------------------------

import type { DecisionInput, Verdict } from "./index.js";
import { type CapabilityPolicy, decide as decideRaw } from "./policy.js";

/**
 * The raw engine, namespaced so that reaching for it is a visible act.
 *
 * `advanced.decide` is the same function as the top-level `decide`. Both are exported: the flat one
 * because removing it would break every existing caller for no safety gain, and this one because
 * `advanced.decide(...)` reads differently in a diff than `decide(...)` does. A reviewer skimming a
 * pull request sees the word.
 *
 * That is the whole mechanism, and it is worth being honest about its size: this is a NAMING
 * convention, not a barrier. Nothing stops anyone importing the flat export. What stops the
 * *accident* is the guard's type, in `@agent-context-containment/ledger` - this only stops the accident
 * being invisible.
 *
 * YOU ARE RESPONSIBLE FOR `now` AND `spentReceipts` when you call this. Omitting them is legal,
 * silent, and disables replay and expiry protection entirely.
 */
export {
  type Ingested,
  IngestError,
  contextOf,
  derivedOutput,
  fromDocument,
  fromEmail,
  fromExternalApi,
  fromRetrieval,
  fromSystem,
  fromToolOutput,
  fromUser,
  fromWeb,
  ingestionCoverage,
} from "./ingest.js";

export {
  type ToolBinding,
  type ToolRisk,
  formatToolRisks,
  semanticRisks,
} from "./toolrisk.js";

export {
  type ManifestChange,
  type ManifestFinding,
  type ManifestSeverity,
  contradictions,
  diffPolicies,
  formatManifestFindings,
  formatPolicyDiff,
  validatePolicy,
} from "./manifest.js";

export const advanced: {
  readonly decide: (input: DecisionInput, policy?: CapabilityPolicy) => Verdict;
} = {
  decide: decideRaw,
};
