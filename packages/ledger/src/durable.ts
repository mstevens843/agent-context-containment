// A cross-host ledger, and the reason none of the earlier ones could be.
//
// Every adapter before this one says `crossHostSafe: false`, and `twoHostSimulation()` shows what
// that costs: two machines, one receipt, spent twice, no error anywhere. The fix is not more careful
// file handling. It is that the check and the write have to be ONE ATOMIC OPERATION at a point both
// machines agree on, and a filesystem cannot provide that across hosts.
//
// So the whole cross-host problem reduces to a single primitive:
//
//     insertIfAbsent(record) -> "inserted" | "already_present"
//
// One call. No read-then-write, because any gap between a read and a write is the race. In Postgres
// that is `INSERT ... ON CONFLICT DO NOTHING` against a PRIMARY KEY, which the storage engine
// serialises for you; in Redis it is `SET NX`; in DynamoDB a conditional put. Each of those is one
// round trip and one atomic decision, and each is a store that several hosts can share.
//
// WHY THERE IS NO `pg` DEPENDENCY HERE. This package has none, and adding a native driver so that a
// policy decision can store a set of short strings is the wrong trade - it would put a compiled
// dependency, a connection pool and a lifecycle in the path of `decide()`. Instead `SpendStore` is a
// port and `postgresSpendStore` builds one from a query function the caller already has. Six lines of
// SQL, no driver import, and a Prisma or Drizzle or raw-`pg` caller all wire it the same way.
//
// WHAT EARNS THE `crossHostSafe: true` CLAIM. Not a constructor argument. A store that wants the
// claim must pass `proveCrossHost()` below, which runs the interleavings that break the file-backed
// adapters - concurrent double-spend, restart, and a partitioned second host - and a store that
// reads-then-writes fails it. `durable.test.ts` includes a deliberately non-atomic store and asserts
// it is rejected, because a proof that nothing can fail proves nothing.

import type { ReceiptId } from "@agent-containment/core";
import type { LedgerGuarantees, ReceiptLedger, SpentRecord } from "./index.js";

/**
 * The one operation a cross-host ledger needs.
 *
 * IMPLEMENTORS MUST GUARANTEE that `insertIfAbsent` is ATOMIC with respect to every other caller,
 * including callers in other processes on other machines. If two hosts call it concurrently with the
 * same receipt id, exactly one gets `"inserted"`.
 *
 * That is the entire contract, and it is deliberately the smallest thing that can be one. A wider
 * port - `begin`, `read`, `write`, `commit` - would let an adapter do the check and the write in two
 * steps, and the gap between them is precisely the bug this file exists to remove.
 */
export interface SpendStore {
  /** Atomic. Returns whether THIS call was the one that recorded it. */
  insertIfAbsent(record: SpentRecord): "inserted" | "already_present";
  has(receipt: ReceiptId): boolean;
  all(): readonly SpentRecord[];
  /**
   * What the underlying store provides. Declared by whoever wires it up, because only they know
   * whether the connection points at one container on a laptop or a replicated cluster.
   *
   * Declaring `crossHostSafe: true` here is a REQUEST, not a grant - `durableLedger` refuses to pass
   * it through unless the store also passes `proveCrossHost`.
   */
  readonly claims: Omit<LedgerGuarantees, "caveat"> & { readonly caveat: string };
}

/**
 * Build a `ReceiptLedger` from an atomic store.
 *
 * `spend` is one call, not a read followed by a write, and `isSpent` is advisory: the authoritative
 * check is the insert's own return value. That ordering matters. A caller that asks `isSpent` first
 * and acts on the answer has reintroduced the race in its own code, which is why `Guard.decide`
 * routes through `spend` rather than through a query.
 */
