// Public surface of the conformance suite.

export {
  type ContainmentPolicy,
  type ContainmentRequest,
  type ContainmentResponse,
  type TextClassifier,
  requestOf,
} from "./ports.js";

export { loadSplit } from "./load.js";

export {
  MUTANTS,
  denylistInside,
  effectOnly,
  modelLaunders,
  noJoin,
  paranoid,
  reference,
  schemaIsTrust,
} from "./mutants.js";

export {
  type CaseResult,
  type Report,
  defineContainmentSuite,
  formatReport,
  runCorpus,
} from "./run.js";
