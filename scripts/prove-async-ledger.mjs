#!/usr/bin/env node
// Prove the reservation protocol. Against a real Postgres if one is offered, otherwise not at all.
//
// THREE CLAIMS, and this script is careful to keep them apart because conflating them is how a
// reassuring number gets printed for something nobody checked:
//
//   1. ADAPTER LOGIC       every decision routes through one atomic operation; refusals release;
//                          consumed receipts never come back. Checked in-process, runs everywhere,
//                          and is what CI runs.
//   2. DATABASE BEHAVIOUR  this specific Postgres serialises the reservation, so exactly one of two
//                          genuinely concurrent connections wins. Needs DATABASE_URL and `pg`.
//   3. DEPLOYMENT TOPOLOGY that YOUR hosts share ONE database. NOT PROVABLE HERE, by anything, ever.
//
// Without DATABASE_URL this reports claim 2 as SKIPPED / NOT PROVEN. It does not report it as
// passing, and it does not quietly leave it out: an absent proof that looks like a green line is
// worse than no proof, because somebody will cite it.
//
//   node scripts/prove-async-ledger.mjs
//   DATABASE_URL=postgres://... node scripts/prove-async-ledger.mjs

import {
  POSTGRES_ASYNC_SCHEMA,
  checkAsyncLedger,
  formatAsyncChecks,
  memoryAsyncLedger,
  postgresAsyncLedger,
} from "../packages/ledger/dist/index.js";

const TABLE = "containment_receipt_reservations";
let exitCode = 0;

// ---- 1. adapter logic -------------------------------------------------------------------------
console.log("1. ADAPTER LOGIC  (in-process, no database required)");
const shared = new Map();
const logic = await checkAsyncLedger(() => memoryAsyncLedger(shared));
console.log(formatAsyncChecks(logic));
if (logic.some((c) => !c.passed)) exitCode = 1;

// ---- 2. the database, if one was offered -------------------------------------------------------
console.log("");
console.log("2. DATABASE BEHAVIOUR  (needs DATABASE_URL and `pg`)");
const url = process.env.DATABASE_URL;
let pg;
if (url) {
  try {
    pg = (await import("pg")).default;
  } catch {
    console.log("  SKIPPED / NOT PROVEN - DATABASE_URL is set but `pg` is not installed here.");
    console.log("  `pg` is deliberately not a dependency: a native driver has no business in the");
    console.log("  path of a policy decision. Install it in your own project to run this.");
  }
}
if (url) {
  console.log("  DATABASE_URL is set. The database half lives in its own script, because it needs");
  console.log("  independent connections and a negative control:");
  console.log("");
  console.log("      pnpm prove:postgres");
  console.log("");
  console.log("  Reporting it here would mean reporting a result this script did not produce.");
} else {
  console.log("  SKIPPED / NOT PROVEN - DATABASE_URL is not set.");
  console.log("  This is NOT a pass. Nothing below has been checked against a real database:");
  console.log("    - that the schema applies");
  console.log(
    "    - that ON CONFLICT ... RETURNING names exactly one winner under real concurrency",
  );
  console.log("    - that a consumed row survives a reconnect");
  console.log("  Run `DATABASE_URL=postgres://... pnpm prove:postgres` to check them.");
}
// ---- 3. what nothing here can prove ------------------------------------------------------------
console.log("");
console.log("3. DEPLOYMENT TOPOLOGY");
console.log(
  "  NOT PROVABLE HERE. An adapter proof is not a topology proof. A Postgres in a container",
);
console.log(
  "  on one laptop passes everything above and is not cross-host; so does a per-pod sidecar,",
);
console.log(
  "  which is worse, because it looks shared and is not. Whether YOUR hosts point at ONE",
);
console.log(
  "  database is a fact about infrastructure, which is why `sharedAcrossHosts` is a question",
);
console.log("  the caller answers rather than something the adapter infers.");
process.exit(exitCode);
