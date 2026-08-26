// The async boundary, and why it is a bracket rather than an `async` keyword on `decide`.
//
// THE PROBLEM. `decide()` is synchronous because `packages/core` is pure - a contract test fails the
// build if it grows a `Promise` - and that is not squeamishness: a policy decision that returns a
// promise puts an `await` into every call site of a security check, and the first caller who forgets
// one has a bypass that typechecks. Real databases are async. Something has to give, and the
// question is only which thing.
//
// THE WRONG ANSWER is making `decide` async. It would propagate through `checkContainment`, through
// every replay of an audit log, through the conformance port that third parties implement, and it
// would buy nothing: the engine still needs the spent-receipt set to be a plain `Set` at the moment
// it reasons, so the await would happen anyway, one frame lower and harder to see.
//
// THE ANSWER HERE is a two-phase bracket. The async work happens BEFORE and AFTER a decision that is
// still synchronous:
//
//   1. RESERVE   async, atomic. Claim every receipt this action would spend. Exactly one caller wins
//                each id, however many are racing, on however many hosts.
//   2. DECIDE    synchronous, pure, unchanged. The reservation result IS the spent-receipt set.
//   3a. CONSUME  async, if the decision was ALLOW. The reservation becomes final.
//   3b. RELEASE  async, otherwise. The reservation is undone.
//
// Step 3b is the one that is easy to leave out and is the whole reason for the design. A refusal must
// spend NOTHING - otherwise a rejected action burns the user's approval and the retry that would have
// succeeded now cannot. The synchronous guard gets this for free by burning at decision time and only
// on success; an async ledger has to unwind deliberately.
//
// WHAT THIS COSTS, stated rather than discovered. A crash between RESERVE and CONSUME leaves a
// reservation nobody will finish. It is not a double-spend - the receipt stays unusable, which is the
// safe direction - but it is a receipt lost until something reclaims it. `staleAfterMs` makes those
// reclaimable by age, and that reclaim is itself a race in the other direction: reclaim too eagerly
// and a slow-but-alive caller loses its reservation. There is no setting that is free, and the
// adapter says so in its own caveat rather than leaving it for someone to find.

import type { ReceiptId, Verdict } from "@agent-containment/core";
import type { ContainmentInput, LedgerGuarantees, SpentRecord } from "./index.js";
import { decideWithSpent } from "./index.js";

/** What a reservation attempt produced. */
export interface Reservation {
  /** Opaque handle. `consume` and `release` take this, never a receipt id. */
  readonly id: string;
  /** Ids this call claimed. Only these may be consumed. */
  readonly reserved: readonly ReceiptId[];
  /**
   * Ids somebody already holds or has consumed.
   *
   * NOT an error, and this is the distinction the whole protocol turns on. A non-empty `alreadySpent`
   * is exactly what the engine needs to refuse a replay, so it is data flowing INTO the decision
   * rather than an exception thrown around it.
   */
  readonly alreadySpent: readonly ReceiptId[];
}

/**
 * A ledger that talks to something over a network.
 *
 * IMPLEMENTORS MUST GUARANTEE:
 *
 *   1. `reserve` is ATOMIC PER ID across every caller, in every process, on every host. If two
 *      callers reserve the same id concurrently, exactly one gets it in `reserved` and the other
 *      gets it in `alreadySpent`. Anything less is a double-spend with extra steps.
 *   2. `consume` and `release` are IDEMPOTENT and safe to call on an unknown reservation. They run in
 *      the unwind path of a decision, and a throw there turns a policy refusal into an exception the
 *      caller catches - and that catch block is the bypass.
 *   3. `release` frees ONLY ids this reservation claimed. Releasing an id another caller consumed
 *      would hand them a replay.
 */
export interface AsyncReceiptLedger {
  readonly guarantees: LedgerGuarantees;
  reserve(ids: readonly ReceiptId[], actionId: string, now: number): Promise<Reservation>;
  consume(reservation: Reservation, now: number): Promise<void>;
  /**
   * Undo a reservation. ONLY safe before the effect exists.
   *
   * THE HAZARD, stated where somebody reaching for this will see it: a `release` called from a catch
   * block AFTER the effect may have happened returns a single-use receipt to the claimable pool - and
   * that makes replay an operation controlled by whoever can induce a failure. `createAsyncGuard`
   * only ever releases on a POLICY REFUSAL, which happens before anything was performed, and that is
   * the only ordering in which release is correct.
   *
   * If your effect might have landed, the receipt must stay consumed. A burned receipt behind a
   * failed action costs one human approval; a released one behind a succeeded action costs the
   * action twice.
   */
  release(reservation: Reservation): Promise<void>;
  isSpent(id: ReceiptId): Promise<boolean>;
  entries(): Promise<readonly SpentRecord[]>;
  /**
   * What the ledger holds, by state, as of `now`.
   *
   * `now` is a parameter rather than a clock read because `stranded` is a question about age, and an
   * adapter that read its own clock could not be tested and could not be replayed.
   */
  stats(now: number): Promise<LedgerStats>;
}

