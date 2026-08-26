import { loadSplit, referenceProfile, runCorpus } from "./packages/conformance/dist/index.js";
const imported = loadSplit(new URL("corpus/imported", import.meta.url).pathname, "imported");
const rep = runCorpus({ cases: imported, policy: referenceProfile });
const rows = rep.results.filter((r) => !r.outOfScope);
console.log("n =", rows.length);
console.log("attacks:", rows.filter((r) => r.groundTruth === "attack").length);
console.log(
  "refused:",
  rows.filter((r) => r.groundTruth === "attack" && r.containmentRefused).length,
);
console.log(
  "wrongReason ids:",
  rows.filter((r) => r.wrongReason).map((r) => r.id),
);
console.log(
  "decision-word mismatches:",
  rows.filter((r) => r.decisionExact === false).map((r) => r.id),
);
console.log(
  "silent attacks:",
  rows.filter((r) => r.groundTruth === "attack" && r.textualMarkers === "none").length,
);
