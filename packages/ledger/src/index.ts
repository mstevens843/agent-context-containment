// The safe integration path: a stateful shell around the pure engine.
//
// WHY THIS PACKAGE EXISTS. `decide()` takes `now` and `spentReceipts` as arguments, because the core
// reads no clock and holds no state - a property the whole design rests on and the contract test
// enforces. But it produces a real hazard at the boundary: **both are optional**, and a caller who
// omits them gets no expiry checking and unlimited receipt reuse, silently. The engine cannot fix
// that without becoming impure. A shell can.
//
// So the recommended integration is a `Guard`, and `ContainmentInput` is deliberately typed so the
// two replay fields CANNOT BE PASSED AT ALL. Forgetting them stops being possible rather than being
// discouraged - the guard supplies both, from a clock and a ledger it owns.
//
// Reach for `decide()` directly when you are writing a checker, replaying an audit log against a
// past policy, or testing - places where controlling time and the ledger is the point. Everywhere
// else, this.

import {
  type ActionArg,
  type DecisionInput,
  type ProposedAction,
  type ReceiptEvidence,
  type ReceiptId,
  type Source,
  type Verdict,
  decide,
} from "@agent-containment/core";

// ---------------------------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------------------------

/**
 * What a decision spent, and when.
 *
 * Kept alongside the id rather than as a bare set, because "this receipt was spent" is an audit fact
 * and the interesting question after an incident is always *when, and on what*.
 */
export interface SpentRecord {
  readonly receipt: ReceiptId;
  readonly spentAt: number;
  readonly actionId: string;
}

/**
 * Where spent receipts live.
 *
 * Synchronous on purpose. The in-memory and JSON implementations below are both trivially sync, and
 * an async port would force `Guard.decide` to be async, which would make the guard unusable from the
 * synchronous call sites the engine was designed for.
 *
 * IMPLEMENTORS MUST GUARANTEE:
 *
 *   1. `spend` is IDEMPOTENT. Recording the same receipt twice is not an error and does not produce
 *      two records. Duplicate delivery - a retried request, a doubled queue message - is ordinary
 *      traffic, not an attack, and a ledger that throws on it turns a retry into an outage.
 *   2. `isSpent` returns true for anything `spend` has accepted, and keeps doing so. A ledger that
 *      forgets is a ledger that permits replay after a restart.
 *   3. Neither method throws for ordinary input. A ledger that throws inside a policy decision has a
 *      caller with a try/catch, and that catch block is the bypass.
 */
/**
 * What an adapter claims about the conditions it survives.
 *
 * REQUIRED, not optional, and that is the design. Every ledger in this package is safe under some
 * conditions and unsafe under others, and the failure mode is always the same: a value that was
 * correct on a laptop is deployed onto three pods behind a load balancer and silently stops being
 * correct. A lost record is a PERMITTED REPLAY, and it is silent - nothing logs, nothing throws, the
 * receipt simply works twice.
 *
 * Written prose in `README.md` did not stop that, because prose is read once and deployments change
 * later. Making this a required field means an adapter cannot decline to answer, and
 * `requireGuarantees` below lets a deployment state its needs in code that fails at construction
 * rather than in a comment nobody re-reads.
 *
 * THESE ARE CLAIMS, NOT PROOFS. Nothing here verifies them; an adapter that lies is trusted exactly
 * as much as its author. What the type buys is that the claim is written down, versioned with the
 * code, and checkable against what the caller needs.
 */
export interface LedgerGuarantees {
  /** Safe when exactly one process holds it. Every implementation here says true. */
  readonly singleProcess: boolean;
  /** Safe with several processes on ONE machine, sharing a local filesystem. */
  readonly singleHost: boolean;
  /** Safe with processes on DIFFERENT machines. Needs a real store; nothing here claims it. */
  readonly crossHostSafe: boolean;
  /** A record accepted before a crash is still there afterwards. */
  readonly crashSafe: boolean;
  /** Recovers from a lock held by a process that died without releasing it. */
  readonly staleLockReclaim: boolean;
  /** One sentence a reader can act on: where this breaks, in plain words. */
  readonly caveat: string;
}

