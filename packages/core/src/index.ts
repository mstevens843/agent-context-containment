// The public API. A curated barrel, not `export *`: this list IS the surface, and anything not
// named here is free to change without a major bump.

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
  type Codomain,
  type Declassification,
  type Shape,
  admitAllowlistMember,
  admitCleanSelection,
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
  type CorpusViolation,
  type CorpusViolationCode,
  type ExpectedOutcome,
  type HoldoutCaseId,
  type Split,
  type TextualMarkers,
  type TuningCaseId,
  checkCorpus,
  formatCorpusViolations,
  holdoutCaseId,
  isCorpusValid,
  tuningCaseId,
} from "./corpus.js";
