// TWO GUARDS, ONE LEDGER, and the exact size of what that proves.
//
// WHAT IT IS. Two `Guard` instances built over ONE `ReceiptLedger`, handed one valid receipt, and
// asked to spend it in every interleaving this process can produce. Exactly one may win.
//
// WHAT IT IS NOT, and this is the part that must not drift. **This is two guards and one IN-PROCESS
// ledger. It is not deployment topology and it is not database concurrency.** A single-threaded
// JavaScript runtime interleaves these calls cooperatively; there is no preemption, no second
// connection, no network, and no crash. `memoryLedger` itself declares `singleProcess: true` and
// everything else false, and this file believes it.
//
// So the boundary, stated once:
//
//   this file          the ENGINE and GUARD honour a shared store when two of them race in one process
//   prove:crosshost    the adapter logic under interleavings the harness schedules
//   prove:postgres     two INDEPENDENT CONNECTIONS racing one row in a real database
//   nothing here       that YOUR hosts reach the same database. That is infrastructure.
//
// `searchLedgerReplay` in ledgersearch.ts is the sequential half - one guard, many actions. This is
// the concurrent half at the only scale a pure library can reach. Section 41 closed the first;
// section 42 closes as much of the second as is honest, and names the rest.
//
// THE CONTROL IS THE POINT. Two guards over SEPARATE ledgers must let the same receipt through
// twice. Without that, "exactly one won" is satisfied by a harness that only ever calls one guard.

import type { ReceiptId } from "@agent-context-containment/core";
import { type ReceiptLedger, createGuard, memoryLedger } from "@agent-context-containment/ledger";

/** How the two guards are ordered against each other. All of them are cooperative, none preemptive. */
export const INTERLEAVINGS = [
  "sequential",
  "reverse",
  "both_judged_then_both_committed",
  "a_judges_b_completes_a_commits",
] as const;

export type Interleaving = (typeof INTERLEAVINGS)[number];

export interface TwoGuardOutcome {
  readonly interleaving: Interleaving;
  /** How many of the two guards recorded the spend. Anything but 1 is a finding. */
  readonly winners: number;
  /** How many were told the receipt was already gone. */
  readonly losers: number;
  /** ALLOW verdicts. Two guards may both ALLOW and still have exactly one winner - see below. */
  readonly allowed: number;
}

export interface TwoGuardResult {
  readonly outcomes: readonly TwoGuardOutcome[];
  readonly findings: readonly string[];
}

/**
 * Run one receipt through two guards, in every interleaving, and count the winners.
 *
 * `sharedLedger: false` is the negative control: two guards over separate stores must BOTH win, which
 * is the replay this whole mechanism exists to prevent.
 */