/**
 * Whether THIS call was the one that recorded the spend.
 *
 * Added in v0.8, and it is the whole of defect §10. `spend` used to return `void`, so a store could
 * serialise perfectly - exactly one writer wins - and the winner was never told. Two hosts both read
 * an unspent set, both decided ALLOW, both committed, one wrote and one no-opped, and BOTH performed
 * the action. The store was correct and the guarantee was not, because the one bit that mattered died
 * at the interface.
 */
export type SpendOutcome = "recorded" | "already_spent";

export interface ReceiptLedger {
  /** What this adapter survives. See `LedgerGuarantees` - it is a claim, not a proof. */
  readonly guarantees: LedgerGuarantees;
  isSpent(receipt: ReceiptId): boolean;
  /**
   * Record a spend, and SAY WHETHER THIS CALL WAS THE ONE THAT DID IT.
   *
   * Still idempotent - a duplicate is ordinary traffic, not an error - but the answer is no longer
   * discarded. An adapter that always returns "recorded" has reintroduced defect §10.
   */
  spend(record: SpentRecord): SpendOutcome;
  /** Everything spent so far, for audit and for persistence. Ordering is by insertion. */
  entries(): readonly SpentRecord[];
}

/** An in-memory ledger. Correct, obvious, and lost on restart - which the docs say out loud. */
export function memoryLedger(seed: readonly SpentRecord[] = []): ReceiptLedger {
  const byId = new Map<string, SpentRecord>();
  for (const r of seed) byId.set(r.receipt as string, r);
  return {
    guarantees: {
      singleProcess: true,
      singleHost: false,
      crossHostSafe: false,
      crashSafe: false,
      staleLockReclaim: false,
      caveat: "lost on restart: every receipt becomes spendable again the moment the process exits",
    },
    isSpent: (receipt) => byId.has(receipt as string),
    spend: (record) => {
      // Idempotent: the FIRST spend wins, so a duplicate delivery cannot rewrite when it happened.
      // The return value is what tells the caller which of those two they were.
      if (byId.has(record.receipt as string)) return "already_spent";
      byId.set(record.receipt as string, record);
      return "recorded";
    },
    entries: () => [...byId.values()],
  };
}

/**
 * A ledger that survives a restart, backed by one JSON file.
 *
 * Deliberately not a database. The access pattern is an append-mostly set of short strings, and the
 * honest scale is "a few thousand receipts", so a file read at construction and a write per spend is
 * the right amount of machinery. If your volume outgrows that, the `ReceiptLedger` interface is three
 * methods and a Postgres implementation is an afternoon - which is the point of it being an interface.
 *
 * NOT SAFE ACROSS PROCESSES. Two processes writing the same file will lose records, and a lost record
 * is a permitted replay. Single-process only until someone puts a real store behind the interface.
 */
export function jsonFileLedger(args: {
  readonly path: string;
  readonly readFile: (path: string) => string | undefined;
  readonly writeFile: (path: string, contents: string) => void;
}): ReceiptLedger {
  const raw = args.readFile(args.path);
  const seed: SpentRecord[] = raw === undefined || raw.trim() === "" ? [] : JSON.parse(raw);
  const inner = memoryLedger(seed);
  return {
    guarantees: {
      singleProcess: true,
      singleHost: false,
      crossHostSafe: false,
      crashSafe: true,
      staleLockReclaim: false,
      caveat:
        "two processes writing this file will lose records, and a lost record is a permitted replay",
    },
    isSpent: inner.isSpent,
    spend: (record) => {
      if (inner.isSpent(record.receipt)) return "already_spent";
      inner.spend(record);
      args.writeFile(args.path, `${JSON.stringify(inner.entries(), null, 2)}\n`);
      return "recorded";
    },
    entries: inner.entries,
  };
}

// ---------------------------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------------------------

/**
 * Everything a caller supplies. Note what is ABSENT.
 *
 * `now` and `spentReceipts` are not here and cannot be passed. That is the whole point of the type:
 * the two fields whose omission silently disables replay protection are not the caller's to omit.
 */
