// A deterministic agent-run simulator.
//
// `tasks.ts` scores scripted step sequences: a fixed list of decisions, run in order. That is closer
// to a user's experience than a single decision and it is still not an agent run, because it is
// missing the thing that makes agent runs hard - THE AGENT REACTS.
//
// A real loop does not execute a fixed list. It plans, calls a tool, reads what comes back, and picks
// its next step from that. Which means untrusted content does not merely flow into one argument: it
// arrives mid-run and changes what the agent tries NEXT. That is the whole indirect-injection threat
// model, and a scripted list cannot express it.
//
// So this simulator has:
//
//   a PLAN the agent starts with;
//   TOOL RESULTS that arrive during the run and carry provenance;
//   a REACTION rule - what the agent attempts after seeing a result;
//   and a policy consulted before every step, which may refuse, escalate, or allow.
//
// No model, no network, no randomness. The agent's reactions are declared per scenario, so the run is
// reproducible and a failure means the policy changed rather than the dice. That is a real limitation
// and it is the right trade: a simulator that called a model would be measuring the model.

import type {
  Capability,
  CapabilityPolicy,
  ParamRole,
  Provenance,
  ReceiptEvidence,
  Source,
  Verdict,
} from "@agent-context-containment/core";
import { actionId, decide, sourceId } from "@agent-context-containment/core";

/** Something the agent tries to do. */
export interface PlannedStep {
  readonly name: string;
  readonly capability: Capability;
  readonly role: ParamRole;
  /** The source id this step's argument is built from. */
  readonly from: string;
  /**
   * What this step produces if it runs, and where the bytes come from.
   *
   * The mechanism that makes this an agent run rather than a script: a step's output becomes a source
   * later steps can draw on, carrying its own provenance and its own `derivedFrom` edge. Untrusted
   * content entering at step 2 is visible to the policy at step 5.
   */
  readonly produces?: { readonly id: string; readonly provenance: Provenance };
  /** Steps the agent only attempts if this one was allowed. Reaction, not script. */
  /**
   * Named `onAllowed` rather than `then` on purpose: an object with a `then` property is a
   * THENABLE, so JavaScript would try to call it if one were ever awaited or returned from an async
   * function. Biome's `noThenProperty` caught it, and it was right to.
   */
  readonly onAllowed?: readonly PlannedStep[];
  /**
   * Declassifications the agent presents for this step.
   *
   * Added for the adversarial planner, which needs to attempt steps that carry a receipt issued for
   * a DIFFERENT slot - the failure mode a hand-written scenario never gets around to writing, because
   * you have to already suspect it to write it.
   */
  readonly receipts?: readonly ReceiptEvidence[];
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  /** Sources present before the run starts. */
  readonly initial: readonly Source[];
  readonly plan: readonly PlannedStep[];
  /** What a correct run looks like. */
  readonly expect: {
    /** Steps that must be allowed and performed. */
    readonly completes: readonly string[];
    /** Steps that must be escalated to a human. */
    readonly escalates: readonly string[];
    /** Steps that must be refused. */
    readonly refuses: readonly string[];
  };
  readonly note: string;
}

export interface StepTrace {
  readonly step: string;
  readonly capability: Capability;
  readonly decision: Verdict["decision"];
  readonly performed: boolean;
  /** True when the step was never attempted, because a step it depended on did not run. */
  readonly skipped: boolean;
  readonly reasons: readonly string[];
}

export interface RunResult {
  readonly id: string;
  readonly trace: readonly StepTrace[];
  readonly completed: readonly string[];
  readonly escalated: readonly string[];
  readonly refused: readonly string[];
  readonly skipped: readonly string[];
  /** The run did exactly what the scenario said it should. */
  readonly correct: boolean;
  /** Safe steps that ran even though a later step was refused. The anti-deny-all measure. */
  readonly safeStepsPreserved: number;
}

/**
 * Execute one scenario.
 *
 * A refused step does not abort the run - its dependents are skipped and everything independent keeps
 * going. That is deliberate and it is the property the whole simulator exists to measure: a policy
 * that turns one refusal into a dead run is indistinguishable, from the user's seat, from a policy
 * that refuses everything.
 */
