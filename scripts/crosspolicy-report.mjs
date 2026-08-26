// Print every split against every policy profile. See packages/conformance/src/crosspolicy.ts.
import { classify } from "../packages/classifier/dist/index.js";
import { crossPolicy, formatCrossPolicy, loadSplit } from "../packages/conformance/dist/index.js";
const root = new URL("../corpus/", import.meta.url).pathname;
const names = ["holdout", "holdout_v2", "tuning", "derived", "adaptive", "imported"];
const splits = names.map((split) => ({ split, cases: loadSplit(root + split, split) }));
console.log(
  formatCrossPolicy(
    crossPolicy({ splits, classifier: { name: "ported production detector", classify } }),
  ),
);
