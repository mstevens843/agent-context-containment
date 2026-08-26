// Invariants of the TABLE, checkable without running the engine.
//
// These are the concrete payoff of putting every threshold in one place: they are inexpressible if
// the thresholds are scattered through a switch. Each one below is a property somebody could break
// by editing a row carelessly, and none of them would show up as a failing behaviour test.

import { describe, expect, it } from "vitest";
import {
  ALL_CAPABILITIES,
  ALL_DECLASSIFICATION_RULES,
  ALL_PARAM_ROLES,
  CAPABILITY_POLICY,
  actionId,
  ceilingFor,
  decide,
  sourceId,
  taintAtMost,
} from "../src/index.js";

describe("CAPABILITY_POLICY", () => {
  it("has exactly one row per capability, and every row is self-keyed", () => {
    // A copy-pasted row that forgets to change `capability` is otherwise invisible.
    expect(Object.keys(CAPABILITY_POLICY).sort()).toEqual([...ALL_CAPABILITIES].sort());
    for (const k of ALL_CAPABILITIES) {
      expect(CAPABILITY_POLICY[k].capability, `row "${k}" is mis-keyed`).toBe(k);
    }
  });

  it("every irreversible capability either confirms or keeps untrusted content out of its sink", () => {
    // The property is about WHERE an irreversible action goes, not WHAT it carries. Requiring
    // every role to be tight would forbid `email_send` from carrying an untrusted body, which is
    // the ordinary use of an email assistant - the first version of this invariant said exactly
    // that and was wrong.
    for (const k of ALL_CAPABILITIES) {
      const row = CAPABILITY_POLICY[k];
      if (row.effect !== "irreversible") continue;
      const sinkIsTight = taintAtMost(ceilingFor(row, "sink_identity"), "USER_CONTROLLED");
      expect(
        row.requiresConfirmation || sinkIsTight,
        `${k} is irreversible, does not confirm, and lets ${ceilingFor(row, "sink_identity")} choose its destination`,
      ).toBe(true);
    }
  });

  it("no full-egress capability lets untrusted content choose its destination", () => {
    // The property `web_fetch` exists to enforce. An egress channel whose sink_identity ceiling is
    // UNTRUSTED_EXTERNAL is not a control, it is a hole with a policy row attached.
    for (const k of ALL_CAPABILITIES) {
      const row = CAPABILITY_POLICY[k];
      if (row.egress !== "full") continue;
      expect(
        taintAtMost(ceilingFor(row, "sink_identity"), "USER_CONTROLLED"),
        `${k} has full egress but admits ${ceilingFor(row, "sink_identity")} in sink_identity`,
      ).toBe(true);
    }
  });

  it("an unliftable row is unliftable on purpose", () => {
    // A row with no lift rules is fine in exactly two shapes: fully permissive (nothing to lift),
    // or closed to untrusted content so the principal's own path is the only path. What must not
    // exist is a row that half-admits untrusted content into its sink and then offers no way to
    // discharge it - that is a row somebody forgot to finish, and it fails closed silently, which
    // is the worst kind of policy bug because the symptom is "it works, it just says no a lot".
    for (const k of ALL_CAPABILITIES) {
      const row = CAPABILITY_POLICY[k];
      if (row.liftableBy.size > 0) continue;
      const fullyPermissive = ALL_PARAM_ROLES.every(
        (r) => ceilingFor(row, r) === "UNTRUSTED_EXTERNAL",
      );
      const closedToUntrusted = taintAtMost(ceilingFor(row, "sink_identity"), "USER_CONTROLLED");
      expect(
        fullyPermissive || closedToUntrusted,
        `${k} has no lift rules and half-admits untrusted content into its sink`,
      ).toBe(true);
    }
  });

  it("every named lift rule exists", () => {
    for (const k of ALL_CAPABILITIES) {
      for (const rule of CAPABILITY_POLICY[k].liftableBy) {
        expect(ALL_DECLASSIFICATION_RULES).toContain(rule);
      }
    }
  });

  it("every row carries an approval boundary sentence", () => {
    for (const k of ALL_CAPABILITIES) {
      expect(
        CAPABILITY_POLICY[k].approvalBoundary.length,
        `${k} has no approvalBoundary`,
      ).toBeGreaterThan(20);
    }
  });

  it("text_response admits everything, or the library is unusable", () => {
    // The thesis row. If this ever tightens, the product is broken and nothing has been contained.
    const row = CAPABILITY_POLICY.text_response;
    expect(row.defaultCeiling).toBe("UNTRUSTED_EXTERNAL");
    expect(row.requiresConfirmation).toBe(false);
  });

  it("wallet_sign is the strictest row and nothing lifts it", () => {
    // A signature is universal, transferable authority whose blast radius is not a function of its
    // bytes. There is no claim about content that bounds what a counterparty does with one.
    const row = CAPABILITY_POLICY.wallet_sign;
    expect(row.defaultCeiling).toBe("CLEAN");
    expect(row.liftableBy.size).toBe(0);
  });

  it("no steering role on an acting capability admits tool-derived content or worse", () => {
    // THE INVARIANT THAT MAKES THE ARGUMENT-SPLICE RULE REDUNDANT, and the reason that rule is
    // diagnostic rather than a gate.
    //
    // A "steering" role decides WHERE an action goes or HOW MUCH it moves. If every steering role
    // on a capability with a real effect sits at or below USER_CONTROLLED, then any argument
    // spliced from a principal source and a non-principal one already exceeds its ceiling and is
    // refused before composition is ever considered. The ceiling subsumes the splice.
    //
    // If someone loosens a row and this test fails, the splice check in `decide` must be promoted
    // back from a reported reason to an actual gate - because the band it covers will have opened.
    // That is the whole point of asserting it here rather than writing it in a comment.
    const STEERING = ["sink_identity", "magnitude", "control"] as const;
    for (const k of ALL_CAPABILITIES) {
      const row = CAPABILITY_POLICY[k];
      if (row.effect === "none") continue;
      for (const role of STEERING) {
        expect(
          taintAtMost(ceilingFor(row, role), "USER_CONTROLLED"),
          `${k}.${role} admits ${ceilingFor(row, role)}; the splice band is now reachable and the mixed-provenance check must become a gate again`,
        ).toBe(true);
      }
    }
  });

  it("the two axes are genuinely orthogonal", () => {
    // The proof is a single pair: any total order over capabilities must place one of these above
    // the other, and both placements are wrong for a real threat.
    const fetch = CAPABILITY_POLICY.web_fetch;
    const account = CAPABILITY_POLICY.account_modify;
    expect([fetch.effect, fetch.egress]).toEqual(["none", "full"]);
    expect([account.effect, account.egress]).toEqual(["irreversible", "metadata"]);
  });
});

