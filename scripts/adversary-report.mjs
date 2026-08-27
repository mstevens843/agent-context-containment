#!/usr/bin/env node
// The property searches, run longer than the suite can afford, for a human who wants to push on them.
//
//   pnpm adversary                 100k graph decisions + 50k malformed, default seeds
//   pnpm adversary -- 500000 1234  iterations and seed
//
// The suite runs a few thousand of each on fixed seeds, because a test that takes a minute gets
// skipped. This exists so the number can be raised deliberately.
//
// A CLEAN RUN IS NOT A PROOF OF ABSENCE. It is a statement about the space explored, which is why
// this prints the iteration count, the shape histogram, and - since section 31 - an explicit list of
// what each search DOES and DOES NOT cover. The previous version printed neither, and its file
// header claimed coverage of two defects it could not reach.

import {
  everyRuleLiftsPolicy,
  formatFindings,
  loosenedPolicy,
  receiptSearchScope,
  searchAdversarially,
  searchMalformed,
  searchReceipts,
} from "../packages/conformance/dist/index.js";
import { CAPABILITY_POLICY } from "../packages/core/dist/index.js";

const iterations = Number(process.argv[2] ?? 100_000);
const seed = Number(process.argv[3] ?? 0xc0ffee);
const malformedIterations = Math.max(1_000, Math.floor(iterations / 2));

const rule = (s) => console.log("=".repeat(96), s === undefined ? "" : `\n${s}`);

console.log("=".repeat(96));
console.log(
  "adversarial property search - structures nobody wrote, checked against independent oracles",
);
console.log("=".repeat(96));
console.log("");

// ---- search 1: provenance graphs over well-formed requests ---------------------------------------
const graph = searchAdversarially({ iterations, seed });
console.log(
  `  GRAPH SEARCH   seed 0x${seed.toString(16)}   ${graph.explored} decisions   ${graph.cleanExplored} fully clean`,
);
for (const [shape, n] of Object.entries(graph.shapes).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${shape.padEnd(18)} ${String(n).padStart(8)}`);
}
console.log(`  findings: ${graph.findings.length}`);
if (graph.findings.length > 0) console.log(formatFindings(graph));
console.log("");

// ---- search 2: malformed requests ----------------------------------------------------------------
const malformed = searchMalformed({ iterations: malformedIterations, seed });
console.log(
  `  MALFORMED SEARCH   ${malformed.explored} decisions   ${malformed.cleanExplored} genuinely malformed`,
);
for (const [shape, n] of Object.entries(malformed.shapes).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${shape.padEnd(18)} ${String(n).padStart(8)}`);
}
console.log(`  findings: ${malformed.findings.length}`);
if (malformed.findings.length > 0) console.log(formatFindings(malformed));
console.log("");