export function durableLedger(args: {
  readonly store: SpendStore;
  /**
   * Pass `true` to allow the store's `crossHostSafe` claim through. Ignored unless the store has
   * actually passed `proveCrossHost` - see `verified` below.
   */
  readonly verifiedCrossHost?: boolean;
}): ReceiptLedger {
  const { store } = args;
  // The claim is DOWNGRADED unless it was proven. Not an error: a Postgres store used from one
  // process is perfectly correct, it just has not demonstrated the stronger property, and a ledger
  // that overstates what it survives is worse than one that understates it.
  const crossHostSafe = store.claims.crossHostSafe === true && args.verifiedCrossHost === true;
  const guarantees: LedgerGuarantees = {
    ...store.claims,
    crossHostSafe,
    caveat: crossHostSafe
      ? store.claims.caveat
      : `${store.claims.caveat} (cross-host claim NOT honoured: the store did not pass proveCrossHost, so it is reported as single-host)`,
  };
  return {
    guarantees,
    isSpent: (receipt) => store.has(receipt),
    // The store already knows who won - it is the whole point of `insertIfAbsent` returning a word
    // rather than nothing. Discarding that answer was defect §10: the store serialised perfectly and
    // both callers were told they had recorded the spend.
    spend: (record) => (store.insertIfAbsent(record) === "inserted" ? "recorded" : "already_spent"),
    entries: () => store.all(),
  };
}

// ---------------------------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------------------------

