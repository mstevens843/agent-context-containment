// Run the review workflows. See packages/conformance/src/toolrun.ts for what the harness models.
import {
  REVIEW_WORKFLOWS,
  formatWorkflows,
  runWorkflow,
} from "../packages/conformance/dist/index.js";
console.log(formatWorkflows(REVIEW_WORKFLOWS.map(runWorkflow)));