/** Which of the three terminal states a decision reached. Emitted for audit, not for control flow. */
export type ReceiptOutcome = "consumed" | "released" | "none";

/**
 * Where a receipt actually is, as the store sees it.
 *
 * Four states, and `stranded` is the one that only exists because crashes do. A process that reserves
 * and then dies leaves a row nobody will finish: the receipt is NOT double-spendable, which is the
 * safe direction, and it is not usable either. Naming it separately from `reserved` is the difference
 * between an operator who can see stranded work and one who finds out when a user complains.
 */
export type ReceiptState =
  /** Claimed by a decision that has not finished. Unclaimable by anyone else. */
  | "reserved"
  /** The action was permitted and reported. Permanent. */
  | "consumed"
  /** The decision refused, so the reservation was undone. The receipt is usable again. */
  | "released"
  /** Reserved longer than `staleAfterMs`. Nobody is going to finish it. */
  | "stranded";

/**
 * What the ledger holds right now, by state.
 *
 * Exists so `stranded` is a number an operator can watch rather than a paragraph in a doc. There is
 * no setting of `staleAfterMs` that makes stranding free: too long and a crash costs a receipt until
 * it expires, too short and a slow-but-alive caller loses a reservation it was about to consume -
 * and THAT direction is a double-spend. It is an integration choice, and a choice you cannot see the
 * consequences of is not one.
 */
export interface LedgerStats {
  readonly reserved: number;
  readonly consumed: number;
  /** Reserved for longer than `staleAfterMs` at the moment `stats(now)` was called. */
  readonly stranded: number;
  /** Reservations this ledger has reclaimed from a stale holder since it was constructed. */
  readonly reclaimed: number;
  /** Reservations undone by a refusal since construction. */
  readonly released: number;
}

export interface AsyncVerdict {
  readonly verdict: Verdict;
  /** `consumed` on ALLOW with receipts, `released` on any refusal, `none` when no receipt was in play. */
  readonly receipts: ReceiptOutcome;
  /** Ids the ledger had already seen. Non-empty means a replay was attempted. */
  readonly alreadySpent: readonly ReceiptId[];
}

export interface AsyncGuard {
  /**
   * Reserve, decide, then consume or release.
   *
   * Returns rather than throws on a refusal: a refusal is an ordinary outcome and a caller who has to
   * catch one will eventually catch it in the wrong place.
   */
  decide(input: ContainmentInput): Promise<AsyncVerdict>;
  readonly ledger: AsyncReceiptLedger;
}

