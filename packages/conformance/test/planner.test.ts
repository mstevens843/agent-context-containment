// The planner scores 48/48 against the shipped engine, and that number is worth nothing by itself.
//
// A generated suite that always passes is indistinguishable from a generated suite that measures
// nothing, and generating 48 runs makes it EASIER to hide that, not harder - the count looks like
// coverage. So the tests here are all discrimination tests: point the same runs at a table with a
// specific defect in it and require the score to fall in the specific place that defect reaches, and
// nowhere else. A loosened egress ceiling must break the laundering shapes and leave the safe shape
// alone. If a defect breaks everything, the suite is a tripwire; if it breaks nothing, the suite is
// decoration.
//
// The receipt shapes get a different check, because no edit to the capability table can break them:
// their binding lives in the engine. There the risk is the opposite one - passing for the wrong
// reason, by minting a receipt so malformed that it would have been rejected anywhere.

import {
  ALL_PLAN_SHAPES,
  type PlanShape,
  generatePlans,
  runPlans,
} from "@agent-context-containment/conformance";
import {
  ALL_CAPABILITIES,
  CAPABILITY_POLICY,
  type CapabilityPolicy,
  admitUserConfirmedValue,
  sourceId,
} from "@agent-context-containment/core";
import { describe, expect, it } from "vitest";

const scoreByShape = (policy?: CapabilityPolicy): Record<string, number> => {
  const rep = runPlans(generatePlans(), policy);
  return Object.fromEntries(rep.byShape.map((s) => [s.shape, s.correct]));
};

const base = scoreByShape();

/** Loosen every steering ceiling on acting rows: the "taint does not matter" engine. */
const loosened: CapabilityPolicy = Object.fromEntries(
  Object.entries(CAPABILITY_POLICY).map(([k, row]) => [
    k,
    {
      ...row,
      defaultCeiling: "UNTRUSTED_EXTERNAL",
      roleCeilings: Object.fromEntries(
        Object.keys(row.roleCeilings).map((r) => [r, "UNTRUSTED_EXTERNAL"]),
      ),
    },
  ]),
) as CapabilityPolicy;

describe("adversarial planner", () => {
  it("generates every shape against every acting capability", () => {
    const plans = generatePlans();
    const acting = ALL_CAPABILITIES.filter((c) => {
      const row = CAPABILITY_POLICY[c];
      return row.effect !== "none" || row.egress !== "none";
    });
    expect(plans.length, "not every shape reached every acting capability").toBe(
      ALL_PLAN_SHAPES.length * acting.length,
    );
    for (const shape of ALL_PLAN_SHAPES) {
      const mine = plans.filter((p) => p.id.startsWith(`plan-${shape}-`));
      expect(mine.length, `shape ${shape} generated ${mine.length} plans`).toBe(acting.length);
    }
  });

  it("scenario ids are unique and deterministic across two generations", () => {
    // Two calls must produce the same plans. A planner whose output drifts cannot be diffed, and a
    // failure would then mean nothing in particular.
    const a = generatePlans().map((p) => p.id);
    const b = generatePlans().map((p) => p.id);
    expect(a.join("|")).toBe(b.join("|"));
    expect(new Set(a).size, "two generated plans share an id").toBe(a.length);
  });

  it("the shipped engine is exactly right on every generated run", () => {
    for (const shape of ALL_PLAN_SHAPES) {
      const acting = generatePlans().filter((p) => p.id.startsWith(`plan-${shape}-`)).length;
      expect(base[shape], `shape ${shape} is not fully correct against the shipped table`).toBe(
        acting,
      );
    }
  });

  it("a taint-blind table breaks the flow shapes and leaves the safe shape standing", () => {
    // The discrimination test. An engine that ignores taint entirely should still complete the safe
    // runs - it allows more, not less - while every shape that depends on a ceiling collapses.
    const broken = scoreByShape(loosened);
    const shouldBreak: PlanShape[] = [
      "direct_untrusted",
      "launder_via_summary",
      "launder_via_tool_output",
    ];
    for (const shape of shouldBreak) {
      expect(
        (broken[shape] ?? 0) < (base[shape] ?? 0),
        `shape ${shape} survives a table that ignores taint, so it is not testing the ceiling`,
      ).toBe(true);
    }
    // And it must NOT break everything: a mutant that fails every shape proves the suite is a
    // tripwire rather than a measurement.
    expect(
      broken.safe,
      "the safe shape broke under a LOOSER table, which means it is not measuring what it claims",
    ).toBe(base.safe);
  });

  it("the receipt shapes are refused for binding, not for being malformed", () => {
    // The "right answer for the wrong reason" check. `receipt_wrong_scope` only proves anything if
    // the receipt it presents is genuinely valid somewhere - otherwise the engine is rejecting a
    // broken object and the binding is untested.
    const receipt = admitUserConfirmedValue({
      candidate: "acct-99887766",
      presented: "Confirm the reference acct-99887766 shown above?",
      capability: "text_response",
      role: "payload",
      argName: "body",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: {
        nonce: "planner-attacker",
        issuedAt: 1_700_000_000_000,
        expiresAt: null,
        source: sourceId("attacker"),
      },
    });
    expect(
      receipt,
      "the wrong-scope receipt is undefined, so those eight runs test nothing",
    ).toBeDefined();
    expect(receipt?.capability, "the receipt is not the one the planner presents").toBe(
      "text_response",
    );
    expect(receipt?.argName).toBe("body");

    // And the runs that present it must actually carry it, rather than having quietly lost it.
    const plans = generatePlans().filter((p) => p.id.startsWith("plan-receipt_wrong_scope-"));
    for (const p of plans) {
      expect((p.plan[0]?.receipts ?? []).length, `${p.id} presents no receipt`).toBe(1);
    }
  });

  it("every generated run refuses for a reason, never silently", () => {
    // A refusal nobody can audit is not a control - the same rule the conformance port imposes on
    // third-party engines, applied to the engine that ships with it.
    for (const r of runPlans().results) {
      for (const t of r.trace) {
        if (t.skipped || t.decision === "ALLOW") continue;
        expect(
          t.reasons.length > 0,
          `${r.id} step ${t.step} was ${t.decision} with no reason`,
        ).toBe(true);
      }
    }
  });
});
