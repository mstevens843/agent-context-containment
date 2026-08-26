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
  type ProposedCall,
  type StepOutcome,
  type ToolSpec,
  type WorkflowStepTrace,
  type Workflow,
  type WorkflowResult,
  formatWorkflows,
  runWorkflow,
} from "./toolrun.js";

export {
  type Evidence,
  type FieldMeaning,
  type ReviewDecision,
  type ReviewField,
  type ReviewReason,
  type ReviewRequest,
  render,
  review,
} from "./reviewer.js";

export { DISHONEST_BINDINGS, HONEST_BINDINGS } from "./bindings.js";

export { REVIEW_WORKFLOWS } from "./workflows.js";

export { HAND_WRITTEN_SCENARIOS } from "./scenarios.js";

export {
  type PlanShape,
  type PlannerReport,
  ALL_PLAN_SHAPES,
  formatPlans,
  generatePlans,
  runPlans,
} from "./planner.js";

export {
  type FrontierClaim,
  type FrontierPoint,
  type FrontierReport,
  formatFrontier,
  frontier,
  frontierClaims,
} from "./frontier.js";

export {
  type Cell,
  type CrossPolicyReport,
  crossPolicy,
  formatCrossPolicy,
} from "./crosspolicy.js";

export {
  POLICY_TABLES,
  PROFILES,
  PROFILE_INTENT,
  egressStrictProfile,
  escalatingProfile,
  permissiveProfile,
  referenceProfile,
  strictProfile,
} from "./profiles.js";

export {
  type AlternativeKind,
  type CaseMapping,
  type MappingFile,
  type SensitivityResult,
  formatSensitivity,
  sensitivity,
} from "./mapping.js";

export {
  type PlannedStep,
  type RunReport,
  type RunResult,
  type Scenario,
  type StepTrace,
  formatRuns,
  runScenario,
  runScenarios,
} from "./agentrun.js";

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
  type CoverageCell,
  type ProbeResult,
  attackSurface,
  coverageCells,
  coveredByCorpus,
  formatCoverage,
  generateAll,
  launder,
  probeSurface,
  releaseValves,
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
  argNameOnlyBinding,
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
