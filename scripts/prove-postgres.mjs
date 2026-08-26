#!/usr/bin/env node
// The real-database half of the async-ledger proof.
//
// `prove-async-ledger.mjs` checks the ADAPTER'S LOGIC in-process, and reports the database half as
// SKIPPED / NOT PROVEN. This is that half. It needs a live Postgres and it uses TWO INDEPENDENT
// CONNECTIONS - not one client issuing two statements, which the client would serialise for you and
// which would prove nothing about what the database does.
//
//   DATABASE_URL=postgres://localhost/containment_ledger_test node scripts/prove-postgres.mjs
//
// `pg` is a devDependency OF THE ROOT WORKSPACE ONLY. It is not a dependency of any published
// package, and `packages/ledger` still builds and ships without it - the adapter takes a query
// function, not a driver. A native module has no business in the path of a policy decision, and
// keeping it here rather than there is what makes that claim true rather than aspirational.
//
// WHAT THIS STILL CANNOT PROVE: that YOUR hosts share ONE database. That is a fact about
// infrastructure and no test in this repository can reach it.

import { POSTGRES_ASYNC_SCHEMA, postgresAsyncLedger } from "../packages/ledger/dist/index.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("postgres proof: SKIPPED / NOT PROVEN - DATABASE_URL is not set.");
  console.log("");
  console.log(
    "  This is NOT a pass. None of the following has been checked against a real database:",
  );
  console.log("    - the schema applies");
  console.log("    - two concurrent connections racing one receipt produce exactly one winner");
  console.log("    - a consumed receipt survives a reconnect");
  console.log("    - a stale reservation is reclaimable and a consumed one never is");
  console.log("    - a read-then-write adapter loses the race, as the negative control");
  console.log("");
  console.log(
    "  DATABASE_URL=postgres://localhost/containment_ledger_test node scripts/prove-postgres.mjs",
  );
  process.exit(0);
}

let pg;
try {
  pg = (await import("pg")).default;
} catch {
  console.log("postgres proof: SKIPPED / NOT PROVEN - `pg` is not installed here.");
  console.log(
    "  It is a root devDependency, never a package dependency. `pnpm install` at the root.",
  );
  process.exit(0);
}

const TABLE = "containment_receipt_reservations";
const results = [];
const check = async (name, fn) => {
  let detail;
  try {
    detail = await fn();
  } catch (e) {
    detail = `threw: ${e instanceof Error ? e.message : String(e)}`;
  }
  results.push({ name, passed: detail === "", detail });
};

const connect = async () => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
};

const a = await connect();
const b = await connect();
for (const stmt of POSTGRES_ASYNC_SCHEMA.split(";").filter((s) => s.trim() !== "")) {
  await a.query(stmt);
}
const clean = () => a.query(`DELETE FROM ${TABLE} WHERE receipt LIKE 'pgproof-%'`);
await clean();

let n = 0;
const ledgerOn = (client, opts = {}) =>
  postgresAsyncLedger({
    query: async (sql, params) => (await client.query(sql, params)).rows,
    sharedAcrossHosts: true,
    newReservationId: () => `pgproof-res-${++n}`,
    ...opts,
  });

// ---- 1. concurrent reserve: exactly one winner ------------------------------------------------
await check("two connections race one receipt: exactly one reserves it", async () => {
  const key = "pgproof-race";
  const [x, y] = await Promise.all([
    ledgerOn(a).reserve([key], "conn-a", Date.now()),
    ledgerOn(b).reserve([key], "conn-b", Date.now()),
  ]);
  const winners = [x, y].filter((r) => r.reserved.length === 1).length;
  return winners === 1 ? "" : `${winners} connections claimed the same receipt; exactly one must`;
});

// ---- 2. a burst, because two is a small sample -------------------------------------------------
await check("twenty concurrent claims on one receipt: exactly one wins", async () => {
  const key = "pgproof-burst";
  const clients = await Promise.all(Array.from({ length: 20 }, () => connect()));
  const claims = await Promise.all(
    clients.map((c, i) => ledgerOn(c).reserve([key], `conn-${i}`, Date.now())),
  );
  await Promise.all(clients.map((c) => c.end()));
  const winners = claims.filter((r) => r.reserved.length === 1).length;
  if (winners !== 1) return `${winners} of 20 connections were told they won; exactly one must be`;
  const rows = (await a.query(`SELECT count(*)::int AS n FROM ${TABLE} WHERE receipt = $1`, [key]))
    .rows[0].n;
  return rows === 1 ? "" : `${rows} rows exist for one receipt`;
});

// ---- 3. replay across processes ----------------------------------------------------------------
await check("a consumed receipt cannot be reserved by another connection", async () => {
  const key = "pgproof-consume";
  const la = ledgerOn(a);
  await la.consume(await la.reserve([key], "conn-a", Date.now()), Date.now());
  const again = await ledgerOn(b).reserve([key], "conn-b", Date.now());
  return again.alreadySpent.length === 1 ? "" : "a consumed receipt was reserved again - replay";
});

// ---- 4. crash / restart ------------------------------------------------------------------------
await check("a consumption survives a fresh connection (restart)", async () => {
  const key = "pgproof-restart";
  const la = ledgerOn(a);
  await la.consume(await la.reserve([key], "conn-a", Date.now()), Date.now());
  const c = await connect();
  const spent = await ledgerOn(c).isSpent(key);
  await c.end();
  return spent ? "" : "a newly-connected process cannot see an earlier consumption";
});

