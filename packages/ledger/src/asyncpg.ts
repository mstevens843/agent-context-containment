// A Postgres async ledger, and still no `pg` dependency.
//
// The reservation protocol maps onto three statements, and the interesting one is the first: the
// entire cross-host guarantee lives in `INSERT ... ON CONFLICT DO NOTHING RETURNING` against a
// PRIMARY KEY. The storage engine serialises it, so two hosts reserving the same receipt at the same
// instant produce one row and one winner. `RETURNING` is what tells the caller which of them they
// are - without it there is no way to separate "I claimed this" from "somebody else already had",
// and that distinction is the whole protocol.
//
// The other two statements are guarded by `reservation_id`, which is the part that is easy to get
// wrong. `consume` and `release` must only touch rows THIS reservation holds. A release that matched
// on receipt id alone would happily free a row another host had just consumed, handing them a replay -
// and it would do it silently, because freeing a row looks exactly like ordinary cleanup.

import type { ReceiptId } from "@agent-containment/core";
import type { AsyncReceiptLedger, Reservation } from "./async.js";
import type { LedgerGuarantees, SpentRecord } from "./index.js";

/** Run this once at deploy time. Idempotent. */
export const POSTGRES_ASYNC_SCHEMA = `
CREATE TABLE IF NOT EXISTS containment_receipt_reservations (
  receipt        TEXT PRIMARY KEY,
  state          TEXT   NOT NULL CHECK (state IN ('reserved', 'consumed')),
  reservation_id TEXT   NOT NULL,
  at             BIGINT NOT NULL,
  action_id      TEXT   NOT NULL
);
CREATE INDEX IF NOT EXISTS containment_reservations_by_id
  ON containment_receipt_reservations (reservation_id);`.trim();

/**
 * The caller's database client, as one async function.
 *
 * Async here and synchronous in `postgresSpendStore` is not an inconsistency - it is the point of
 * v0.8. The sync store exists so a local, single-host deployment needs no bridge; this one exists so
 * a real deployment needs no bridge either. Neither forces `decide()` to become async.
 */
export type AsyncSqlExecutor = (
  sql: string,
  params: readonly unknown[],
) => Promise<readonly Record<string, unknown>[]>;

