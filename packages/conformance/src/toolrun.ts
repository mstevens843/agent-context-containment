// A tool-run harness with a human in it.
//
// The v0.7 demos prove DECISIONS. They do not prove a WORKFLOW, and the difference is where real
// deployments fail. A decision is one question with one answer. A workflow is what happens after the
// answer is "ask a human": somebody is shown a value, approves it, a receipt is minted, the tool
// finally runs, its output comes back CARRYING PROVENANCE, and later steps see it. Every one of those
// hand-offs is a place a real system loses the thread, and none of them are visible in a table of
// verdicts.
//
// So this models the loop, deterministically and with no model:
//
//   TOOL SPEC     each tool declares its capability manifest binding - which row, which arg roles.
//   PROPOSE       the agent asks to call a tool with arguments drawn from named sources.
//   DECIDE        the guarded API answers, spending receipts through a real ledger.
//   REVIEW        on NEEDS_REVIEW / NEEDS_DECLASSIFICATION a human is shown the EXACT value and
//                 approves or rejects. Approval mints a receipt bound to that slot.
//   EXECUTE       the mock tool runs only after a decision that permits it.
//   FEED BACK     its output becomes a source with provenance and a derivedFrom edge, so a later
//                 step is judged on where the bytes came from rather than what they look like.
//
// TWO THINGS THIS DELIBERATELY REFUSES TO DO. It never executes a tool the policy did not permit -
// the executor is unreachable except through a permitting verdict, which is a structural property
// rather than a rule. And a human approval covers ONE value in ONE slot ONCE: the ledger burns it, so
// the replay is refused by the engine rather than by a flag here.
//
// No network, no model, no randomness, injected clock. Two runs print the same bytes.

import {
  type Capability,
  type ParamRole,
  type Provenance,
  type ReceiptEvidence,
  type Source,
  type Verdict,
  actionId,
  admitConfirmedTuple,
  admitUserConfirmedValue,
  sourceId,
} from "@agent-containment/core";
import { type Guard, createGuard, memoryLedger } from "@agent-containment/ledger";
import {
  type Evidence,
  type ReviewDecision,
  type ReviewField,
  render,
  review,
} from "./reviewer.js";

/** The engine's role names, in the words a dialog would use. The reviewer never sees the role. */
/**
 * What each capability DOES, in a sentence a person could act on.
 *
 * The reviewer gets this and nothing else from the row. `approvalBoundary` prose is a statement of
 * CONSEQUENCE, which a real reviewer has; `effect`, `egress` and the ceilings are THRESHOLDS, which
 * they do not - and a reviewer reading thresholds is agreeing with the engine rather than judging.
 */
const CONSEQUENCE: Readonly<Record<string, string>> = {
  text_response: "Answers the user. Calls nothing and sends nothing.",
  read_only_tool: "Reads. Changes nothing.",
  web_fetch: "Fetches a URL. Changes nothing, and anything in it leaves.",
  email_send: "Sends mail. It leaves and there is no undo.",
  file_write: "Writes a file. Reversible if you have a backup.",
  payment: "Moves money. There is no undo.",
  wallet_sign: "Issues a signature. Transferable authority.",
  transaction_prepare: "Builds a draft for someone to inspect. Nothing happens yet.",
  transaction_broadcast: "Submits a transaction. There is no undo.",
  account_modify: "Changes an account. Hard to reverse.",
};

const MEANING: Readonly<Record<string, ReviewField["means"]>> = {
  sink_identity: "who or where",
  magnitude: "how much",
  selector: "which",
  payload: "what content",
  control: "a flag",
};

/** What a tool declares about itself. The manifest binding, per tool rather than per capability. */
export interface ToolSpec {
  readonly name: string;
  /** Which capability row this tool is bound to. The declaration the engine trusts. */
  readonly capability: Capability;
  /** What each parameter is FOR. Mislabelling one here is the mis-declaration nothing can detect. */
  readonly params: Readonly<Record<string, ParamRole>>;
  /**
   * What the tool returns, and with what provenance.
   *
   * `undefined` means it returns nothing a later step can draw on. A tool that returns third-party
   * content must say so - that label is the entire input to every later decision.
   */
  readonly returns?: { readonly provenance: Provenance; readonly body: string };
}

export interface ProposedCall {
  readonly step: string;
  readonly tool: string;
  /** Argument name to the source it is drawn from, plus the concrete value where one exists. */
  readonly args: readonly {
    readonly name: string;
    readonly from: string;
    readonly value?: string;
  }[];
  /**
   * Whether this step reaches a human at all, and which fields the dialog shows as one decision.
   *
   * NOTE WHAT IS NO LONGER HERE: `approves`. Until v0.9 the scenario declared the reviewer's answer,
   * which proved the receipt path and nothing about judgement - the scenario was telling itself the
   * answer. The reviewer now decides from the bytes (see `reviewer.ts`), and `presented` is rendered
   * rather than authored, so the "the human was shown this value" check became a check on the
   * renderer instead of on the scenario author's typing.
   */
  readonly review?: {
    /** Field names the dialog presents as ONE decision. Whether to ratify them is still the reviewer's call. */
    readonly asOne?: readonly string[];
  };
  readonly confirmed?: boolean;
  readonly note: string;
}

