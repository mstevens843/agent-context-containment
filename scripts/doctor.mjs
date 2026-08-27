#!/usr/bin/env node
// Deployment posture, read off what is already declared.
//
// WHAT THIS IS NOT: a runtime self-check, a health probe, or anything that inspects a running system.
// It adds no engine feature and infers nothing. It reads the declarations and the guarantees that
// already exist and puts them on one screen, because the facts an adopter needs before shipping are
// currently spread across five commands and three documents.
//
// Everything it prints is a fact somebody DECLARED plus a consequence that follows from it. Where the
// answer depends on a deployment, it says so rather than guessing.
//
//   pnpm doctor

import {
  DISHONEST_BINDINGS,
  HONEST_BINDINGS,
  POLICY_TABLES,
} from "../packages/conformance/dist/index.js";
import {
  CAPABILITY_POLICY,
  contradictions,
  semanticRisks,
  validatePolicy,
} from "../packages/core/dist/index.js";
import {
  durableLedger,
  fakeTransactionalStore,
  jsonFileLedger,
  lockingFileLedger,
  memoryAsyncLedger,
  memoryLedger,
} from "../packages/ledger/dist/index.js";

const rule = "=".repeat(96);
console.log(rule);
console.log("deployment doctor - what is declared, and what follows from it");
console.log(rule);

// ---- capability tables ---------------------------------------------------------------------------
console.log("\n  CAPABILITY TABLES");
for (const [name, table] of POLICY_TABLES) {
  const f = validatePolicy(table);
  const c = contradictions(f).length;
  console.log(
    `    ${name.padEnd(16)}${String(c).padStart(2)} contradiction(s)   ${String(f.length - c).padStart(2)} advisory suspicion(s)`,
  );
}
const shipped = validatePolicy(CAPABILITY_POLICY);
const blast = shipped.filter((f) => f.code === "HIGH_BLAST_RADIUS").map((f) => f.capability);
console.log(
  "\n    AUDIT THESE FIRST - irreversible with full egress, where a wrong binding costs most:",
);
console.log(`      ${blast.join(", ")}`);
console.log(
  "      Which of your tools are bound to these rows is the highest-leverage question in",
);
console.log("      a deployment, and nothing here can answer it for you.");

// ---- tool bindings -------------------------------------------------------------------------------
console.log("\n  TOOL BINDINGS - advisory naming heuristics");
for (const [label, b] of [
  ["honest examples", HONEST_BINDINGS],
  ["lazy mis-bindings", DISHONEST_BINDINGS],
]) {
  const r = semanticRisks(b, CAPABILITY_POLICY);
  console.log(`    ${label.padEnd(20)}${b.length} binding(s) -> ${r.length} advisory finding(s)`);
}
console.log(
  "\n    Run `semanticRisks(yourBindings, yourPolicy)` on YOUR tools. Zero findings means",
);
console.log(
  "    nothing was named oddly - a fact about vocabulary, not about behaviour. A tool called",
);
console.log("    `fetchStatus` that quietly POSTs your inbox produces no finding and never will.");

// ---- ledger posture ------------------------------------------------------------------------------
console.log("\n  LEDGER ADAPTERS - what each CLAIMS to survive");
const disk = new Map();
const fakeFs = {
  readFile: (p) => disk.get(p),
  writeAtomic: (p, c) => disk.set(p, c),
  tryCreateExclusive: () => true,
  remove: () => {},
  ageMs: () => undefined,
};
const adapters = [
  ["memoryLedger", memoryLedger()],
  [
    "jsonFileLedger",
    jsonFileLedger({ path: "/x", readFile: () => undefined, writeFile: () => {} }),
  ],
  ["lockingFileLedger", lockingFileLedger({ path: "/y", fs: fakeFs, now: () => 0 })],
  ["durableLedger (unproven)", durableLedger({ store: fakeTransactionalStore() })],
  ["memoryAsyncLedger", memoryAsyncLedger()],
];
console.log(
  `    ${"adapter".padEnd(26)}${"1proc".padEnd(7)}${"1host".padEnd(7)}${"xhost".padEnd(7)}${"crash".padEnd(7)}reclaim`,
);
const yn = (b) => (b ? "yes" : "no").padEnd(7);
for (const [name, l] of adapters) {
  const g = l.guarantees;
  console.log(
    `    ${name.padEnd(26)}${yn(g.singleProcess)}${yn(g.singleHost)}${yn(g.crossHostSafe)}${yn(g.crashSafe)}${g.staleLockReclaim ? "yes" : "no"}`,
  );
}
console.log(
  "\n    These are CLAIMS, not proofs - nothing verifies them, and an adapter that lies is",
);
console.log(
  "    trusted exactly as much as its author. `createGuard({ requireGuarantees })` turns a",
);
console.log(
  "    mismatch with your topology into a startup failure instead of a silent regression.",
);

// ---- stale reclaim ---------------------------------------------------------------------------------
console.log("\n  STALE RECLAIM - and why no value is free");
const l = memoryAsyncLedger(new Map(), { staleAfterMs: 1_000 });
await l.reserve(["r-abandoned"], "crashed", 0);
await l.consume(await l.reserve(["r-done"], "finished", 0), 0);
const early = await l.stats(500);
const late = await l.stats(9_999);
console.log(
  `    at t=500   reserved=${early.reserved} consumed=${early.consumed} stranded=${early.stranded}`,
);
console.log(
  `    at t=9999  reserved=${late.reserved} consumed=${late.consumed} stranded=${late.stranded}`,
);
console.log("\n    A crash between reserve and consume strands a receipt: unusable, and NOT");
console.log(
  "    double-spendable, which is the safe direction. `staleAfterMs` too long strands it",
);
console.log(
  "    until it expires; too short and a slow-but-alive caller loses a reservation it was",
);
console.log(
  "    about to consume - and THAT direction is a double-spend. `stats(now)` exists so the",
);
console.log("    choice has visible consequences. `staleAfterMs: null` is safer and permanent.");

// ---- what is not checked ----------------------------------------------------------------------------
console.log("");
console.log(rule);
console.log("  WHAT THIS CANNOT SEE");
console.log(rule);
console.log("    - whether your declared provenance matches where the bytes came from");
console.log("    - whether a tool does what its capability row says (21/30 and 32/32, measured)");
console.log("    - whether your hosts share one database");
console.log("    - anything about a running system: this reads declarations, not processes");
console.log("");
console.log("    See docs/TRUST_BOUNDARIES.md for what is enforced, declared, and unreachable.");
console.log(rule);
