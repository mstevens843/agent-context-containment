// Print the policy frontier. See packages/conformance/src/frontier.ts for what it can and cannot say.
import { classify } from "../packages/classifier/dist/index.js";
import { formatFrontier, frontier, loadSplit } from "../packages/conformance/dist/index.js";
const root = new URL("../corpus/", import.meta.url).pathname;
const names = ["holdout", "holdout_v2", "tuning", "derived", "adaptive", "imported"];
const splits = names.map((split) => ({ split, cases: loadSplit(root + split, split) }));
console.log(
  formatFrontier(
    frontier({ splits, classifier: { name: "ported production detector", classify } }),
  ),
);