describe("the four decisions", () => {
  // All four are reachable and all four are reached here, directly. Before this phase NEEDS_REVIEW
  // was produced by no corpus case and no test - one of four advertised decisions, entirely
  // unexercised. Nothing had to be loosened to reach it, which was the risk worth checking.

  const payment = (over: { confirmed?: boolean; provenance?: "USER" | "WEB" } = {}) =>
    decide({
      action: {
        id: actionId("d"),
        capability: "payment",
        tool: "payments.transfer",
        args: [
          { name: "destination", role: "sink_identity", derivedFrom: [sourceId("s")] },
          { name: "amount", role: "magnitude", derivedFrom: [sourceId("s")] },
        ],
      },
      sources: [{ id: sourceId("s"), provenance: over.provenance ?? "USER" }],
      ...(over.confirmed !== undefined ? { confirmed: over.confirmed } : {}),
    });

  it("ALLOW when every ceiling is met and the confirmation gate is satisfied", () => {
    expect(payment({ confirmed: true }).decision).toBe("ALLOW");
  });

  it("NEEDS_REVIEW when the ceilings are met but a human has not confirmed", () => {
    // Confirmation is driven by the EFFECT axis, not by taint. Everything here is user-controlled
    // and within its ceiling; the review exists because the action cannot be undone.
    const v = payment();
    expect(v.decision).toBe("NEEDS_REVIEW");
    expect(v.reasons.map((r) => r.code)).toContain("confirmation_required");
    expect(v.effects.map((e) => e.type)).toEqual(["LOG_DECISION", "ESCALATE"]);
  });

  it("NEEDS_DECLASSIFICATION when a ceiling is exceeded and a rule could lift it", () => {
    const v = payment({ provenance: "WEB" });
    expect(v.decision).toBe("NEEDS_DECLASSIFICATION");
    expect(v.reasons.map((r) => r.code)).toContain("declassification_available");
  });

  it("DENY when a ceiling is exceeded and nothing can lift it", () => {
    // The livelock avoidance. Answering NEEDS_DECLASSIFICATION on an unliftable row would ask for a
    // receipt no rule can issue, so a persistent agent grinds against it until a budget runs out or
    // a human routes around the control.
    const v = decide({
      action: {
        id: actionId("d"),
        capability: "wallet_sign",
        tool: "wallet.sign",
        args: [{ name: "payload", role: "payload", derivedFrom: [sourceId("s")] }],
      },
      sources: [{ id: sourceId("s"), provenance: "WEB" }],
    });
    expect(v.decision).toBe("DENY");
    expect(v.reasons.map((r) => r.code)).not.toContain("declassification_available");
  });

  it("the taint gate runs before the confirmation gate, so a click cannot lift a ceiling", () => {
    // Two different questions that both look like a dialog. Declassification asks "is this extracted
    // value what you meant?"; confirmation asks "this moves money, proceed?". Prompting for the
    // second while the first is outstanding asks a human to launder taint by clicking.
    expect(payment({ provenance: "WEB", confirmed: true }).decision).toBe("NEEDS_DECLASSIFICATION");
  });

  it("every capability that requires confirmation can actually reach the review gate", () => {
    for (const k of ALL_CAPABILITIES) {
      const row = CAPABILITY_POLICY[k];
      if (!row.requiresConfirmation) continue;
      // Feed it a SYSTEM source so no ceiling can be the reason it refuses.
      const v = decide({
        action: {
          id: actionId("d"),
          capability: k,
          tool: "t",
          args: [{ name: "a", role: "sink_identity", derivedFrom: [sourceId("s")] }],
        },
        sources: [{ id: sourceId("s"), provenance: "SYSTEM" }],
      });
      expect(v.decision, `${k} requires confirmation but never reaches the review gate`).toBe(
        "NEEDS_REVIEW",
      );
    }
  });
});