export function postgresAsyncLedger(args: {
  readonly query: AsyncSqlExecutor;
  readonly table?: string;
  /**
   * True only if every host genuinely points at THIS database.
   *
   * A Postgres in a container on one laptop is atomic and is not cross-host, and neither is a per-pod
   * sidecar. The adapter cannot tell from a connection string, so it asks.
   */
  readonly sharedAcrossHosts: boolean;
  /**
   * After this long, a `reserved` row is treated as abandoned and may be reclaimed.
   *
   * There is no free value. Too long and a crash between reserve and consume strands a receipt until
   * it expires; too short and a slow-but-alive caller loses a reservation it is about to consume -
   * which is the direction that produces a double-spend. Defaults to five minutes and is stated in
   * the caveat rather than hidden. `null` disables reclaim entirely: strictly safer, and it makes
   * every crash permanent for the receipts it was holding.
   */
  readonly staleAfterMs?: number | null;
  readonly newReservationId: () => string;
}): AsyncReceiptLedger {
  const table = args.table ?? "containment_receipt_reservations";
  const q = args.query;
  const staleAfterMs = args.staleAfterMs === undefined ? 300_000 : args.staleAfterMs;
  // Counted in this adapter instance rather than read from the database, and the distinction is
  // worth stating: these are what THIS process did, not what the cluster holds. `reserved`,
  // `consumed` and `stranded` come from the store and are shared; `reclaimed` and `released` are
  // local. An operator watching the shared numbers across pods gets the truth; one summing the local
  // ones gets the truth too, and mixing them silently would not.
  let reclaimed = 0;
  let released = 0;

  const guarantees: LedgerGuarantees = {
    singleProcess: true,
    singleHost: true,
    crossHostSafe: args.sharedAcrossHosts,
    crashSafe: true,
    staleLockReclaim: staleAfterMs !== null,
    caveat: args.sharedAcrossHosts
      ? `atomicity is the storage engine's: ON CONFLICT DO NOTHING on a PRIMARY KEY. Correct only while every host points at the SAME database. ${
          staleAfterMs === null
            ? "Stale reclaim is DISABLED: a crash between reserve and consume strands that receipt permanently."
            : `A reservation abandoned by a crash is reclaimable after ${staleAfterMs}ms; a caller slower than that can lose a reservation it was about to consume.`
        }`
      : "declared single-host by the caller: this connection was not stated to be shared across hosts",
  };

  return {
    guarantees,

    reserve: async (ids, actionId, now) => {
      const id = args.newReservationId();
      const reserved: ReceiptId[] = [];
      const alreadySpent: ReceiptId[] = [];
      for (const r of ids) {
        const key = r as unknown as string;
        // ONE statement. Not a SELECT then an INSERT: the gap between them is the race, on every
        // database, at every isolation level short of serializable-with-retry.
        const rows = await q(
          `INSERT INTO ${table} (receipt, state, reservation_id, at, action_id)
           VALUES ($1, 'reserved', $2, $3, $4)
           ON CONFLICT (receipt) DO NOTHING
           RETURNING receipt`,
          [key, id, now, actionId],
        );
        if (rows.length > 0) {
          reserved.push(r);
          continue;
        }
        // Somebody holds it. Reclaim ONLY if it is a stale `reserved` row - never a `consumed` one,
        // which is a permanent record and reclaiming it would be the double-spend this exists to
        // prevent. The WHERE clause carries that rule rather than a branch above it, so it is
        // evaluated inside the same statement that does the write.
        if (staleAfterMs !== null) {
          const taken = await q(
            `UPDATE ${table}
                SET reservation_id = $2, at = $3, action_id = $4
              WHERE receipt = $1 AND state = 'reserved' AND at < $5
              RETURNING receipt`,
            [key, id, now, actionId, now - staleAfterMs],
          );
          if (taken.length > 0) {
            reserved.push(r);
            reclaimed++;
            continue;
          }
        }
        alreadySpent.push(r);
      }
      return { id, reserved, alreadySpent };
    },

    consume: async (reservation: Reservation, now) => {
      if (reservation.reserved.length === 0) return;
      // Guarded by reservation_id. A consume that matched on receipt alone would finalise a row
      // another host had reclaimed from us, and both callers would believe they won.
      await q(
        `UPDATE ${table} SET state = 'consumed', at = $2
          WHERE reservation_id = $1 AND state = 'reserved'`,
        [reservation.id, now],
      );
    },

    release: async (reservation: Reservation) => {
      if (reservation.reserved.length === 0) return;
      // Same guard, and the `state = 'reserved'` clause matters just as much: releasing a consumed
      // row would hand out a replay, and it would look like tidying up.
      const gone = await q(
        `DELETE FROM ${table} WHERE reservation_id = $1 AND state = 'reserved' RETURNING receipt`,
        [reservation.id],
      );
      released += gone.length;
    },

    isSpent: async (id) =>
      (await q(`SELECT 1 FROM ${table} WHERE receipt = $1`, [id as unknown as string])).length > 0,

    /**
     * Counted in the database, in one statement, so `stranded` is a fact about the shared store
     * rather than about this process's memory. That matters: a receipt stranded by a pod that died
     * is invisible to every other pod's local counters, and it is exactly the one an operator needs
     * to see.
     */
    stats: async (now) => {
      const rows = await q(
        `SELECT state, count(*)::int AS n,
                count(*) FILTER (WHERE state = 'reserved' AND at < $1)::int AS stale
           FROM ${table} GROUP BY state`,
        [staleAfterMs === null ? Number.NEGATIVE_INFINITY : now - staleAfterMs],
      );
      const of = (state: string, key: string): number =>
        Number(rows.find((r) => r.state === state)?.[key] ?? 0);
      return {
        reserved: of("reserved", "n"),
        consumed: of("consumed", "n"),
        stranded: of("reserved", "stale"),
        reclaimed,
        released,
      };
    },

    entries: async (): Promise<readonly SpentRecord[]> =>
      (
        await q(
          `SELECT receipt, at, action_id FROM ${table} WHERE state = 'consumed' ORDER BY at, receipt`,
          [],
        )
      ).map((r) => ({
        receipt: r.receipt as unknown as ReceiptId,
        spentAt: Number(r.at),
        actionId: String(r.action_id),
      })),
  };
}
