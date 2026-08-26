// Print the adversarial planner's generated agent runs. See packages/conformance/src/planner.ts.
import { formatPlans, runPlans } from "../packages/conformance/dist/index.js";
console.log(formatPlans(runPlans()));