export type StepOutcome =
  | "completed"
  | "completed_after_review"
  | "refused"
  | "stalled_no_reviewer"
  | "refused_by_reviewer"
  /** The reviewer could not tell. Not an approval and not a refusal - the task stops. */
  | "stalled_reviewer_unsure"
  | "refused_on_replay";

export interface WorkflowStepTrace {
  readonly step: string;
  readonly tool: string;
  readonly capability: Capability;
  readonly firstDecision: Verdict["decision"];
  readonly finalDecision: Verdict["decision"];
  readonly outcome: StepOutcome;
  readonly reasons: readonly string[];
  /** How many times a decision was asked for. The cost of a review, in round trips. */
  readonly turns: number;
  readonly executed: boolean;
  readonly receiptsBurned: number;
  /** What the reviewer decided, when one was asked. Reported apart from the engine's answer. */
  readonly reviewerVerdict?: ReviewDecision["verdict"];
  readonly reviewerReason?: string;
}

export interface Workflow {
  readonly id: string;
  readonly domain: string;
  readonly title: string;
  readonly tools: readonly ToolSpec[];
  readonly sources: readonly {
    readonly id: string;
    readonly provenance: Provenance;
    readonly text: string;
  }[];
  readonly steps: readonly ProposedCall[];
  readonly note: string;
}

export interface WorkflowResult {
  readonly id: string;
  readonly domain: string;
  readonly title: string;
  readonly trace: readonly WorkflowStepTrace[];
  readonly completed: number;
  readonly reviewed: number;
  readonly refused: number;
  readonly stalled: number;
  /** Decisions asked for across the whole run. A review costs a turn; a refusal costs one too. */
  readonly turns: number;
  readonly executions: number;
}

const SCOPE_AT = 1_700_000_000_000;

