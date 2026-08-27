// A fourth search, over SEQUENCES of actions sharing one real ledger.
//
// WHY IT IS A SEPARATE FILE. `searchReceipts` explores one `decide()` call per iteration and hands it
// `spentReceipts` as a `Set` this process built. That models replay only by PRE-SEEDING the set: the
// search never spends anything, so a receipt is "already spent" because the generator said so, never
// because an earlier action used it. `docs/LIMITATIONS.md` row 14 has named that gap since the search
// was written - "spentReceipts is a Set this process builds, not a database" and "there are no
// multi-step runs".
//
// This closes the second half of it. Every iteration runs through a real `Guard` built over a real
// `ReceiptLedger`, and the ledger CARRIES ACROSS ITERATIONS. A receipt admitted at iteration 40 is
// burned in the ledger, and when iteration 90 presents the same id the refusal comes from the store
// rather than from a fixture. That is replay across actions, which is the property the ledger package
// exists for and which no search reached before.
//
// WHAT IT STILL IS NOT, and row 14 keeps saying so: one process, one ledger, no concurrency. The
// adapter's cross-host and crash behaviour is `pnpm prove:crosshost`, `pnpm prove:asyncledger` and
// `pnpm prove:postgres`. This proves the ENGINE honours a ledger that a real adapter maintains; it
// proves nothing about what happens when two of them race, which is a different claim with its own
// proofs. See DEFECTS_FOUND.md section 41.
//
// THE ORACLE IS A SECOND SPEND MODEL, written here and never asking the ledger. It records which
// receipt ids IT believes were consumed, by its own reading of the rules, and a disagreement with the
// engine is the finding - the same arrangement as the taint oracle in adversary.ts.

import {
  CAPABILITY_POLICY,
  type Capability,
  type CapabilityPolicy,
  type CapabilityRow,
  type ReceiptEvidence,
  type ReceiptId,
  type Taint,
  joinTaint,
  taintOf,
} from "@agent-context-containment/core";
import { type ReceiptLedger, createGuard, memoryLedger } from "@agent-context-containment/ledger";
import type { AdversaryFinding, AdversaryResult } from "./adversary.js";

/** Seeded, duplicated rather than shared, for the reason malformed.ts gives. */
const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
};

const RANK: Readonly<Record<string, number>> = {
  CLEAN: 0,
  USER_CONTROLLED: 1,
  TOOL_DERIVED: 2,
  UNTRUSTED_EXTERNAL: 3,
};

const STEERING = new Set(["sink_identity", "magnitude", "control"]);
const KNOWN = new Set(["sink_identity", "magnitude", "selector", "payload", "control"]);

/**
 * The ceiling rule, restated rather than imported, so a wrong rule cannot move both sides.
 *
 * THE STEERING CLAMP IS THE HALF THAT MATTERS, and the first version of this function dropped it -
 * both branches of its ternary returned `defaultCeiling`. A steering role on a row whose default is
 * loose is clamped to USER_CONTROLLED, so MORE arguments are over their ceiling than the sloppy rule
 * says. The oracle therefore believed no receipt was needed in cases where the engine spent one,
 * never recorded those spends in its own set, and then reported 44 `over_block` findings when a
 * later iteration replayed an id the engine had correctly burned. A spend model that mis-reads the
 * ceiling is not a spend model. See DEFECTS_FOUND.md section 41.
 */
const ceilingOf = (row: CapabilityRow, role: string): Taint => {
  const explicit = (row.roleCeilings as Readonly<Record<string, Taint>>)[role];
  if (explicit !== undefined) return explicit;
  if (!KNOWN.has(role)) return "CLEAN";
  if (!STEERING.has(role)) return row.defaultCeiling;
  return (RANK[row.defaultCeiling] ?? 3) <= 1 ? row.defaultCeiling : "USER_CONTROLLED";
};

/** The shapes of a SEQUENCE, which is what this search adds over the single-action one. */
export const LEDGER_SHAPES = [
  "fresh_receipt",
  "replay_previous",
  "replay_much_later",
  "fresh_after_replay",
  "two_actions_one_id",
] as const;

export type LedgerShape = (typeof LEDGER_SHAPES)[number];

export interface LedgerSearchResult extends AdversaryResult {
  /** Iterations that presented an id the ORACLE had already seen consumed. The vacuity floor. */
  readonly replaysAttempted: number;
  /** Iterations where a receipt was genuinely admitted and burned. */
  readonly spends: number;
}

