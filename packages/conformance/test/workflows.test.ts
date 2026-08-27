// The review workflows, pinned.
//
// The v0.7 demos prove decisions; these prove a WORKFLOW - what happens after the answer is "ask a
// human". That is where real deployments fail, and none of it is visible in a table of verdicts.
//
// The load-bearing assertions are the two that could not be faked: an approval is consumed exactly
// once (the harness throws if a burned receipt is ever accepted again), and a tool never executes
// without a permitting verdict (the executor's only call site is inside that branch).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REVIEW_WORKFLOWS,
  type WorkflowResult,
  formatWorkflows,
  runWorkflow,
} from "@agent-context-containment/conformance";
import { describe, expect, it } from "vitest";

const results: WorkflowResult[] = REVIEW_WORKFLOWS.map(runWorkflow);
const rendered = formatWorkflows(results);
const all = results.flatMap((r) => r.trace);

describe("review workflows", () => {
  it("covers four domains with nothing in common but the shape", () => {
    expect(results.map((r) => r.domain).sort()).toEqual(["devops", "email", "research", "support"]);
  });

  it("every workflow both completes something and stops something", () => {
    // Checked per workflow, not in aggregate: a total can hide a domain where nothing useful
    // survives, which is precisely the failure a safety-only number cannot show.
    for (const r of results) {
      expect(r.completed + r.reviewed, `${r.id} completed no useful work`).toBeGreaterThan(0);
      expect(r.refused + r.stalled, `${r.id} stopped nothing`).toBeGreaterThan(0);
    }
  });

  it("a tool never executes without a permitting verdict", () => {
    // The structural property. `executed` is set in the same branch that calls the executor, so this
    // asserts the branch condition rather than a convention.
    for (const t of all) {
      if (!t.executed) continue;
      expect(t.finalDecision, `${t.step} executed on a ${t.finalDecision} verdict`).toBe("ALLOW");
    }
    const executed = all.filter((t) => t.executed).length;
    expect(executed, "nothing executed at all, so the harness proves no utility").toBeGreaterThan(
      0,
    );
  });

  it("every approval is consumed exactly once", () => {
    // `runWorkflow` retries each reviewed step with the SAME receipts and throws if one is accepted
    // twice - so reaching this assertion at all is the evidence. The counts below make it visible.
    const reviewed = all.filter((t) => t.outcome === "completed_after_review");
    expect(
      reviewed.length,
      "no step went through review, so the replay check never ran",
    ).toBeGreaterThan(0);
    for (const t of reviewed) {
      expect(
        t.receiptsBurned,
        `${t.step} completed a review and burned no receipt`,
      ).toBeGreaterThan(0);
      // One decision, one review, one replay attempt.
      expect(t.turns, `${t.step} did not attempt a replay`).toBe(3);
    }
  });

  it("a reviewer's rejection is honoured", () => {
    const rejected = all.filter((t) => t.outcome === "refused_by_reviewer");
    expect(rejected.length, "no workflow shows a human saying no").toBeGreaterThan(0);
    for (const t of rejected) expect(t.executed).toBe(false);
  });

  it("stalls are counted and reported, not hidden", () => {
    // The outcome a safety-only report never shows: a task nobody could approve simply does not get
    // done. An engine that refuses everything scores perfectly on the refused row and turns every
    // workflow into this one.
    const stalled = all.filter((t) => t.outcome === "stalled_no_reviewer");
    expect(
      stalled.length,
      "no stall anywhere - the harness is not modelling the cost",
    ).toBeGreaterThan(0);
    expect(rendered).toContain("stalled - nobody could approve");
  });

  it("a step's first decision and final decision are both reported", () => {
    // A review changes the answer, and a report that only showed the final one would make the policy
    // look permissive - hiding that a human was asked.
    const changed = all.filter((t) => t.firstDecision !== t.finalDecision);
    expect(changed.length, "no decision was ever changed by a review").toBeGreaterThan(0);
    for (const t of changed) {
      expect(rendered).toContain(`${t.firstDecision} -> ${t.finalDecision}`);
    }
  });

  it("laundering through the agent's own output is still refused", () => {
    // The research workflow draws a URL from the answer WE produced, which inherits the page's taint
    // through its derivedFrom edge. If this ever passes, the taint stopped flowing through produced
    // sources and every multi-step guarantee is gone.
    const t = all.find((x) => x.step === "fetch-a-url-drawn-from-our-own-answer");
    expect(t, "the laundering step is missing from the research workflow").toBeDefined();
    expect(t?.executed, "a value laundered through our own summary was executed").toBe(false);
  });

  it("every tool declares a role for every parameter it is called with", () => {
    // `runWorkflow` throws on an undeclared parameter, so this is really asserting the specs are
    // complete. An undeclared parameter would otherwise be a silent hole: no role, no ceiling.
    expect(() => REVIEW_WORKFLOWS.map(runWorkflow)).not.toThrow();
  });

  it("the harness routes through the guarded API, not the raw engine", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "src", "toolrun.ts"), "utf8");
    expect(src, "the harness does not use createGuard").toContain("createGuard");
    expect(src.includes("advanced.decide"), "the harness reaches past the guard").toBe(false);
  });

  it("two runs produce identical output", () => {
    expect(formatWorkflows(REVIEW_WORKFLOWS.map(runWorkflow))).toBe(rendered);
  });
});
