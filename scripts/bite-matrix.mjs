#!/usr/bin/env node
// The mutant bite matrix, per split, reported rather than summarised.
//
// A mutant is BITTEN by a split when it gets a case wrong there. Two numbers matter and they pull in
// opposite directions:
//
//   0 bites   the mutant models a defect nothing in the corpus exercises. It is untested machinery,
//             and the suite reports it as discriminated - which is the failure recorded three times
//             in docs/DEFECTS_FOUND.md (sections 4, 11, 14).
//   ALL bites the mutant is BLUNT. It fails everything, which proves the suite is a tripwire rather
//             than a measurement. `M5 paranoid` is deliberately blunt on attacks and must NOT be on
//             benign cases - that asymmetry is what makes it informative.
//
// The interesting mutants sit in between and bite in specific places. Which places is the report.
import { classify } from "../packages/classifier/dist/index.js";
import { MUTANTS, loadSplit, runCorpus } from "../packages/conformance/dist/index.js";

const root = new URL("../corpus/", import.meta.url).pathname;
const NAMES = ["holdout", "holdout_v2", "tuning", "derived", "adaptive", "imported"];
const splits = NAMES.map((split) => ({ split, cases: loadSplit(root + split, split) }));
const baseline = { name: "ported production detector", classify };

const bites = (policy, cases) =>
  runCorpus({ cases, policy, classifier: baseline }).results.filter((r) => {
    if (r.outOfScope) return false;
    if (r.groundTruth === "attack") return !r.containmentRefused;
    // A benign case the case itself EXPECTED to escalate is a correct answer, not a bite. Counting
    // it as one penalises the confirmation design and rewards an engine that never asks a human -
    // the same inversion as defect §4, where a by-class reporter counted refusals instead of correct
    // answers and therefore rewarded over-blocking.
    return r.containmentRefused && r.escalatedAsExpected !== true;
  }).length;

const rule = "=".repeat(100);
console.log(rule);
console.log("mutant bite matrix - where each deliberately-broken engine gets it wrong");
console.log(rule);
console.log("");
console.log(
  `  ${"mutant".padEnd(38)}${NAMES.map((n) => n.slice(0, 9).padStart(11)).join("")}${"total".padStart(9)}`,
);
console.log(`  ${"-".repeat(96)}`);

const rows = [];
for (const m of MUTANTS) {
  const per = splits.map((s) => bites(m, s.cases));
  const total = per.reduce((a, b) => a + b, 0);
  rows.push({ name: m.name, per, total });
  console.log(
    `  ${m.name.padEnd(38)}${per.map((n) => String(n).padStart(11)).join("")}${String(total).padStart(9)}`,
  );
}

const inScope = splits.reduce(
  (n, s) =>
    n +
    runCorpus({ cases: s.cases, policy: MUTANTS[0], classifier: baseline }).results.filter(
      (r) => !r.outOfScope,
    ).length,
  0,
);
console.log("");
console.log(`  ${"-".repeat(96)}`);
const ref = rows.find((r) => r.name.startsWith("M0"));
const problems = [];
if ((ref?.total ?? 0) !== 0)
  problems.push(
    `M0 reference is bitten ${ref?.total} time(s) - it is the control and must be bitten by nothing`,
  );
for (const r of rows.slice(1)) {
  if (r.total === 0)
    problems.push(`${r.name} is bitten by NOTHING - it models a defect no case exercises`);
  if (r.total >= inScope)
    problems.push(
      `${r.name} is bitten by EVERYTHING - blunt, so it proves the suite is a tripwire`,
    );
}
if (problems.length === 0) {
  console.log(
    `  Every mutant is bitten somewhere and none is bitten everywhere (${inScope} in-scope cases).`,
  );
  console.log(
    "  M0 reference is bitten by nothing, which is what makes the rest of the column mean",
  );
  console.log("  something: the corpus is not simply hostile to every engine.");
} else {
  for (const p of problems) console.log(`  PROBLEM: ${p}`);
}
console.log("");
console.log(
  "  A mutant bitten in ONE place is the strongest kind: it isolates one defect, and the",
);
console.log(
  "  split that bites it names which evidence covers that defect. A mutant bitten in every",
);
console.log("  place tells you only that the corpus contains attacks.");
console.log(rule);
process.exit(problems.length === 0 ? 0 : 1);
