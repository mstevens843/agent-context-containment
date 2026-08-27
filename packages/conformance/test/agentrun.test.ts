// Agent runs: multi-step plans where untrusted content arrives mid-run and changes what happens next.
//
// The five scenarios cover the surfaces the brief named. Each one has the same shape: an ordinary
// task, a tool result that is not ours, and a later step that would act on it. What is being measured
// is not "was the dangerous step refused" - that is one decision and `tasks.ts` already covers it -
// but what the RUN looked like afterwards. A refusal that kills the run is a different product from a
// refusal that stops one step.

import { sourceId } from "@agent-context-containment/core";
import { describe, expect, it } from "vitest";
import {
  HAND_WRITTEN_SCENARIOS,
  type Scenario,
  formatRuns,
  runScenario,
  runScenarios,
} from "../src/index.js";

const SCENARIOS = HAND_WRITTEN_SCENARIOS;

describe("agent runs", () => {
  it("prints the run table", () => {
    console.log(`\n${formatRuns(runScenarios(SCENARIOS))}\n`);
    expect(SCENARIOS.length).toBe(5);
  });

  it("every run does exactly what the scenario said", () => {
    for (const s of SCENARIOS) {
      const r = runScenario(s);
      expect(
        { completed: r.completed, escalated: r.escalated, refused: r.refused },
        `${s.id}: ${JSON.stringify({ c: r.completed, e: r.escalated, f: r.refused })}`,
      ).toEqual({
        completed: s.expect.completes,
        escalated: s.expect.escalates,
        refused: s.expect.refuses,
      });
    }
  });

  it("no run stalls - every one gets real work done", () => {
    // The number that decides whether a containment policy survives contact with a product. A run
    // where nothing completed is, from the user's seat, indistinguishable from the agent being broken.
    const report = runScenarios(SCENARIOS);
    expect(report.stalled, "a run completed nothing at all").toBe(0);
  });

  it("every run that refused something still completed something", () => {
    // The anti-deny-all property, at run level rather than decision level.
    for (const s of SCENARIOS) {
      const r = runScenario(s);
      if (r.refused.length === 0) continue;
      expect(r.completed.length, `${s.id} refused a step and then did nothing`).toBeGreaterThan(0);
    }
  });

  it("untrusted content that arrives MID-RUN still reaches the policy", () => {
    // The property a scripted step list cannot test. The chunk does not exist when the run starts; it
    // is produced by step one, carries RETRIEVED, and is what step three is refused for.
    const r = runScenario(SCENARIOS[0] as Scenario);
    const pay = r.trace.find((t) => t.step === "pay-what-it-says");
    expect(pay?.performed).toBe(false);
    expect(pay?.reasons).toContain("taint_exceeds_ceiling");
  });

  it("taint survives a hop through our own model inside a run", () => {
    const r = runScenario(SCENARIOS[4] as Scenario);
    const send = r.trace.find((t) => t.step === "email-the-contact");
    expect(send?.performed).toBe(false);
    expect(send?.reasons).toContain("taint_exceeds_ceiling");
  });

  it("skips dependents of a step that did not run, rather than pretending they passed", () => {
    const blocked: Scenario = {
      id: "blocked-chain",
      title: "A refused step's dependents are not attempted",
      initial: [
        { id: sourceId("task"), provenance: "USER" },
        { id: sourceId("web"), provenance: "WEB" },
      ],
      plan: [
        {
          name: "pay",
          capability: "payment",
          role: "sink_identity",
          from: "web",
          produces: { id: "receipt", provenance: "TOOL_OUTPUT" },
          onAllowed: [
            {
              name: "confirm-by-email",
              capability: "email_send",
              role: "sink_identity",
              from: "receipt",
            },
          ],
        },
      ],
      expect: { completes: [], escalates: [], refuses: ["pay"] },
      note: "control",
    };
    const r = runScenario(blocked);
    expect(r.skipped).toEqual(["confirm-by-email"]);
  });
});