export function searchLedgerReplay(opts: {
  readonly iterations: number;
  readonly seed?: number;
  readonly policy?: CapabilityPolicy;
  /** A real adapter. Defaults to `memoryLedger`; the Postgres proof passes its own. */
  readonly ledger?: ReceiptLedger;
}): LedgerSearchResult {
  const policy = opts.policy ?? CAPABILITY_POLICY;
  const next = rng(opts.seed ?? 0x1ed6e401);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;

  const liftable = (Object.keys(policy) as Capability[]).filter(
    (c) => policy[c].liftableBy.size > 0,
  );
  if (liftable.length === 0) {
    throw new Error(
      "searchLedgerReplay: no row in this policy lifts by anything, so no receipt is ever admitted and nothing can be spent.",
    );
  }

  const NOW = 1_700_000_000_000;
  const ledger = opts.ledger ?? memoryLedger();
  // THE REAL GUARD, not a hand-rolled loop. `decide()` judges and burns in one call, which is the
  // path a deployment takes; re-implementing that here would test a copy of it.
  const guard = createGuard({ ledger, clock: () => NOW });

  const findings: AdversaryFinding[] = [];
  const shapes: Record<string, number> = {};
  /** THE ORACLE'S OWN SPEND SET. Never asks the ledger; a disagreement is the finding. */
  const oracleSpent = new Set<string>();
  /** Every id this search has ever issued, so a later iteration can reach back for one. */
  const issued: string[] = [];
  let replaysAttempted = 0;
  let spends = 0;

  for (let i = 0; i < opts.iterations; i++) {
    const capability = pick(liftable);
    const row = policy[capability] as CapabilityRow;
    const role = pick(["sink_identity", "magnitude", "control", "payload", "selector"] as const);
    const provenance = pick(["WEB", "EMAIL", "DOCUMENT", "RETRIEVED"] as const);
    const taint = joinTaint("CLEAN", taintOf(provenance));

    // Reaching back is only possible once something has been issued, and only worth doing once
    // something has been SPENT - a replay of an id that never worked proves nothing about the store.
    const canReplay = oracleSpent.size > 0;
    const shape: LedgerShape = canReplay
      ? pick(LEDGER_SHAPES)
      : pick(["fresh_receipt", "two_actions_one_id"] as const);
    shapes[shape] = (shapes[shape] ?? 0) + 1;

    const spentList = [...oracleSpent];
    const receiptId = ((): string => {
      switch (shape) {
        case "replay_previous":
          return spentList[spentList.length - 1] as string;
        case "replay_much_later":
          return spentList[0] as string;
        case "fresh_after_replay":
          return `r-${i}`;
        case "two_actions_one_id":
          // Deliberately reuses an id that may or may not have been spent yet.
          return issued.length > 0 && next() < 0.5 ? (pick(issued) as string) : `r-${i}`;
        default:
          return `r-${i}`;
      }
    })();
    issued.push(receiptId);

    const rules = [...row.liftableBy];
    const rule = rules[Math.floor(next() * rules.length)] ?? "user_confirmed_value";
    const argName = `arg-${i}`;
    const value = `v-${i}`;
    const sourceId = `s-${i}`;

    const receipt = {
      id: receiptId as ReceiptId,
      rule,
      capability,
      role,
      argName,
      argPath: argName,
      lifts: "UNTRUSTED_EXTERNAL",
      admitted: value,
      scope: {
        nonce: `n-${i}`,
        issuedAt: NOW - 1_000,
        expiresAt: NOW + 60_000,
        source: sourceId,
      },
    } as unknown as ReceiptEvidence;

    const input = {
      action: {
        id: `led-${i}`,
        capability,
        tool: `tool-${i}`,
        args: [{ name: argName, role, value, path: argName, derivedFrom: [sourceId] }],
      },
      sources: [{ id: sourceId, provenance }],
      receipts: [receipt],
      confirmed: row.requiresConfirmation === true,
    };

    // ---- what the ORACLE says, before asking the engine ------------------------------------
    const overCeiling = (RANK[taint] ?? 3) > (RANK[ceilingOf(row, role)] ?? 0);
    const alreadySpent = oracleSpent.has(receiptId);
    if (overCeiling && alreadySpent) replaysAttempted++;
    // A receipt is valid here unless the store has already burned it. Everything else about this
    // receipt is built to match, so the spend state is the only variable.
    const oracleAdmits = !overCeiling || !alreadySpent;

    let verdict: ReturnType<typeof guard.decide>;
    try {
      verdict = guard.decide(input as never);
    } catch (e) {
      findings.push({
        kind: "never_throws",
        iteration: i,
        capability,
        detail: `guard.decide threw ${(e as Error).name}: ${String((e as Error).message).slice(0, 120)}`,
        input: input as never,
      });
      continue;
    }

    const allowed = verdict.decision === "ALLOW";

    if (allowed && !oracleAdmits) {
      findings.push({
        kind: "under_block",
        iteration: i,
        capability,
        detail: `shape ${shape}: ALLOWed with receipt ${receiptId}, which an earlier action already spent`,
        input: input as never,
      });
    }
    if (!allowed && oracleAdmits && overCeiling) {
      findings.push({
        kind: "over_block",
        iteration: i,
        capability,
        detail: `shape ${shape}: refused although receipt ${receiptId} is unspent and covers the argument`,
        input: input as never,
      });
    }

    // ---- THE LEDGER'S OWN CONTRACT, which the Set could not express -------------------------
    // Whatever the verdict says it spent must actually be in the store afterwards. A guard that
    // reports a spend it did not record is defect section 10's shape, one layer up.
    for (const id of verdict.spends) {
      if (!ledger.isSpent(id)) {
        findings.push({
          kind: "wrong_admission",
          iteration: i,
          capability,
          detail: `the verdict reported spending ${id} and the ledger does not hold it`,
          input: input as never,
        });
      }
    }

    if (allowed && overCeiling) {
      spends++;
      oracleSpent.add(receiptId);
    }
  }

  return {
    explored: opts.iterations,
    findings,
    // `cleanExplored` is the shared field the report prints. For this search the number that says
    // whether it did anything is the REPLAY count: a run that never re-presented a burned id cannot
    // tell a store that refuses replays from one that has no memory at all.
    cleanExplored: replaysAttempted,
    shapes,
    replaysAttempted,
    spends,
  };
}