export interface ContainmentInput {
  readonly action: ProposedAction;
  readonly sources: readonly Source[];
  readonly receipts?: readonly ReceiptEvidence[];
  readonly confirmed?: boolean;
  /**
   * Typed `never` DELIBERATELY, so passing it is a compile error rather than a silent override.
   *
   * Simply omitting the field from the interface is not enough: TypeScript's excess-property check
   * does not fire through a spread, so `{ ...base, now: 0 }` would typecheck and be ignored at
   * runtime - the worst of both, since the caller believes they set a clock and did not. Declaring
   * it `never` closes that.
   */
  readonly now?: never;
  /** Same reasoning as `now`. The guard owns the ledger; a caller cannot substitute one here. */
  readonly spentReceipts?: never;
}

export interface Guard {
  /**
   * Judge an action, then burn whatever it spent.
   *
   * Spending happens only on `ALLOW`, and only for receipts the decision actually used - burning
   * evidence that did no work is how a single-use confirmation gets exhausted ten minutes before the
   * action that needed it.
   *
   * THE HONEST CAVEAT: this burns the receipt at DECISION time, not at PERFORM time. If the shell
   * then fails to carry out the action, the receipt is gone and a human has to confirm again. That
   * is the safe direction to be wrong in - the alternative loses the receipt-burn on a crash and
   * permits a replay - but it is a real behaviour and not an accident. A caller that needs
   * atomicity should use `decideOnly` and spend alongside its own effect, transactionally.
   */
  decide(input: ContainmentInput): Verdict;
  /**
   * Judge without spending. For callers doing their own transactional burn.
   *
   * THE OBLIGATION THIS HANDS YOU, stated because forgetting it is defect §10 in its original form.
   * Between this call and your write, another process or host may spend the same receipt. `decide`
   * handles that by re-deciding; here it is yours. You MUST act on what `commit` returns - a
   * non-empty list means somebody spent that receipt first and the action must not proceed - or burn
   * the receipt inside the same transaction as your effect, which is stronger and is why this method
   * exists.
   *
   * A caller who calls `decideOnly` and then performs the action without checking has a verdict that
   * was true when it was computed and false when it was used.
   */
  decideOnly(input: ContainmentInput): Verdict;
  /**
   * Burn the receipts a verdict named, and report any this caller did NOT win.
   *
   * Idempotent. A non-empty result means somebody else spent that receipt first, and the action must
   * not proceed - see `decide`, which handles that for you.
   */
  commit(verdict: Verdict, actionId: string): readonly ReceiptId[];
  readonly ledger: ReceiptLedger;
}

/**
 * Build a guard.
 *
 * `clock` is injected rather than defaulted to `Date.now` so the guard stays testable, and so a host
 * with its own notion of time - a replay harness, a simulation, a deterministic test - can supply it.
 */
/**
 * The one place this package calls the pure engine.
 *
 * Factored out in v0.8 so the sync guard and the async guard cannot drift apart on the two fields
 * that matter. `now` and `spentReceipts` are supplied HERE, from arguments the caller could not omit,
 * which is the whole point of the `never` types on `ContainmentInput`: if a second call site ever
 * grew, it would be one edit away from passing neither and silently disabling replay protection.
 *
 * Note what it is NOT: it is not async, does not touch a ledger, and takes the spent set as data.
 * Everything about when to ask the store, and what to do afterwards, belongs to the caller.
 */
export function decideWithSpent(
  input: ContainmentInput,
  now: number,
  spentReceipts: ReadonlySet<ReceiptId>,
): Verdict {
  return decide({
    action: input.action,
    sources: input.sources,
    ...(input.receipts !== undefined ? { receipts: input.receipts } : {}),
    ...(input.confirmed !== undefined ? { confirmed: input.confirmed } : {}),
    now,
    spentReceipts,
  } satisfies DecisionInput);
}