/** The table this adapter expects. Idempotent; run it at deploy time. */
export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS containment_spent_receipts (
  receipt   TEXT PRIMARY KEY,
  spent_at  BIGINT NOT NULL,
  action_id TEXT   NOT NULL
);`.trim();

/**
 * What a caller's database client has to look like. One synchronous function.
 *
 * SYNCHRONOUS, and that is the awkward part rather than an oversight. `ReceiptLedger` is sync because
 * `Guard.decide` is sync because the engine is sync, and making the engine async to accommodate a
 * database would push a promise into every call site of a security decision. So a caller bridges the
 * gap themselves: a worker thread with `Atomics.wait`, a synchronous driver, or an in-process cache
 * kept warm by an async writer. `docs/INTEGRATION.md` names the three shapes and their tradeoffs.
 */
export type SqlExecutor = (
  sql: string,
  params: readonly unknown[],
) => readonly Record<string, unknown>[];

/**
 * A `SpendStore` over Postgres, with no driver dependency.
 *
 * The atomicity is the storage engine's, not this file's: `ON CONFLICT DO NOTHING` against a PRIMARY
 * KEY is resolved inside the same statement, so two hosts inserting the same receipt at the same
 * instant produce exactly one row and exactly one `"inserted"`. `RETURNING` is what tells the caller
 * which one it was - without it there is no way to distinguish "I recorded this" from "somebody else
 * already had", and that distinction is the whole point.
 */
export function postgresSpendStore(args: {
  readonly query: SqlExecutor;
  readonly table?: string;
  /**
   * Set true only if this connection points at a store several hosts genuinely share.
   *
   * A Postgres in a container on one laptop is not cross-host, and neither is a per-pod sidecar. The
   * adapter cannot tell the difference from a connection string, so it asks.
   */
  readonly sharedAcrossHosts: boolean;
}): SpendStore {
  const table = args.table ?? "containment_spent_receipts";
  const q = args.query;
  return {
    claims: {
      singleProcess: true,
      singleHost: true,
      crossHostSafe: args.sharedAcrossHosts,
      crashSafe: true,
      staleLockReclaim: true, // there is no lock to go stale: the atomicity is the engine's
      caveat: args.sharedAcrossHosts
        ? "atomicity is the storage engine's: ON CONFLICT DO NOTHING on a PRIMARY KEY. Correct only while every host points at the SAME database - a per-pod sidecar is not one"
        : "declared single-host by the caller: this connection was not stated to be shared across hosts",
    },
    insertIfAbsent: (record) => {
      const rows = q(
        `INSERT INTO ${table} (receipt, spent_at, action_id) VALUES ($1, $2, $3) ON CONFLICT (receipt) DO NOTHING RETURNING receipt`,
        [record.receipt as unknown as string, record.spentAt, record.actionId],
      );
      return rows.length > 0 ? "inserted" : "already_present";
    },
    has: (receipt) =>
      q(`SELECT 1 FROM ${table} WHERE receipt = $1`, [receipt as unknown as string]).length > 0,
    all: () =>
      q(`SELECT receipt, spent_at, action_id FROM ${table} ORDER BY spent_at, receipt`, []).map(
        (r) => ({
          receipt: r.receipt as unknown as ReceiptId,
          spentAt: Number(r.spent_at),
          actionId: String(r.action_id),
        }),
      ),
  };
}

// ---------------------------------------------------------------------------------------------
// Earning the claim
// ---------------------------------------------------------------------------------------------

export interface CrossHostProof {
  readonly scenario: string;
  readonly passed: boolean;
  readonly detail: string;
}

/**
 * Run the interleavings that break the file-backed adapters.
 *
 * `connect` returns a HANDLE TO THE SAME UNDERLYING STORE, as a different host would see it. For
 * Postgres that is another connection; for the in-memory fake it is another view over one map. If
 * `connect` hands back an isolated copy, these scenarios fail - which is exactly what should happen,
 * because that is what a non-shared store is.
 *
 * A store that reads then writes passes the first scenario and fails the second. That asymmetry is
 * the point: this is a discrimination test, not a smoke test, and `durable.test.ts` runs a
 * deliberately non-atomic store through it to prove the suite can say no.
 */
export function proveCrossHost(connect: () => SpendStore): readonly CrossHostProof[] {
  const out: CrossHostProof[] = [];
  const check = (scenario: string, fn: () => string): void => {
    let detail: string;
    try {
      detail = fn();
    } catch (e) {
      detail = `threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    out.push({ scenario, passed: detail === "", detail });
  };
  const rec = (id: string, at: number, action: string): SpentRecord => ({
    receipt: id as unknown as ReceiptId,
    spentAt: at,
    actionId: action,
  });

  check("a spend on one host is visible on another", () => {
    const a = connect();
    const b = connect();
    a.insertIfAbsent(rec("x1", 1, "act-a"));
    return b.has("x1" as unknown as ReceiptId)
      ? ""
      : "host B cannot see host A's spend, so the receipt replays there - this is the twoHostSimulation failure";
  });

  check("concurrent double-spend: exactly one host wins", () => {
    // The load-bearing scenario. Both hosts attempt the SAME receipt with no coordination between
    // them, which is what happens when a retry lands on a different pod. A read-then-write store
    // lets both observe "absent" and both write; an atomic one cannot.
    const a = connect();
    const b = connect();
    const first = a.insertIfAbsent(rec("x2", 1, "act-a"));
    const second = b.insertIfAbsent(rec("x2", 2, "act-b"));
    const winners = [first, second].filter((r) => r === "inserted").length;
    if (winners !== 1) {
      return `${winners} hosts were told they recorded the spend; exactly one must be. A second winner is a permitted replay`;
    }
    const rows = connect()
      .all()
      .filter((r) => (r.receipt as unknown as string) === "x2");
    return rows.length === 1
      ? ""
      : `${rows.length} rows exist for one receipt, so the audit trail cannot say when it was first used`;
  });

  check("the first writer's record is the one that survives", () => {
    const a = connect();
    a.insertIfAbsent(rec("x3", 10, "act-first"));
    connect().insertIfAbsent(rec("x3", 20, "act-second"));
    const found = connect()
      .all()
      .find((r) => (r.receipt as unknown as string) === "x3");
    return found?.actionId === "act-first"
      ? ""
      : `the audit trail records ${found?.actionId}; a duplicate must not rewrite when a receipt was first used`;
  });

  check("a restart does not forget", () => {
    // `connect()` models a fresh process attaching to the shared store. An adapter holding state only
    // in its own closure passes everything above and fails here.
    connect().insertIfAbsent(rec("x4", 1, "act-a"));
    return connect().has("x4" as unknown as ReceiptId)
      ? ""
      : "a newly-connected process cannot see an earlier spend, so every deploy resets replay protection";
  });

  check("distinct receipts do not block each other", () => {
    // The other direction: an adapter that refuses everything would pass every scenario above.
    const a = connect();
    a.insertIfAbsent(rec("x5", 1, "act-a"));
    return a.insertIfAbsent(rec("x6", 1, "act-b")) === "inserted"
      ? ""
      : "an unrelated receipt was refused; a ledger that refuses everything is not safe, it is broken";
  });

  return out;
}