export function twoGuardsOneReceipt(opts?: {
  readonly sharedLedger?: boolean;
  readonly ledger?: ReceiptLedger;
  readonly ledgerB?: ReceiptLedger;
}): TwoGuardResult {
  const shared = opts?.sharedLedger ?? true;
  const findings: string[] = [];
  const outcomes: TwoGuardOutcome[] = [];
  const NOW = 1_700_000_000_000;

  for (const interleaving of INTERLEAVINGS) {
    // A FRESH PAIR PER INTERLEAVING. Carrying one ledger across them would mean every interleaving
    // after the first began with the receipt already burned, so three of the four would report
    // "exactly one winner" by having nothing to win - the vacuity this repository keeps finding.
    const ledgerA = opts?.ledger ?? memoryLedger();
    const ledgerB = shared ? ledgerA : (opts?.ledgerB ?? memoryLedger());
    const a = createGuard({ ledger: ledgerA, clock: () => NOW });
    const b = createGuard({ ledger: ledgerB, clock: () => NOW });

    const receiptId = "r-shared" as ReceiptId;
    const build = (actionId: string) => ({
      action: {
        id: actionId,
        capability: "web_fetch",
        tool: "http.get",
        args: [
          {
            name: "url",
            role: "sink_identity",
            value: "https://ok.example",
            path: "url",
            derivedFrom: ["s0"],
          },
        ],
      },
      sources: [{ id: "s0", provenance: "WEB" }],
      receipts: [
        {
          id: receiptId,
          rule: "allowlist_member",
          capability: "web_fetch",
          role: "sink_identity",
          argName: "url",
          argPath: "url",
          lifts: "UNTRUSTED_EXTERNAL",
          admitted: "https://ok.example",
          scope: {
            nonce: "n",
            issuedAt: NOW - 1_000,
            expiresAt: NOW + 60_000,
            source: "s0",
          },
        },
      ],
      confirmed: false,
    });

    let vA: { decision: string; spends: readonly ReceiptId[] };
    let vB: { decision: string; spends: readonly ReceiptId[] };
    switch (interleaving) {
      case "reverse":
        vB = b.decide(build("act-b") as never);
        vA = a.decide(build("act-a") as never);
        break;
      case "both_judged_then_both_committed": {
        // THE DANGEROUS SHAPE, and the reason `decideOnly` carries the warning it does. Both judge
        // against a ledger in which nothing is spent yet, and only then does either commit.
        //
        // MEASURED: this interleaving is the one where BOTH guards return ALLOW and only ONE commit
        // records. A caller who acted on the verdict from `decideOnly` without checking what
        // `commit` returned would have performed the action twice. The other three interleavings
        // refuse the second guard before it allows; this one cannot, because neither has committed
        // yet when both judge. That is the `commit` return value earning its existence.
        const jA = a.decideOnly(build("act-a") as never);
        const jB = b.decideOnly(build("act-b") as never);
        const lostA = a.commit(jA, "act-a");
        const lostB = b.commit(jB, "act-b");
        const winners = (lostA.length === 0 ? 1 : 0) + (lostB.length === 0 ? 1 : 0);
        const allowed = (jA.decision === "ALLOW" ? 1 : 0) + (jB.decision === "ALLOW" ? 1 : 0);
        outcomes.push({ interleaving, winners, losers: 2 - winners, allowed });
        if (shared && winners !== 1) {
          findings.push(
            `${interleaving}: ${winners} guard(s) recorded the spend over a shared ledger; exactly one may`,
          );
        }
        if (!shared && winners !== 2) {
          findings.push(
            `${interleaving}: the control expected both guards to win over separate ledgers and ${winners} did`,
          );
        }
        continue;
      }
      case "a_judges_b_completes_a_commits": {
        // A GENUINELY DIFFERENT ORDER, and the first version of this entry was not one. It was named
        // `interleaved_await` and ran exactly the two calls `sequential` runs, in the same order - a
        // fourth shape that was a copy of the first, reporting "exactly one winner" for the same
        // reason and adding nothing. Here A judges while the ledger is clean, B runs to completion in
        // between, and only then does A commit: the stale-verdict window, which is the one an
        // async caller actually lives in.
        const jA = a.decideOnly(build("act-a") as never);
        const vBfull = b.decide(build("act-b") as never);
        const lostA = a.commit(jA, "act-a");
        const winners =
          (lostA.length === 0 && jA.spends.length > 0 ? 1 : 0) +
          (vBfull.spends.includes(receiptId) ? 1 : 0);
        const allowed = (jA.decision === "ALLOW" ? 1 : 0) + (vBfull.decision === "ALLOW" ? 1 : 0);
        outcomes.push({ interleaving, winners, losers: 2 - winners, allowed });
        if (shared && winners !== 1) {
          findings.push(
            `${interleaving}: ${winners} guard(s) recorded the spend over a shared ledger; exactly one may`,
          );
        }
        if (!shared && winners !== 2) {
          findings.push(
            `${interleaving}: the control expected both guards to win over separate ledgers and ${winners} did`,
          );
        }
        continue;
      }
      default:
        vA = a.decide(build("act-a") as never);
        vB = b.decide(build("act-b") as never);
    }

    // `decide()` burns on ALLOW, so a guard that ALLOWed and whose ledger holds the receipt is the
    // winner. Counting ALLOWs alone would not do: over a shared ledger the second guard is refused
    // BEFORE it allows, which is the behaviour under test.
    const winners = [vA, vB].filter((v) => v.spends.includes(receiptId)).length;
    const allowed = [vA, vB].filter((v) => v.decision === "ALLOW").length;
    outcomes.push({ interleaving, winners, losers: 2 - winners, allowed });

    if (shared && winners !== 1) {
      findings.push(
        `${interleaving}: ${winners} guard(s) spent one receipt over a shared ledger; exactly one may`,
      );
    }
    if (shared && ledgerA.entries().length !== 1) {
      findings.push(
        `${interleaving}: the shared ledger holds ${ledgerA.entries().length} entries for one receipt`,
      );
    }
    if (!shared && winners !== 2) {
      findings.push(
        `${interleaving}: the control expected both guards to win over separate ledgers and ${winners} did`,
      );
    }
  }

  return { outcomes, findings };
}