export function createGuard(args: {
  readonly ledger?: ReceiptLedger;
  readonly clock: () => number;
  /**
   * What this deployment needs from its ledger. Construction fails if the adapter does not claim it.
   *
   * This exists because of one specific, common, silent failure: an application built and tested on
   * one process is later run on several, or on several machines, and nothing in the code notices.
   * The default ledger keeps working, `isSpent` starts returning `false` for receipts another
   * process already spent, and replay protection is gone with no error and no log line.
   *
   *   createGuard({ clock: Date.now, ledger, requireGuarantees: { crossHostSafe: true } })
   *
   * throws at startup instead. A deployment that states its needs in code gets a boot failure; one
   * that states them in a comment gets a quiet regression. Only `true` is checked - asking for
   * `false` asks for nothing, since a stronger adapter is never a problem.
   *
   * WHAT THIS DOES NOT DO: verify the claim. An adapter that declares `crossHostSafe: true` without
   * being so is believed. The check is that the requirement and the claim are written down and
   * compared, not that the claim is true.
   */
  readonly requireGuarantees?: Partial<
    Pick<
      LedgerGuarantees,
      "singleProcess" | "singleHost" | "crossHostSafe" | "crashSafe" | "staleLockReclaim"
    >
  >;
}): Guard {
  const ledger = args.ledger ?? memoryLedger();

  if (args.requireGuarantees !== undefined) {
    const missing = (
      Object.entries(args.requireGuarantees) as readonly [keyof LedgerGuarantees, boolean][]
    )
      .filter(([key, wanted]) => wanted === true && ledger.guarantees[key] !== true)
      .map(([key]) => key);
    if (missing.length > 0) {
      const need = missing.join(", ");
      const them = missing.length === 1 ? "it" : "them";
      throw new Error(
        `this deployment requires ${need} from its receipt ledger and the adapter does not claim ${them}. The adapter says: ${ledger.guarantees.caveat}. Put a store with real transactions behind the ReceiptLedger interface - it is three methods - rather than relaxing this requirement, because the failure it prevents is silent: a lost spend record is a permitted replay.`,
      );
    }
  }

  const spentSet = (): ReadonlySet<ReceiptId> => new Set(ledger.entries().map((e) => e.receipt));

  // The two fields the caller cannot forget, because they cannot supply them.
  const judge = (input: ContainmentInput): Verdict =>
    decideWithSpent(input, args.clock(), spentSet());

  const commit = (verdict: Verdict, actionId: string): readonly ReceiptId[] => {
    const at = args.clock();
    const lost: ReceiptId[] = [];
    for (const receipt of verdict.spends) {
      if (ledger.spend({ receipt, spentAt: at, actionId }) === "already_spent") lost.push(receipt);
    }
    return lost;
  };

  return {
    ledger,
    decideOnly: judge,
    decide: (input) => {
      const verdict = judge(input);
      const lost = commit(verdict, input.action.id as string);
      if (lost.length === 0) return verdict;

      // DEFECT §10, closed. Somebody spent one of these receipts between our read and our write -
      // another process, another host, a retry that overtook us. The verdict we computed is stale.
      //
      // RE-DECIDE rather than manufacture a refusal. It would be one line to return a DENY from here,
      // and it would put policy outside `policy.ts`, which is the one thing this package must never
      // do: the reason code, the effect list and the decision word all have to come from the engine,
      // or an auditor reading the log cannot tell an engine refusal from a wrapper's opinion. Feeding
      // the lost ids back in produces `receipt_already_consumed` from the engine itself.
      const stale = new Set([...spentSet(), ...lost]);
      return decideWithSpent(input, args.clock(), stale);
    },
    commit,
  };
}

export {
  type LockingFs,
  type LockingLedgerOptions,
  LedgerLockError,
  lockingFileLedger,
  nodeLockingFs,
} from "./locking.js";

export {
  type AsyncCheck,
  checkAsyncLedger,
  formatAsyncChecks,
} from "./asyncconformance.js";

export {
  type AsyncSqlExecutor,
  POSTGRES_ASYNC_SCHEMA,
  postgresAsyncLedger,
} from "./asyncpg.js";

export {
  type AsyncGuard,
  type AsyncReceiptLedger,
  type AsyncVerdict,
  type LedgerStats,
  type ReceiptState,
  type ReceiptOutcome,
  type Reservation,
  createAsyncGuard,
  memoryAsyncLedger,
} from "./async.js";

export {
  type CrossHostProof,
  type SpendStore,
  type SqlExecutor,
  POSTGRES_SCHEMA,
  crossHostProven,
  durableLedger,
  fakeTransactionalStore,
  formatCrossHostProof,
  nonAtomicStore,
  postgresSpendStore,
  proveCrossHost,
} from "./durable.js";

/** Re-exported so an integrator needs one import. */
export {
  type ConformanceCheck,
  checkLedger,
  formatLedgerChecks,
  twoHostSimulation,
} from "./conformance.js";

export type { ActionArg, ProposedAction, ReceiptEvidence, Source, Verdict };