await check("a RESERVED row survives a crash and stays unclaimable until it is stale", async () => {
  // The crash this models: a process reserves, then dies before consuming. The receipt must not be
  // silently reusable - that would be the double-spend - and it must not be lost forever either.
  const key = "pgproof-crash";
  const crashed = await connect();
  await ledgerOn(crashed).reserve([key], "will-crash", Date.now());
  await crashed.end(); // the crash: no consume, no release, connection gone
  const survivor = await ledgerOn(b).reserve([key], "survivor", Date.now());
  return survivor.alreadySpent.length === 1
    ? ""
    : "an abandoned reservation was immediately reusable - a crash must not re-arm a receipt";
});

// ---- 5. stale reclaim, and its boundary --------------------------------------------------------
await check("a stale reservation is reclaimable after staleAfterMs", async () => {
  const key = "pgproof-stale";
  const now = Date.now();
  await ledgerOn(a, { staleAfterMs: 1000 }).reserve([key], "abandoned", now - 10_000);
  const reclaimed = await ledgerOn(b, { staleAfterMs: 1000 }).reserve([key], "later", now);
  return reclaimed.reserved.length === 1 ? "" : "an abandoned reservation was never reclaimable";
});

await check("a CONSUMED receipt is never reclaimed, however old", async () => {
  // The direction that would be a double-spend, and it looks exactly like cleanup.
  const key = "pgproof-consumed-old";
  const now = Date.now();
  const la = ledgerOn(a, { staleAfterMs: 1000 });
  await la.consume(await la.reserve([key], "finished", now - 10_000), now - 10_000);
  const attempt = await ledgerOn(b, { staleAfterMs: 1000 }).reserve([key], "replay", now);
  return attempt.alreadySpent.length === 1
    ? ""
    : "a consumed receipt was reclaimed as if abandoned - this is a double-spend";
});

await check("with reclaim disabled, an abandoned reservation stays abandoned", async () => {
  const key = "pgproof-noreclaim";
  const now = Date.now();
  await ledgerOn(a, { staleAfterMs: null }).reserve([key], "abandoned", now - 10_000_000);
  const attempt = await ledgerOn(b, { staleAfterMs: null }).reserve([key], "later", now);
  return attempt.alreadySpent.length === 1
    ? ""
    : "reclaim was disabled and a reservation was reclaimed anyway";
});

// ---- 6. release ---------------------------------------------------------------------------------
await check("a released receipt is available to another connection", async () => {
  const key = "pgproof-release";
  const la = ledgerOn(a);
  await la.release(await la.reserve([key], "conn-a", Date.now()));
  const again = await ledgerOn(b).reserve([key], "conn-b", Date.now());
  return again.reserved.length === 1
    ? ""
    : "a released receipt stayed held - a refusal destroyed it";
});

await check("one connection cannot release another's reservation", async () => {
  const key = "pgproof-forge";
  await ledgerOn(a).reserve([key], "conn-a", Date.now());
  await ledgerOn(b).release({ id: "not-mine", reserved: [key], alreadySpent: [] });
  const still = await ledgerOn(b).reserve([key], "conn-c", Date.now());
  return still.alreadySpent.length === 1 ? "" : "a forged handle freed somebody's receipt";
});

// ---- 7. THE NEGATIVE CONTROL --------------------------------------------------------------------
await check("NEGATIVE CONTROL: a read-then-write adapter loses the race", async () => {
  // A proof that cannot fail is decoration. This is the same database, the same concurrency, and an
  // adapter that does SELECT-then-INSERT instead of one atomic statement. It must double-claim.
  const key = "pgproof-negative";
  const naive = (client) => async () => {
    const seen = await client.query(`SELECT 1 FROM ${TABLE} WHERE receipt = $1`, [key]);
    // The window. On a real database with two real connections, this is where the other one lands.
    await new Promise((r) => setTimeout(r, 25));
    if (seen.rows.length > 0) return "lost";
    await client.query(
      `INSERT INTO ${TABLE} (receipt, state, reservation_id, at, action_id)
       VALUES ($1, 'reserved', $2, $3, 'naive') ON CONFLICT (receipt) DO NOTHING`,
      [key, `naive-${Math.round(performance.now())}`, Date.now()],
    );
    return "won";
  };
  const [x, y] = await Promise.all([naive(a)(), naive(b)()]);
  const winners = [x, y].filter((r) => r === "won").length;
  return winners === 2
    ? ""
    : `the naive adapter was told it won ${winners} time(s); it must win twice, or this proof cannot fail`;
});

for (const r of results) {
  console.log(
    `  ${r.passed ? "pass" : "FAIL"}  ${r.name}${r.passed ? "" : `\n        ${r.detail}`}`,
  );
}
const failed = results.filter((r) => !r.passed).length;
console.log("");
console.log(
  failed === 0
    ? `  ${results.length}/${results.length} - PROVEN against a real Postgres, with independent connections.`
    : `  ${failed} of ${results.length} FAILED against this database.`,
);
console.log("");
console.log("  STILL NOT PROVEN: that YOUR hosts share ONE database. That is a fact about");
console.log("  infrastructure, which is why `sharedAcrossHosts` is a question the adapter asks.");

await clean();
await Promise.all([a.end(), b.end()]);
process.exit(failed === 0 ? 0 : 1);