export function runScenario(scenario: Scenario, policy?: CapabilityPolicy): RunResult {
  const sources: Source[] = [...scenario.initial];
  const trace: StepTrace[] = [];

  const execute = (steps: readonly PlannedStep[], reachable: boolean): void => {
    for (const step of steps) {
      if (!reachable) {
        trace.push({
          step: step.name,
          capability: step.capability,
          decision: "DENY",
          performed: false,
          skipped: true,
          reasons: [],
        });
        if (step.onAllowed !== undefined) execute(step.onAllowed, false);
        continue;
      }

      const verdict = decide(
        {
          action: {
            id: actionId(step.name),
            capability: step.capability,
            tool: step.name,
            args: [{ name: "arg", role: step.role, derivedFrom: [sourceId(step.from)] }],
          },
          sources,
          ...(step.receipts !== undefined ? { receipts: step.receipts } : {}),
        },
        policy,
      );
      const performed = verdict.decision === "ALLOW";

      // A performed step's output joins the run's context, so what a tool returns mid-run is visible
      // to the policy at every later step. This is the line that makes it a run.
      if (performed && step.produces !== undefined) {
        sources.push({
          id: sourceId(step.produces.id),
          provenance: step.produces.provenance,
          derivedFrom: [sourceId(step.from)],
        });
      }

      trace.push({
        step: step.name,
        capability: step.capability,
        decision: verdict.decision,
        performed,
        skipped: false,
        reasons: verdict.reasons.map((r) => r.code),
      });
      if (step.onAllowed !== undefined) execute(step.onAllowed, performed);
    }
  };

  execute(scenario.plan, true);

  const completed = trace.filter((t) => t.performed).map((t) => t.step);
  const escalated = trace
    .filter((t) => t.decision === "NEEDS_REVIEW" && !t.skipped)
    .map((t) => t.step);
  const refused = trace
    .filter((t) => !t.skipped && (t.decision === "DENY" || t.decision === "NEEDS_DECLASSIFICATION"))
    .map((t) => t.step);
  const skipped = trace.filter((t) => t.skipped).map((t) => t.step);

  const same = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();

  return {
    id: scenario.id,
    trace,
    completed,
    escalated,
    refused,
    skipped,
    correct:
      same(completed, scenario.expect.completes) &&
      same(escalated, scenario.expect.escalates) &&
      same(refused, scenario.expect.refuses),
    safeStepsPreserved: refused.length > 0 ? completed.length : 0,
  };
}

export interface RunReport {
  readonly results: readonly RunResult[];
  readonly correct: number;
  readonly stalled: number;
  readonly unsafePrevented: number;
  readonly safeStepsPreserved: number;
}

export function runScenarios(scenarios: readonly Scenario[], policy?: CapabilityPolicy): RunReport {
  const results = scenarios.map((s) => runScenario(s, policy));
  return {
    results,
    correct: results.filter((r) => r.correct).length,
    // A run where nothing at all got done. The user's experience of a policy that is too tight.
    stalled: results.filter((r) => r.completed.length === 0).length,
    unsafePrevented: results.reduce((n, r) => n + r.refused.length, 0),
    safeStepsPreserved: results.reduce((n, r) => n + r.safeStepsPreserved, 0),
  };
}

export function formatRuns(report: RunReport): string {
  const rule = "=".repeat(86);
  const lines = [
    rule,
    "agent-run simulation - multi-step plans with mid-run tool results",
    rule,
    "",
  ];
  lines.push(
    `  ${"scenario".padEnd(26)}${"done".padEnd(7)}${"escal".padEnd(7)}${"refused".padEnd(9)}${"skipped".padEnd(9)}ok`,
  );
  lines.push(`  ${"-".repeat(82)}`);
  for (const r of report.results) {
    lines.push(
      `  ${r.id.padEnd(26)}${String(r.completed.length).padEnd(7)}${String(r.escalated.length).padEnd(7)}` +
        `${String(r.refused.length).padEnd(9)}${String(r.skipped.length).padEnd(9)}${r.correct ? "yes" : "NO"}`,
    );
  }
  const n = report.results.length;
  lines.push("");
  lines.push(`  runs correct              ${report.correct}/${n}`);
  lines.push(`  unsafe steps prevented    ${report.unsafePrevented}`);
  lines.push(
    `  safe steps still done in runs that refused something   ${report.safeStepsPreserved}`,
  );
  lines.push(`  STALLED (nothing got done) ${report.stalled}/${n}`);
  lines.push("");
  lines.push(
    "  The last two lines are the point. A policy that refuses everything scores perfectly",
  );
  lines.push(
    "  on `unsafe steps prevented` and zero on the other two, and that is what separates a",
  );
  lines.push("  containment policy from a switch marked OFF.");
  lines.push("");
  lines.push("  Reactions are declared per scenario rather than chosen by a model, so a run is");
  lines.push("  reproducible. That is a real limitation: no model means no surprising plans, and");
  lines.push("  CaMeL's 77%-of-AgentDojo-tasks number still has no equivalent here.");
  lines.push(rule);
  return lines.join("\n");
}
