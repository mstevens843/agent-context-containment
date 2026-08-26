#!/usr/bin/env node
// Run the cross-host proof. Optionally verify the constraint against a real Postgres first.
//
// Two things are being checked and they are NOT the same thing:
//
//   1. ADAPTER LOGIC - that every decision routes through one atomic operation and never through a
//      read-then-write. Checked against an in-process store with UNIQUE-constraint semantics. Runs
//      everywhere, needs nothing, and is what CI runs.
//
//   2. THE DATABASE'S BEHAVIOUR - that this specific Postgres accepts the schema and that
//      `ON CONFLICT ... DO NOTHING RETURNING` really does tell exactly one caller it won. Runs only
//      with DATABASE_URL, and only if `pg` happens to be installed. `pg` is deliberately not a
//      dependency of this repository: a native driver has no business in the path of a policy
//      decision.
//
// Neither proves the thing a deployment actually needs - that YOUR hosts share ONE database. That is
// a fact about infrastructure and no test in this repository can reach it, which is why
// `sharedAcrossHosts` is a question the caller answers rather than something the adapter infers.
//
//   node scripts/prove-crosshost.mjs
//   DATABASE_URL=postgres://... node scripts/prove-crosshost.mjs

import {
  POSTGRES_SCHEMA,
  crossHostProven,
  durableLedger,
  fakeTransactionalStore,
  formatCrossHostProof,
  postgresSpendStore,
  proveCrossHost,
} from "../packages/ledger/dist/index.js";

// ---- 2. the database, if one was offered -----------------------------------------------------
const url = process.env.DATABASE_URL;
if (url) {
  let pg;
  try {
    pg = (await import("pg")).default;
  } catch {
    console.log("DATABASE_URL is set but `pg` is not installed here - it is not a dependency.");
    console.log("Skipping the database check; the logic proof below still runs.\n");
  }
  if (pg) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query(POSTGRES_SCHEMA);
    await client.query("DELETE FROM containment_spent_receipts WHERE receipt = 'crosshost-probe'");
    const sql =
      "INSERT INTO containment_spent_receipts (receipt, spent_at, action_id) VALUES ('crosshost-probe', $1, $2) ON CONFLICT (receipt) DO NOTHING RETURNING receipt";
    const first = await client.query(sql, [1, "winner"]);
    const second = await client.query(sql, [2, "loser"]);
    const kept = await client.query(
      "SELECT action_id FROM containment_spent_receipts WHERE receipt = 'crosshost-probe'",
    );
    await client.query("DELETE FROM containment_spent_receipts WHERE receipt = 'crosshost-probe'");
    await client.end();

    const ok =
      first.rowCount === 1 && second.rowCount === 0 && kept.rows[0]?.action_id === "winner";
    console.log("DATABASE CHECK");
    console.log(`  schema applied            ${POSTGRES_SCHEMA.split("\n")[0]} ...`);
    console.log(`  first insert  rows=${first.rowCount}   (must be 1: this caller recorded it)`);
    console.log(`  second insert rows=${second.rowCount}   (must be 0: somebody else already had)`);
    console.log(
      `  row kept      ${kept.rows[0]?.action_id}   (must be "winner": a duplicate must not rewrite history)`,
    );
    console.log(
      ok
        ? "  PASS - this database gives the adapter the atomicity it needs.\n"
        : "  FAIL - this database does NOT give the adapter the atomicity it needs.\n",
    );
    if (!ok) process.exit(1);
  }
}

// ---- 1. the adapter's logic ------------------------------------------------------------------
// Run through the Postgres ADAPTER, not just the raw store, so the SQL path is what gets proven.
const rows = new Map();
const query = (sqlText, params) => {
  if (sqlText.startsWith("INSERT INTO")) {
    const k = String(params[0]);
    if (rows.has(k)) return [];
    rows.set(k, { receipt: k, spentAt: Number(params[1]), actionId: String(params[2]) });
    return [{ receipt: k }];
  }
  if (sqlText.startsWith("SELECT 1")) return rows.has(String(params[0])) ? [{ ok: 1 }] : [];
  return [...rows.values()].map((r) => ({
    receipt: r.receipt,
    spent_at: r.spentAt,
    action_id: r.actionId,
  }));
};
const connect = () => postgresSpendStore({ query, sharedAcrossHosts: true });

console.log("ADAPTER LOGIC PROOF");
const proofs = proveCrossHost(connect);
console.log(formatCrossHostProof(proofs));

const proven = crossHostProven(proofs);
const ledger = durableLedger({ store: connect(), verifiedCrossHost: proven });
console.log("");
console.log(`  ledger.guarantees.crossHostSafe = ${ledger.guarantees.crossHostSafe}`);
console.log(`  ${ledger.guarantees.caveat}`);

// And the control: the same proof against a store that reads then writes must REFUSE it.
const broken = proveCrossHost(() => fakeTransactionalStore(new Map()));
console.log("");
console.log(
  `  control: an unshared store's claim -> crossHostSafe = ${
    durableLedger({ store: fakeTransactionalStore(), verifiedCrossHost: crossHostProven(broken) })
      .guarantees.crossHostSafe
  }`,
);
console.log("  (it passes the interleavings and still does not get the claim, because a single");
console.log(
  "   process is not several hosts - the claim needs BOTH the proof and a shared store.)",
);
process.exit(proven ? 0 : 1);