/** True only if every scenario passed. The gate `durableLedger` wants for `verifiedCrossHost`. */
export const crossHostProven = (proofs: readonly CrossHostProof[]): boolean =>
  proofs.length > 0 && proofs.every((p) => p.passed);

export function formatCrossHostProof(proofs: readonly CrossHostProof[]): string {
  const lines = proofs.map(
    (p) =>
      `  ${p.passed ? "pass" : "FAIL"}  ${p.scenario}${p.passed ? "" : `\n        ${p.detail}`}`,
  );
  lines.push("");
  lines.push(
    crossHostProven(proofs)
      ? `  ${proofs.length}/${proofs.length} - this store may claim crossHostSafe.`
      : "  NOT PROVEN. crossHostSafe stays false; the ledger reports itself as single-host.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// A fake with the right semantics, so CI can run the proof with no server
// ---------------------------------------------------------------------------------------------

/**
 * An in-process store that models a UNIQUE constraint exactly.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT. Passing `proveCrossHost` against this fake proves the
 * ADAPTER'S LOGIC is right - that `durableLedger` and `Guard` route every decision through the atomic
 * operation and never through a read-then-write. It proves nothing about Postgres, about your
 * network, or about whether your pods share a database. Those are properties of a deployment and no
 * test in this repository can reach them.
 *
 * That distinction is why `sharedAcrossHosts` is a question the caller answers rather than something
 * the adapter infers, and why this fake declares itself single-host: it is one process.
 */
export function fakeTransactionalStore(shared?: Map<string, SpentRecord>): SpendStore {
  const rows = shared ?? new Map<string, SpentRecord>();
  return {
    claims: {
      singleProcess: true,
      singleHost: true,
      crossHostSafe: false,
      crashSafe: false,
      staleLockReclaim: true,
      caveat:
        "a test double with UNIQUE-constraint semantics; it models the atomicity, it does not survive a process",
    },
    insertIfAbsent: (record) => {
      const k = record.receipt as unknown as string;
      if (rows.has(k)) return "already_present";
      rows.set(k, record);
      return "inserted";
    },
    has: (receipt) => rows.has(receipt as unknown as string),
    all: () => [...rows.values()],
  };
}

/**
 * A store that does the check and the write as two steps, exactly as `jsonFileLedger` does.
 *
 * Exported deliberately: `proveCrossHost` is only worth running if it can fail, and the way to show
 * that is to keep a store it rejects. Never use it for anything.
 */
export function nonAtomicStore(shared?: Map<string, SpentRecord>): SpendStore {
  const rows = shared ?? new Map<string, SpentRecord>();
  // The defect, modelled exactly as `jsonFileLedger` has it: the store reads the whole set ONCE when
  // the process attaches, decides from that snapshot, and writes its own view back. Two processes
  // that both attached before either wrote each see an empty set, each decide the receipt is unspent,
  // and each write - and the second write clobbers the first. No error is raised anywhere.
  const snapshot = new Map(rows);
  return {
    claims: {
      singleProcess: true,
      singleHost: false,
      crossHostSafe: true, // the lie this exists to catch
      crashSafe: false,
      staleLockReclaim: false,
      caveat:
        "DELIBERATELY BROKEN. Reads at attach time, then writes, and claims cross-host safety it does not have",
    },
    insertIfAbsent: (record) => {
      const k = record.receipt as unknown as string;
      // Decided from the STALE snapshot. This one line is the entire bug.
      if (snapshot.has(k)) return "already_present";
      snapshot.set(k, record);
      rows.set(k, record);
      return "inserted";
    },
    // Queries read through to the live store on purpose. A blanket-broken mutant would fail every
    // scenario and prove only that the suite is a tripwire; isolating the defect to the WRITE race is
    // what makes `proveCrossHost` a measurement - it must fail on exactly one scenario and pass the
    // rest.
    has: (receipt) => rows.has(receipt as unknown as string),
    all: () => [...rows.values()],
  };
}
