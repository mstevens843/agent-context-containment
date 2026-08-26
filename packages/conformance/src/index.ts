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
  type Task,
  type TaskReport,
  type TaskResult,
  type TaskStep,
  formatTasks,
  runTask,
  runTasks,
} from "./tasks.js";

export {
  type LaunderingTransform,
  TRANSFORMS,
  generateAll,
  launder,
} from "./generate.js";

export {
  type SplitMetrics,
  type UtilityMetrics,
  compareAll,
  formatUtility,
  utilityFor,
  formatComparison,
  metricsFor,
} from "./compare.js";

export {
  MUTANTS,
  denylistInside,
  effectOnly,
  modelLaunders,
  noJoin,
  oneHopOnly,
  paranoid,
  receiptBearerToken,
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