export function runWorkflow(w: Workflow): WorkflowResult {
  let tick = SCOPE_AT;
  const guard: Guard = createGuard({ clock: () => tick++, ledger: memoryLedger() });
  const sources: Source[] = w.sources.map((s) => ({
    id: sourceId(s.id),
    provenance: s.provenance,
  }));
  const known = new Map(w.sources.map((s) => [s.id, s.provenance]));
  // The BYTES, which the engine never sees and the reviewer sees nothing else of. These were already
  // authored on every workflow and every tool spec, and the harness threw them away before v0.9.
  const bodyOf = new Map(w.sources.map((s) => [s.id, s.text]));
  const byName = new Map(w.tools.map((t) => [t.name, t]));
  const trace: WorkflowStepTrace[] = [];
  let executions = 0;

  for (const call of w.steps) {
    const spec = byName.get(call.tool);
    if (spec === undefined)
      throw new Error(`${w.id}/${call.step}: no spec for tool "${call.tool}"`);

    const build = (receipts: readonly ReceiptEvidence[]) => ({
      action: {
        id: actionId(call.step),
        capability: spec.capability,
        tool: spec.name,
        args: call.args.map((a) => {
          const role = spec.params[a.name];
          if (role === undefined) {
            throw new Error(
              `${w.id}/${call.step}: tool "${spec.name}" declares no parameter "${a.name}"`,
            );
          }
          return {
            name: a.name,
            role,
            derivedFrom: [sourceId(a.from)],
            ...(a.value !== undefined ? { value: a.value } : {}),
          };
        }),
      },
      sources,
      receipts,
      ...(call.confirmed !== undefined ? { confirmed: call.confirmed } : {}),
    });

    let turns = 1;
    let reviewerVerdict: ReviewDecision["verdict"] | undefined;
    let reviewerReason: string | undefined;
    let verdict = guard.decide(build([]));
    const first = verdict.decision;
    let outcome: StepOutcome;
    let burned = verdict.spends.length;

    if (verdict.decision === "ALLOW") {
      outcome = "completed";
    } else if (call.review === undefined) {
      // Nobody can approve it. This is the STALL - the user's task simply does not get done, and it
      // is the outcome a safety-only report never shows.
      outcome = "stalled_no_reviewer";
    } else {
      // ---- ask a reviewer that does not know the answer ---------------------------------------
      // It gets the BYTES - the values, the evidence, the consequence in prose. It is denied the
      // taint lattice, the ceilings, the policy table and the verdict it is reviewing. That denial
      // is what lets the two disagree, and two mechanisms that cannot disagree are one mechanism.
      const fields: ReviewField[] = call.args.map((a) => ({
        name: a.name,
        means: MEANING[spec.params[a.name] ?? "payload"] ?? "what content",
        value: a.value,
        fromId: a.from,
        fromKind: known.get(a.from) ?? "TOOL_OUTPUT",
      }));
      const evidence: Evidence[] = [...known.entries()].map(([id, kind]) => ({
        id,
        kind,
        text: bodyOf.get(id) ?? "",
      }));
      const decision = review({
        step: call.step,
        tool: spec.name,
        consequence: CONSEQUENCE[spec.capability] ?? "Performs an action.",
        presented: render(spec.name, CONSEQUENCE[spec.capability] ?? "Performs an action.", fields),
        fields,
        asOne: call.review.asOne ?? [],
        evidence,
      });
      reviewerVerdict = decision.verdict;
      reviewerReason = "because" in decision ? decision.because : undefined;

      if (decision.verdict === "reject") {
        outcome = "refused_by_reviewer";
      } else if (decision.verdict === "cannot_tell") {
        outcome = "stalled_reviewer_unsure";
      } else {
        // ---- the review ----------------------------------------------------------------------
        // The reviewer said yes. The receipt that comes back is bound to this capability, this role,
        // this argument and this value - not to the source, not to the tool, and not to the person.
        const receipts: ReceiptEvidence[] = [];
        const presented = render(
          spec.name,
          CONSEQUENCE[spec.capability] ?? "Performs an action.",
          fields,
        );
        const scope = {
          nonce: `${w.id}-${call.step}`,
          issuedAt: SCOPE_AT,
          expiresAt: null,
          source: sourceId(call.args[0]?.from ?? "task"),
        };
        if (decision.verdict === "approve_together" && call.args.length > 1) {
          const t = admitConfirmedTuple({
            entries: call.args.map((a) => ({ argName: a.name, value: a.value ?? "" })),
            presented: presented,
            capability: spec.capability,
            role: spec.params[call.args[0]?.name ?? ""] ?? "sink_identity",
            lifts: "UNTRUSTED_EXTERNAL",
            scope,
          });
          if (t !== undefined) receipts.push(t);
        }
        for (const a of call.args) {
          if (a.value === undefined) continue;
          const r = admitUserConfirmedValue({
            candidate: a.value,
            presented: presented,
            capability: spec.capability,
            role: spec.params[a.name] ?? "payload",
            argName: a.name,
            lifts: "UNTRUSTED_EXTERNAL",
            scope,
          });
          if (r !== undefined) receipts.push(r);
        }
        turns++;
        verdict = guard.decide(build(receipts));
        burned += verdict.spends.length;
        outcome = verdict.decision === "ALLOW" ? "completed_after_review" : "refused";

        // ---- the replay ------------------------------------------------------------------------
        // If the approval worked, immediately try it again with the SAME receipts. A retried queue
        // message, a double-clicked button, a captured request. The ledger has burned them, so the
        // engine refuses - and it is the engine, with its own reason code, not a flag in this file.
        if (outcome === "completed_after_review") {
          turns++;
          const again = guard.decide(build(receipts));
          if (again.decision === "ALLOW") {
            throw new Error(
              `${w.id}/${call.step}: a burned approval was accepted a second time - replay protection is not working`,
            );
          }
        }
      }
    }

    const permitted = outcome === "completed" || outcome === "completed_after_review";
    if (permitted) {
      // THE EXECUTOR IS UNREACHABLE EXCEPT HERE. Not a rule somebody has to follow - the only call
      // site is inside a branch guarded by a permitting verdict.
      executions++;
      if (spec.returns !== undefined) {
        const produced = `${call.step}-out`;
        bodyOf.set(produced, spec.returns.body);
        sources.push({
          id: sourceId(produced),
          provenance: spec.returns.provenance,
          derivedFrom: [sourceId(call.args[0]?.from ?? "task")],
        });
        known.set(produced, spec.returns.provenance);
      }
    }

    trace.push({
      step: call.step,
      tool: spec.name,
      capability: spec.capability,
      firstDecision: first,
      finalDecision: verdict.decision,
      outcome,
      reasons: verdict.reasons.map((r) => r.code),
      turns,
      executed: permitted,
      receiptsBurned: burned,
      ...(reviewerVerdict !== undefined ? { reviewerVerdict } : {}),
      ...(reviewerReason !== undefined ? { reviewerReason } : {}),
    });
  }

  return {
    id: w.id,
    domain: w.domain,
    title: w.title,
    trace,
    completed: trace.filter((t) => t.outcome === "completed").length,
    reviewed: trace.filter((t) => t.outcome === "completed_after_review").length,
    refused: trace.filter(
      (t) =>
        t.outcome === "refused" ||
        t.outcome === "refused_by_reviewer" ||
        t.outcome === "refused_on_replay",
    ).length,
    stalled: trace.filter((t) => t.outcome === "stalled_no_reviewer").length,
    turns: trace.reduce((n, t) => n + t.turns, 0),
    executions,
  };
}

