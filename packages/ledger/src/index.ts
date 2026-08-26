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
export interface ReceiptLedger {
  isSpent(receipt: ReceiptId): boolean;
  spend(record: SpentRecord): void;
  /** Everything spent so far, for audit and for persistence. Ordering is by insertion. */
  entries(): readonly SpentRecord[];
}

/** An in-memory ledger. Correct, obvious, and lost on restart - which the docs say out loud. */
export function memoryLedger(seed: readonly SpentRecord[] = []): ReceiptLedger {
  const byId = new Map<string, SpentRecord>();
  for (const r of seed) byId.set(r.receipt as string, r);
  return {
    isSpent: (receipt) => byId.has(receipt as string),
    spend: (record) => {
      // Idempotent: the FIRST spend wins, so a duplicate delivery cannot rewrite when it happened.
      if (byId.has(record.receipt as string)) return;
      byId.set(record.receipt as string, record);
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
    isSpent: inner.isSpent,
    spend: (record) => {
      if (inner.isSpent(record.receipt)) return;
      inner.spend(record);
      args.writeFile(args.path, `${JSON.stringify(inner.entries(), null, 2)}\n`);
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
  /** Judge without spending. For callers doing their own transactional burn. */
  decideOnly(input: ContainmentInput): Verdict;
  /** Burn the receipts a verdict named. Idempotent. */
  commit(verdict: Verdict, actionId: string): void;
  readonly ledger: ReceiptLedger;
}

/**
 * Build a guard.
 *
 * `clock` is injected rather than defaulted to `Date.now` so the guard stays testable, and so a host
 * with its own notion of time - a replay harness, a simulation, a deterministic test - can supply it.
 */
export function createGuard(args: {
  readonly ledger?: ReceiptLedger;
  readonly clock: () => number;
}): Guard {
  const ledger = args.ledger ?? memoryLedger();

  const spentSet = (): ReadonlySet<ReceiptId> => new Set(ledger.entries().map((e) => e.receipt));

  const judge = (input: ContainmentInput): Verdict =>
    decide({
      action: input.action,
      sources: input.sources,
      ...(input.receipts !== undefined ? { receipts: input.receipts } : {}),
      ...(input.confirmed !== undefined ? { confirmed: input.confirmed } : {}),
      // The two fields the caller cannot forget, because they cannot supply them.
      now: args.clock(),
      spentReceipts: spentSet(),
    } satisfies DecisionInput);

  const commit = (verdict: Verdict, actionId: string): void => {
    const at = args.clock();
    for (const receipt of verdict.spends) ledger.spend({ receipt, spentAt: at, actionId });
  };

  return {
    ledger,
    decideOnly: judge,
    decide: (input) => {
      const verdict = judge(input);
      commit(verdict, input.action.id as string);
      return verdict;
    },
    commit,
  };
}

/** Re-exported so an integrator needs one import. */
export type { ActionArg, ProposedAction, ReceiptEvidence, Source, Verdict };
