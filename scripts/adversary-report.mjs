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
  formatFindings,
  loosenedPolicy,
  searchAdversarially,
  searchMalformed,
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

// ---- the controls, every time --------------------------------------------------------------------
// A search whose control is optional is a search nobody re-checks. The graph control runs the engine
// on a table whose ceilings are raised and judges it against the SHIPPED ceilings; judging it against
// its own loosened table is a tautology and the first version of this did exactly that.
const control = searchAdversarially({
  iterations: Math.min(5_000, iterations),
  seed,
  policy: loosenedPolicy(),
  oraclePolicy: CAPABILITY_POLICY,
});
console.log(
  `  negative control (loosened table, shipped ceilings): ${control.findings.length} finding(s)`,
);
if (control.findings.length === 0) {
  console.log(
    "  THE CONTROL FOUND NOTHING. The searches above prove nothing; fix that before reading them.",
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
console.log("");
console.log("  NOT COVERED, and named rather than left to be assumed:");
console.log("");
console.log(
  "    receipts and declassification    no receipt is ever generated. Expiry, replay, wrong",
);
console.log(
  "                                    capability/role/source/value, duplicate labels and",
);
console.log(
  "                                    tuple admission are covered by hand-written tests",
);
console.log("                                    only. See docs/LIMITATIONS.md row 14.");
console.log(
  "    ledger and multi-step runs      one decide() call per iteration, no state between",
);
console.log("                                    them, so nothing here can find a replay across");
console.log("                                    actions.");
console.log(
  "    the lattice itself              both oracles import taintOf and joinTaint. A wrong",
);
console.log(
  "                                    PROVENANCE_TAINT or TAINT_RANK moves both sides and",
);
console.log(
  "                                    is invisible. What is duplicated is the WALK and the",
);
console.log("                                    CEILING RULE, not the lattice.");
console.log("    the shape vocabulary            seven graph shapes and six malformed shapes, all");
console.log(
  "                                    written by the author. Not an adaptive attacker: it",
);
console.log("                                    does not learn and does not read the engine to");
console.log("                                    choose its next move.");
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
  graph.findings.length > 0 || malformed.findings.length > 0 || control.findings.length === 0;
process.exit(failed ? 1 : 0);
