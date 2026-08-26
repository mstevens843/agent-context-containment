// The prepare/broadcast boundary, and the regression that made it stop working.
//
// DEFECT #7, from DEFECTS_FOUND.md. Two individually-correct rules composed into a behaviour neither
// author intended:
//
//   1. `ceilingFor` fails closed for unrated STEERING roles, tightening them to USER_CONTROLLED.
//      Added after `email_send.magnitude` was found inheriting a permissive default. Correct.
//   2. `transaction_prepare.liftableBy` was empty, so exceeding a ceiling yields DENY rather than
//      NEEDS_DECLASSIFICATION. Correct for `wallet_sign`, which is what the rule was written for.
//
// Together: `transaction_prepare` flatly refused to BUILD the unsigned artifact a human is supposed
// to inspect. That defeats the split this project argues for and pushes an integrator back toward one
// combined call - which is the outcome the split exists to prevent.
//
// The fix is one flag on one row, and the invariant below is what stops it becoming a general
// loosening: a draft capability must have no effect and no egress, so the flag is unsettable on
// anything that acts.

import { describe, expect, it } from "vitest";
import {
  ALL_CAPABILITIES,
  ALL_PARAM_ROLES,
  CAPABILITY_POLICY,
  type Capability,
  type ParamRole,
  type Provenance,
  actionId,
  decide,
  sourceId,
} from "../src/index.js";

const ask = (capability: Capability, role: ParamRole, provenance: Provenance) =>
  decide({
    action: {
      id: actionId("p"),
      capability,
      tool: "t",
      args: [{ name: "a", role, derivedFrom: [sourceId("s")] }],
    },
    sources: [{ id: sourceId("s"), provenance }],
  });

describe("preparing a draft is not acting", () => {
  it("untrusted metadata steering a PREPARE escalates for review rather than being refused", () => {
    // The behaviour defect #7 was about. Building the draft is how the human gets something to look
    // at; refusing to build it removes the review step the split exists to create.
    for (const role of ["sink_identity", "magnitude", "control"] as const) {
      const v = ask("transaction_prepare", role, "EXTERNAL_API");
      expect(v.decision, `transaction_prepare/${role} under untrusted metadata`).toBe(
        "NEEDS_REVIEW",
      );
      expect(v.reasons.map((r) => r.code)).toContain("draft_requires_review");
    }
  });

  it("a draft steered by the principal is built without ceremony", () => {
    // The other half. If every prepare needs a human, the split has bought nothing and the agent
    // cannot compose anything.
    for (const role of ALL_PARAM_ROLES) {
      expect(ask("transaction_prepare", role, "USER").decision, `prepare/${role} under USER`).toBe(
        "ALLOW",
      );
    }
  });

  it("a draft still carries the taint that produced it", () => {
    // Preparation does not launder. The artifact inherits the join of its inputs, and the broadcast
    // sees it - otherwise the two rows compose into a laundering pipeline, which is the one
    // catastrophic bug the split invites.
    const v = ask("transaction_prepare", "sink_identity", "EXTERNAL_API");
    expect(v.taint).toBe("UNTRUSTED_EXTERNAL");
    expect([...v.provenance]).toEqual(["EXTERNAL_API"]);
  });
});

describe("the fix does not loosen anything that acts", () => {
  // Captured from the shipped engine BEFORE the change and asserted after. If any of these move, the
  // surgical fix was not surgical.
  const FROZEN: readonly (readonly [Capability, ParamRole, string])[] = [
    ["wallet_sign", "sink_identity", "DENY"],
    ["wallet_sign", "magnitude", "DENY"],
    ["wallet_sign", "control", "DENY"],
    ["account_modify", "sink_identity", "DENY"],
    ["account_modify", "magnitude", "DENY"],
    ["account_modify", "control", "DENY"],
    ["transaction_broadcast", "sink_identity", "NEEDS_DECLASSIFICATION"],
    ["transaction_broadcast", "magnitude", "NEEDS_DECLASSIFICATION"],
    ["transaction_broadcast", "control", "NEEDS_DECLASSIFICATION"],
    ["payment", "sink_identity", "NEEDS_DECLASSIFICATION"],
    ["payment", "magnitude", "NEEDS_DECLASSIFICATION"],
    ["payment", "control", "NEEDS_DECLASSIFICATION"],
    ["email_send", "sink_identity", "NEEDS_DECLASSIFICATION"],
    ["email_send", "magnitude", "NEEDS_DECLASSIFICATION"],
    ["email_send", "control", "NEEDS_DECLASSIFICATION"],
    ["file_write", "sink_identity", "NEEDS_DECLASSIFICATION"],
    ["web_fetch", "sink_identity", "NEEDS_DECLASSIFICATION"],
  ];

  it("every acting capability decides exactly as it did before the fix", () => {
    for (const [capability, role, expected] of FROZEN) {
      expect(
        ask(capability, role, "WEB").decision,
        `${capability}/${role} moved - the prepare fix leaked into an acting capability`,
      ).toBe(expected);
    }
  });

  it("no acting capability can ever be marked a draft", () => {
    // THE INVARIANT THAT KEEPS THE FIX SURGICAL. `draftOnly` is unsettable on anything with an effect
    // or an egress channel, so the escalate-instead-of-refuse path cannot be reached by a capability
    // that does something. Without this the flag is one careless edit away from being a general
    // downgrade.
    for (const k of ALL_CAPABILITIES) {
      const row = CAPABILITY_POLICY[k];
      if (row.draftOnly !== true) continue;
      expect(row.effect, `${k} is marked draftOnly but has a real effect`).toBe("none");
      expect(row.egress, `${k} is marked draftOnly but sends data outward`).toBe("none");
      expect(row.requiresConfirmation, `${k} is draftOnly and also demands confirmation`).toBe(
        false,
      );
    }
  });

  it("exactly one capability is a draft, and it is the one the split is named after", () => {
    const drafts = ALL_CAPABILITIES.filter((k) => CAPABILITY_POLICY[k].draftOnly === true);
    expect(drafts).toEqual(["transaction_prepare"]);
  });
});