export function createAsyncGuard(args: {
  readonly ledger: AsyncReceiptLedger;
  readonly clock: () => number;
  readonly requireGuarantees?: Partial<Omit<LedgerGuarantees, "caveat">>;
}): AsyncGuard {
  const { ledger } = args;

  if (args.requireGuarantees !== undefined) {
    const missing = (
      Object.entries(args.requireGuarantees) as readonly [keyof LedgerGuarantees, boolean][]
    )
      .filter(([k, wanted]) => wanted === true && ledger.guarantees[k] !== true)
      .map(([k]) => k);
    if (missing.length > 0) {
      const need = missing.join(", ");
      throw new Error(
        `this deployment requires ${need} from its receipt ledger and the adapter does not claim it. The adapter says: ${ledger.guarantees.caveat}`,
      );
    }
  }

  return {
    ledger,
    decide: async (input: ContainmentInput): Promise<AsyncVerdict> => {
      const wanted = (input.receipts ?? []).map((r) => r.id);
      const actionId = input.action.id as unknown as string;
      const now = args.clock();

      // ---- 1. RESERVE -------------------------------------------------------------------------
      // Nothing has been decided yet, and that ordering is deliberate. Reserving first is what makes
      // the spent-set the engine reasons over TRUE AT THE MOMENT IT REASONS. Asking "is this spent?"
      // and then deciding leaves a window, and the window is the bug.
      const reservation =
        wanted.length === 0
          ? { id: "", reserved: [], alreadySpent: [] }
          : await ledger.reserve(wanted, actionId, now);

      // ---- 2. DECIDE --------------------------------------------------------------------------
      // The pure engine, unchanged, synchronous. It sees the already-spent ids as a plain Set and
      // refuses a replay for its own reason - `receipt_already_consumed` - rather than this wrapper
      // second-guessing it.
      let verdict: Verdict;
      try {
        verdict = decideWithSpent(input, now, new Set(reservation.alreadySpent));
      } catch (e) {
        // Unwind before rethrowing. A reservation left behind by a throw is a receipt nobody can use.
        if (reservation.reserved.length > 0) await ledger.release(reservation);
        throw e;
      }

      // ---- 3. CONSUME or RELEASE --------------------------------------------------------------
      if (reservation.reserved.length === 0) {
        return { verdict, receipts: "none", alreadySpent: reservation.alreadySpent };
      }
      if (verdict.decision === "ALLOW") {
        await ledger.consume(reservation, now);
        return { verdict, receipts: "consumed", alreadySpent: reservation.alreadySpent };
      }
      // THE STEP THAT IS EASY TO OMIT. A refusal must spend nothing: otherwise a rejected action
      // burns a human's approval, and the corrected retry that should have worked cannot.
      await ledger.release(reservation);
      return { verdict, receipts: "released", alreadySpent: reservation.alreadySpent };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// An in-memory async adapter
// ---------------------------------------------------------------------------------------------

interface Row {
  state: "reserved" | "consumed";
  reservationId: string;
  at: number;
  actionId: string;
}

/**
 * Correct, and single-process. Exists so the protocol can be tested without a database, and so a
 * local development setup has something to point at.
 *
 * Deliberately claims nothing it has not got: one process, no crash safety, no cross-host.
 */
export function memoryAsyncLedger(
  shared?: Map<string, Row>,
  options?: { readonly staleAfterMs?: number | null },
): AsyncReceiptLedger {
  const rows = shared ?? new Map<string, Row>();
  const staleAfterMs = options?.staleAfterMs === undefined ? 300_000 : options.staleAfterMs;
  let seq = 0;
  let reclaimed = 0;
  let released = 0;
  return {
    guarantees: {
      singleProcess: true,
      singleHost: false,
      crossHostSafe: false,
      crashSafe: false,
      staleLockReclaim: false,
      caveat:
        "in-process only: reservations and consumptions are lost with the process, so every restart makes every receipt spendable again",
    },
    reserve: async (ids, actionId, now) => {
      const id = `res-${++seq}`;
      const reserved: ReceiptId[] = [];
      const alreadySpent: ReceiptId[] = [];
      for (const r of ids) {
        const k = r as unknown as string;
        const existing = rows.get(k);
        if (existing === undefined) {
          rows.set(k, { state: "reserved", reservationId: id, at: now, actionId });
          reserved.push(r);
          continue;
        }
        // Reclaim ONLY a stale `reserved` row - never a `consumed` one. Reclaiming a consumed row is
        // the double-spend, and it looks exactly like cleanup.
        const stale =
          staleAfterMs !== null &&
          existing.state === "reserved" &&
          now - existing.at >= staleAfterMs;
        if (stale) {
          rows.set(k, { state: "reserved", reservationId: id, at: now, actionId });
          reserved.push(r);
          reclaimed++;
          continue;
        }
        alreadySpent.push(r);
      }
      return { id, reserved, alreadySpent };
    },
    consume: async (reservation, now) => {
      for (const r of reservation.reserved) {
        const row = rows.get(r as unknown as string);
        // Only OUR reservation may be consumed. Consuming somebody else's would be a second winner.
        if (row?.reservationId === reservation.id) {
          row.state = "consumed";
          row.at = row.at === 0 ? now : row.at;
        }
      }
    },
    release: async (reservation) => {
      for (const r of reservation.reserved) {
        const k = r as unknown as string;
        const row = rows.get(k);
        // Never release a row somebody else holds, and never release one already consumed.
        if (row?.reservationId === reservation.id && row.state === "reserved") {
          rows.delete(k);
          released++;
        }
      }
    },
    isSpent: async (id) => rows.has(id as unknown as string),
    stats: async (now) => {
      let reservedCount = 0;
      let consumedCount = 0;
      let stranded = 0;
      for (const row of rows.values()) {
        if (row.state === "consumed") {
          consumedCount++;
          continue;
        }
        reservedCount++;
        if (staleAfterMs !== null && now - row.at >= staleAfterMs) stranded++;
      }
      return { reserved: reservedCount, consumed: consumedCount, stranded, reclaimed, released };
    },
    // CONSUMED only. An audit trail that listed reservations would report actions that never
    // happened - including ones the policy refused, which is exactly backwards.
    entries: async () =>
      [...rows.entries()]
        .filter(([, row]) => row.state === "consumed")
        .map(([receipt, row]) => ({
          receipt: receipt as unknown as ReceiptId,
          spentAt: row.at,
          actionId: row.actionId,
        })),
  };
}