// ---- search 3: receipts ----------------------------------------------------------------------
const receipts = searchReceipts({ iterations: malformedIterations, seed });
console.log(
  // `cleanExplored` IS the admission count for this search. The first version printed its
  // COMPLEMENT and so over-reported the search's reach by about six times, on every run.
  `  RECEIPT SEARCH   ${receipts.explored} decisions   ${receipts.cleanExplored} reached admission`,
);
for (const [shape, n] of Object.entries(receipts.shapes).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${shape.padEnd(18)} ${String(n).padStart(8)}`);
}
console.log(`  findings: ${receipts.findings.length}`);
if (receipts.findings.length > 0) console.log(formatFindings(receipts));
console.log("");

// ---- the controls, every time, and NAMED for what each one proves --------------------------------
//
// A search whose control is optional is a search nobody re-checks. Each control runs a deliberately
// broken engine and judges it against the SHIPPED table; judging it against its own broken table is a
// tautology and the first version of this did exactly that.
//
// THEY ARE SEPARATED BECAUSE THEY PROVE DIFFERENT THINGS, and one line reporting "the control" let a
// ceiling control stand in for a binding one for a release. See DEFECTS_FOUND.md section 38.
const controlIters = Math.min(5_000, iterations);

const ceilingControl = searchAdversarially({
  iterations: controlIters,
  seed,
  policy: loosenedPolicy(),
  oraclePolicy: CAPABILITY_POLICY,
});
console.log(
  `  CEILING control    (every ceiling raised, judged against the shipped table)   ${String(ceilingControl.findings.length).padStart(5)} finding(s)`,
);
console.log(
  "                     proves: the graph search detects a CEILING breach. It does NOT exercise",
);
console.log("                     receipts at all - a loosened engine never needs one.");

// Ceilings untouched, so a receipt is still required; only rule acceptance is broken.
const bindingControl = searchReceipts({
  iterations: controlIters,
  seed,
  policy: everyRuleLiftsPolicy(),
  oraclePolicy: CAPABILITY_POLICY,
});
console.log(
  `  BINDING control    (every rule accepted, ceilings as shipped)                 ${String(bindingControl.findings.length).padStart(5)} finding(s)`,
);
console.log(
  "                     proves: the receipt search detects a receipt admitted under a rule its row",
);
console.log(
  "                     does not lift by. This is the half the ceiling control cannot reach.",
);

// NO RUNNABLE CONTROL, AND SAYING SO RATHER THAN INVENTING ONE. Malformedness is structural: it does
// not depend on the table, so no policy this script can build makes the engine mishandle it.
// Measured, so nobody re-derives it: a loosened table gives the malformed search zero findings.
const malformedControl = searchMalformed({
  iterations: controlIters,
  seed,
  policy: loosenedPolicy(),
});
console.log(
  `  MALFORMED control  (no policy can break structural validity - measured)       ${String(malformedControl.findings.length).padStart(5)} finding(s)`,
);
console.log(
  "                     its control is `pnpm audit:mutations`, entries `decide-is-total` and",
);
console.log(
  "                     `receipt-elements-validated`, which delete the gate and require this search",
);
console.log("                     to go red. Not something this script can run.");

const deadControls = [
  ["CEILING", ceilingControl],
  ["BINDING", bindingControl],
].filter(([, c]) => c.findings.length === 0);
for (const [name, _c] of deadControls) {
  console.log("");
  console.log(
    `  THE ${name} CONTROL FOUND NOTHING. The search it licenses proves nothing; fix that first.`,
  );
}
console.log("");

// ---- what is covered, and what is not -------------------------------------------------------------
rule();
console.log("  COVERED, each verified by reintroducing the mutation and counting findings:");
console.log("");
console.log(
  "    section 23  a diamond mis-resolving to the top of the lattice   graph, taint_mismatch",
);
console.log(
  "    section 25  an unrecognised role collecting the loosest ceiling  graph, under_block",
);
console.log("    section 24  decide throwing, or allowing a malformed request     malformed, both");
console.log("    section 32  a null receipt element reaching coverFor             malformed, both");
console.log(
  "    section 34  one receipt admitting two arguments (P05)            receipts, under_block",
);
console.log(
  "    ---         the role half of receipt binding                     receipts, under_block",
);
console.log(
  "    ---         receipt expiry                                       receipts, under_block",
);
console.log("");
console.log("  NOT COVERED, and named rather than left to be assumed:");
console.log("");
// DERIVED FROM THE TABLE, NOT TYPED HERE. The hardcoded version of these four lines said the
// search ran on "four of the ten" rows and named payment, wallet_sign, account_modify and
// transaction_broadcast as never generated. Two of those four ARE searched, and have been since
// confirming rows were brought in. `receiptSearchScope` computed the true answer the whole time
// and nothing called it, so the function and the sentence drifted apart with no check between
// them. Printing the computed value is the fix; the drift could not have survived it.
// See DEFECTS_FOUND.md section 37.
const scope = receiptSearchScope(CAPABILITY_POLICY);
console.log(
  `    receipt search scope            ${scope.searched.length} of the ${scope.searched.length + scope.excluded.length} capability rows. Searched:`,
);
console.log(`                                    ${scope.searched.join(", ")}.`);
console.log("                                    Excluded, and why:");
for (const e of scope.excluded) {
  console.log(`                                      ${e.row.padEnd(22)} ${e.why}`);
}
console.log(
  "    ledger adapters                 spentReceipts is a Set this process builds, not a database.",
);
console.log(
  "                                    Cross-host replay and the async reserve/settle protocol are",
);
console.log(
  "                                    covered by prove:crosshost, prove:asyncledger and",
);
console.log("                                    prove:postgres, not by any search here.");
console.log(
  "    multi-step runs                 one decide() call per iteration, no state carried between",
);
console.log(
  "                                    them, so a replay ACROSS actions is only modelled by",
);
console.log(
  "                                    pre-seeding spentReceipts, never by a run reaching it.",
);
console.log(
  "    the lattice itself              every oracle here imports taintOf and joinTaint. A wrong",
);
console.log(
  "                                    PROVENANCE_TAINT or TAINT_RANK moves both sides and is",
);
console.log(
  "                                    invisible - measured: setting WEB to CLEAN leaves all three",
);
console.log(
  "                                    searches at zero findings while 57 other tests fail. What is",
);
console.log(
  "                                    duplicated is the WALK and the CEILING RULE, not the lattice.",
);
console.log(
  "    the capability table's data     oracleCeiling restates the RULE but reads roleCeilings off",
);
console.log(
  "                                    the same row the engine reads, so widening a ceiling in the",
);
console.log("                                    shipped table is invisible to the search.");
console.log(
  "    the shape vocabulary            seven graph, six malformed and fifteen receipt shapes, all",
);
console.log(
  "                                    written by the author. Not an adaptive attacker: it does not",
);
console.log(
  "                                    learn and does not read the engine to choose its next move.",
);
console.log("");
console.log(
  "  A clean run means no property violation was found in the space explored. It does not",
);
console.log(
  "  mean none exists. It is a wider net than the corpus, not a proof, and it is still one",
);
console.log("  author's net.");
rule();

const failed =
  graph.findings.length > 0 ||
  malformed.findings.length > 0 ||
  receipts.findings.length > 0 ||
  deadControls.length > 0;
process.exit(failed ? 1 : 0);