const pad = (s: string, n: number): string => s.padEnd(n);

export function formatWorkflows(results: readonly WorkflowResult[]): string {
  const rule = "=".repeat(104);
  const lines = [rule, "tool-run workflows - propose, decide, review, execute, feed back", rule];

  for (const r of results) {
    lines.push("");
    lines.push(`  ${r.domain.toUpperCase()}  ${r.title}`);
    lines.push(`  ${"-".repeat(100)}`);
    for (const t of r.trace) {
      const arrow =
        t.firstDecision === t.finalDecision
          ? t.finalDecision
          : `${t.firstDecision} -> ${t.finalDecision}`;
      lines.push(`    ${pad(t.step, 40)}${pad(t.outcome, 24)}${pad(arrow, 32)}${t.turns} turn(s)`);
      if (t.reasons.length > 0) lines.push(`      ${t.reasons.join(", ")}`);
    }
    lines.push(
      `    -> ${r.completed} straight through, ${r.reviewed} after review, ${r.refused} refused, ${r.stalled} stalled; ${r.executions} tool call(s) actually executed`,
    );
  }

  const sum = (k: keyof WorkflowResult): number =>
    results.reduce((n: number, r: WorkflowResult) => n + (r[k] as number), 0);
  lines.push("");
  lines.push(`  ${"-".repeat(100)}`);
  lines.push("  ACROSS ALL WORKFLOWS");
  lines.push(`  ${"-".repeat(100)}`);
  lines.push(`    safe steps completed             ${sum("completed") + sum("reviewed")}`);
  lines.push(`      of which needed a human        ${sum("reviewed")}`);
  lines.push(`    unsafe steps refused             ${sum("refused")}`);
  lines.push(`    stalled - nobody could approve   ${sum("stalled")}`);
  lines.push(
    `    decisions asked for              ${sum("turns")}   (a review costs a turn; so does a replay attempt)`,
  );
  lines.push(`    tool calls actually executed     ${sum("executions")}`);

  // ---- judgement, reported apart from mechanics ----------------------------------------------
  // Two different claims. A good number in one says nothing about the other, and merging them would
  // let a working receipt path read as evidence that the reviewer is any good.
  const asked = results.flatMap((r) => r.trace).filter((t) => t.reviewerVerdict !== undefined);
  const byVerdict = new Map<string, number>();
  for (const t of asked) {
    byVerdict.set(
      t.reviewerVerdict as string,
      (byVerdict.get(t.reviewerVerdict as string) ?? 0) + 1,
    );
  }
  lines.push("");
  lines.push(`  ${"-".repeat(100)}`);
  lines.push("  REVIEWER JUDGEMENT - a separate claim from the mechanics above");
  lines.push(`  ${"-".repeat(100)}`);
  lines.push(`    reviews asked for                ${asked.length}`);
  for (const [v, n] of [...byVerdict.entries()].sort()) {
    lines.push(`      ${v.padEnd(30)}${n}`);
  }
  lines.push("");
  lines.push(
    "    The reviewer decides from the BYTES - the values, the evidence, the consequence in",
  );
  lines.push(
    "    prose. It is structurally denied the taint lattice, the ceilings, the policy table",
  );
  lines.push(
    "    and the verdict it is reviewing, and a test scans its source for that vocabulary.",
  );
  lines.push("    Two mechanisms that cannot disagree are one mechanism.");
  lines.push("");
  lines.push("    WHAT THIS DOES NOT CLAIM: that a real human decides this way. It is a rule set");
  lines.push(
    "    somebody wrote down, and its worth is that the rules are legible and can be WRONG -",
  );
  lines.push(
    "    reviewer.test.ts holds a case where it is fooled and the engine is not, and another",
  );
  lines.push("    where it is right and the engine is conservative.");
  lines.push("");
  lines.push(
    "  Every approval was consumed exactly once: each reviewed step immediately retries with",
  );
  lines.push(
    "  the same receipts, and the run throws if one is accepted twice. The replay is refused",
  );
  lines.push("  by the engine with its own reason code, not by a flag in the harness.");
  lines.push("");
  lines.push(
    "  The stalled row is the one a safety-only report never shows. A policy that refuses",
  );
  lines.push(
    "  everything scores perfectly on the refused row and turns every task into that one.",
  );
  lines.push(rule);
  return lines.join("\n");
}
