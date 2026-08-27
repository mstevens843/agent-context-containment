// Capability-manifest validation, and the boundary it does not move.
//
// The engine enforces flow GIVEN the declaration. On the imported data-stealing split, declaring the
// send tool as read-only lets **32 of 32** attacks through - not a corner case, the whole split. So
// the first thing these tests establish is what validation CANNOT do, because "we validate the
// manifest" invites the reading that a validated manifest is a true one. It is a consistent one.
//
// The second thing is why this is a function rather than a `describe()` block. Every invariant here
// used to be a test over the shipped `CAPABILITY_POLICY` - but `decide(input, policy)` accepts any
// policy, and the conformance package builds four at run time and publishes numbers from them. A rule
// that only ever runs against one constant is a rule about that constant.

import { describe, expect, it } from "vitest";
import {
  ALL_CAPABILITIES,
  CAPABILITY_POLICY,
  type CapabilityPolicy,
  contradictions,
  diffPolicies,
  formatManifestFindings,
  formatPolicyDiff,
  validatePolicy,
} from "../src/index.js";

const clone = (): CapabilityPolicy => structuredClone(CAPABILITY_POLICY) as CapabilityPolicy;

/**
 * Reach into a cloned policy's row to break it on purpose.
 *
 * The cast is deliberate and local: these tests exist to construct manifests the type system would
 * refuse, because those are exactly the manifests `validatePolicy` has to catch. A test that could
 * only build well-typed policies could not test a validator whose job is ill-typed ones.
 */
const row = (p: CapabilityPolicy, k: string): Record<string, unknown> =>
  (p as unknown as Record<string, Record<string, unknown>>)[k] as Record<string, unknown>;

describe("capability manifest validation", () => {
  it("the shipped table has no contradictions", () => {
    const findings = validatePolicy(CAPABILITY_POLICY);
    expect(
      contradictions(findings)
        .map((f) => `${f.capability}:${f.code}`)
        .join(", "),
      formatManifestFindings(findings),
    ).toBe("");
  });

  it("the shipped table DOES have suspicions, and they are not silently dropped", () => {
    // A validator that returns nothing on the table it was written against has been tuned until it
    // agrees. The suspicions here are real and deliberate - `email_send` is irreversible and asks for
    // no confirmation, four rows are irreversible with full egress - and they should stay visible.
    const findings = validatePolicy(CAPABILITY_POLICY);
    expect(findings.length, "no suspicions at all - the rules were tuned to agree").toBeGreaterThan(
      0,
    );
    expect(findings.map((f) => f.code)).toContain("HIGH_BLAST_RADIUS");
  });

  it("catches a row filed under a capability nobody vetted", () => {
    // The asymmetry that makes this worth checking: a MISSING row fails closed, because decide()
    // refuses a capability it cannot find. An EXTRA row fails OPEN - decide() honours whatever it
    // finds, so a policy loaded from JSON can carry a permissive row for a capability that was never
    // reviewed.
    const p = clone() as Record<string, unknown>;
    p.shell_exec = { ...CAPABILITY_POLICY.text_response, capability: "shell_exec" };
    const codes = validatePolicy(p as CapabilityPolicy).map((f) => f.code);
    expect(codes).toContain("UNKNOWN_CAPABILITY");
  });

  it("catches a copy-pasted row that forgot to change its own key", () => {
    const p = clone();
    row(p, "file_write").capability = "text_response";
    expect(validatePolicy(p).map((f) => f.code)).toContain("ROW_KEY_MISMATCH");
  });

  it("catches a missing row", () => {
    // Rebuilt without the row rather than `delete`d: same meaning, and it models what a policy loaded
    // from an operator's edited JSON actually looks like.
    const { payment: _omitted, ...p } = clone() as Record<string, unknown>;
    const f = validatePolicy(p as CapabilityPolicy);
    expect(f.map((x) => x.code)).toContain("MISSING_CAPABILITY");
    expect(f.find((x) => x.code === "MISSING_CAPABILITY")?.severity).toBe("contradiction");
  });

  it("catches an inert row whose unrated steering role would flat-DENY", () => {
    // Defect §12, generalised. `ceilingFor` fails closed on unrated steering roles, which is right for
    // every row that acts and is an availability failure on a row that cannot act: with nothing
    // liftable there is no route out, so a capability that changes nothing returns DENY.
    const p = clone();
    row(p, "text_response").roleCeilings = {};
    const codes = validatePolicy(p).map((f) => f.code);
    expect(codes).toContain("INERT_ROW_UNRATED_STEERING_ROLE");
  });

  it("does NOT flag a draft row for the same thing", () => {
    // The validator's own first false positive: it fired on `transaction_prepare`, whose `draftOnly`
    // flag IS the route out - an over-ceiling argument escalates to NEEDS_REVIEW rather than
    // refusing. A rule that flags the fix for defect §7 would push somebody to undo it.
    const findings = validatePolicy(CAPABILITY_POLICY).filter(
      (f) => f.capability === "transaction_prepare",
    );
    expect(findings.map((f) => f.code)).not.toContain("INERT_ROW_UNRATED_STEERING_ROLE");
  });

  it("catches a tuple on a row that can admit nothing separately", () => {
    // Defect §13. The gate fires on values admitted SEPARATELY, each lifted by its own receipt. A row
    // with an empty `liftableBy` never admits anything separately, so the tuple reads as protection
    // and can never run. The shipped table had exactly one.
    const p = clone();
    row(p, "account_modify").tuplePolicies = [
      {
        id: "target_and_setting",
        roles: ["sink_identity", "control"],
        why: "restored for the test",
      },
    ];
    expect(validatePolicy(p).map((f) => f.code)).toContain("DEAD_TUPLE_POLICY");
  });

  it("catches a tuple of one role wearing a plural name", () => {
    const p = clone();
    row(p, "payment").tuplePolicies = [
      { id: "solo", roles: ["sink_identity", "sink_identity"], why: "x" },
    ];
    expect(validatePolicy(p).map((f) => f.code)).toContain("TUPLE_WITHOUT_DISTINCT_ROLES");
  });

  it("catches draftOnly smuggled onto a row that acts", () => {
    // The flag downgrades a refusal to a review. On anything with an effect or an egress it is a
    // general safety downgrade wearing a narrow name.
    const p = clone();
    row(p, "payment").draftOnly = true;
    expect(validatePolicy(p).map((f) => f.code)).toContain("DRAFT_THAT_ACTS");
  });

  it("every capability the table declares is reachable by the validator", () => {
    // A validator that skips rows is worse than none. Assert it visited every one by making each row
    // individually detectable.
    for (const c of ALL_CAPABILITIES) {
      const p = clone();
      row(p, c).capability = c === "text_response" ? "payment" : "text_response";
      const hit = validatePolicy(p).some(
        (f) => f.capability === c && f.code === "ROW_KEY_MISMATCH",
      );
      expect(hit, `validatePolicy never looked at the ${c} row`).toBe(true);
    }
  });
});

describe("manifest diff", () => {
  it("no change between a policy and itself", () => {
    expect(diffPolicies(CAPABILITY_POLICY, CAPABILITY_POLICY)).toEqual([]);
  });

  it("a one-word ceiling edit is reported as a loosening", () => {
    // The smallest edit that fully disables containment for a capability, and the one that looks like
    // nothing in a pull request.
    const p = clone();
    (row(p, "payment").roleCeilings as Record<string, string>).sink_identity = "UNTRUSTED_EXTERNAL";
    const changes = diffPolicies(CAPABILITY_POLICY, p);
    const loosening = changes.filter((c) => c.loosening);
    expect(loosening.map((c) => `${c.capability}:${c.what}`)).toContain(
      "payment:ceiling sink_identity",
    );
    expect(formatPolicyDiff(changes)).toContain("LOOSENINGS");
  });

  it("removing a confirmation requirement is a loosening; adding one is not", () => {
    const looser = clone();
    row(looser, "payment").requiresConfirmation = false;
    expect(diffPolicies(CAPABILITY_POLICY, looser).some((c) => c.loosening)).toBe(true);

    const tighter = clone();
    row(tighter, "email_send").requiresConfirmation = true;
    const changes = diffPolicies(CAPABILITY_POLICY, tighter);
    expect(changes.length).toBeGreaterThan(0);
    expect(
      changes.every((c) => !c.loosening),
      "tightening was reported as a loosening",
    ).toBe(true);
  });

  it("removing a row is a TIGHTENING, because decide fails closed on it", () => {
    // Easy to get backwards. A capability the policy does not carry is refused, not permitted.
    const { web_fetch: _omitted, ...p } = clone() as Record<string, unknown>;
    const changes = diffPolicies(CAPABILITY_POLICY, p as CapabilityPolicy);
    const removed = changes.find((c) => c.what === "row removed");
    expect(removed?.loosening, "removing a row was reported as a loosening").toBe(false);
  });

  it("adding a row is a loosening, because decide honours whatever it finds", () => {
    const p = clone() as Record<string, unknown>;
    p.shell_exec = { ...CAPABILITY_POLICY.text_response, capability: "shell_exec" };
    const added = diffPolicies(CAPABILITY_POLICY, p as CapabilityPolicy).find(
      (c) => c.what === "row added",
    );
    expect(added?.loosening).toBe(true);
  });

  it("widening liftableBy is a loosening", () => {
    const p = clone();
    row(p, "wallet_sign").liftableBy = new Set(["user_confirmed_value"]);
    expect(
      diffPolicies(CAPABILITY_POLICY, p).some((c) => c.what === "liftableBy" && c.loosening),
    ).toBe(true);
  });

  it("dropping a tuple policy is a loosening", () => {
    const p = clone();
    row(p, "payment").tuplePolicies = [];
    expect(
      diffPolicies(CAPABILITY_POLICY, p).some((c) => c.what === "tuplePolicies" && c.loosening),
    ).toBe(true);
  });

  // ---- THE FIVE SUSPICION RULES NOBODY WAS TESTING -----------------------------------------------
  //
  // Seven contradiction rules each had a named test. Of six suspicion rules, only HIGH_BLAST_RADIUS
  // did; the other five were held up by `findings.length > 0` alone - a floor the shipped table
  // clears several times over, so deleting any one rule was invisible. Two of them delete findings
  // the SHIPPED table produces, and `pnpm verify:manifests` still said OK.
  //
  // Each rule gets a POSITIVE case (a policy that trips it) and a BENIGN NEAR-MISS that must stay
  // quiet, because a rule that fires on everything is as useless as one that fires on nothing - and
  // a near-miss is the only thing that proves the predicate is narrow rather than the assertion
  // merely restating the rule text. See DEFECTS_FOUND.md §20.

  it("catches a role rated looser than the row's own default", () => {
    const p = clone();
    row(p, "email_send").defaultCeiling = "CLEAN";
    (row(p, "email_send").roleCeilings as Record<string, unknown>).payload = "UNTRUSTED_EXTERNAL";
    expect(validatePolicy(p).map((f) => f.code)).toContain("ROLE_LOOSER_THAN_DEFAULT");
  });

  it("...and stays quiet when the role is at or below the default", () => {
    // The near-miss: EQUAL is not looser. A rule that fired here would flag most honest tables.
    const p = clone();
    row(p, "email_send").defaultCeiling = "USER_CONTROLLED";
    (row(p, "email_send").roleCeilings as Record<string, unknown>).payload = "USER_CONTROLLED";
    const flagged = validatePolicy(p).filter(
      (f) => f.code === "ROLE_LOOSER_THAN_DEFAULT" && f.capability === "email_send",
    );
    expect(flagged.length, "a role EQUAL to the default was reported as looser").toBe(0);
  });

  it("catches a steering role that admits TOOL_DERIVED on a capability that acts", () => {
    // This is the invariant `policy.ts` says will fire if the mixed-provenance band ever reopens.
    // That promise was kept only by a describe() block over the one shipped constant - and
    // `decide(input, policy)` accepts any policy, which is the whole reason this file exists.
    const p = clone();
    (row(p, "email_send").roleCeilings as Record<string, unknown>).sink_identity = "TOOL_DERIVED";
    expect(validatePolicy(p).map((f) => f.code)).toContain("STEERING_ADMITS_TOOL_DERIVED");
  });

  it("...and stays quiet on an inert row, where a loose steering role steers nothing", () => {
    // The near-miss that matters: `effect: "none"` with no egress cannot be steered into harm, so
    // the same ceiling there is not the same risk. If this fired, every read-only row would be noise.
    const p = clone();
    const findings = validatePolicy(p).filter(
      (f) => f.code === "STEERING_ADMITS_TOOL_DERIVED" && f.capability === "text_response",
    );
    expect(
      findings.length,
      "an inert row was flagged for a steering ceiling it cannot act on",
    ).toBe(0);
  });

  it("catches an irreversible capability that asks for no confirmation", () => {
    const p = clone();
    row(p, "transaction_broadcast").requiresConfirmation = false;
    const flagged = validatePolicy(p).filter(
      (f) =>
        f.code === "IRREVERSIBLE_WITHOUT_CONFIRMATION" && f.capability === "transaction_broadcast",
    );
    expect(flagged.length).toBeGreaterThan(0);
  });

  it("...and stays quiet on a reversible capability that asks for none", () => {
    const p = clone();
    row(p, "file_write").effect = "reversible";
    row(p, "file_write").requiresConfirmation = false;
    const flagged = validatePolicy(p).filter(
      (f) => f.code === "IRREVERSIBLE_WITHOUT_CONFIRMATION" && f.capability === "file_write",
    );
    expect(flagged.length, "a REVERSIBLE row was flagged for skipping confirmation").toBe(0);
  });

  it("catches a draft that also demands confirmation - two asks for one artifact", () => {
    const p = clone();
    row(p, "transaction_prepare").draftOnly = true;
    row(p, "transaction_prepare").requiresConfirmation = true;
    expect(validatePolicy(p).map((f) => f.code)).toContain("DRAFT_REQUIRING_CONFIRMATION");
  });

  it("...and stays quiet on a draft that does not", () => {
    const p = clone();
    row(p, "transaction_prepare").draftOnly = true;
    row(p, "transaction_prepare").requiresConfirmation = false;
    const flagged = validatePolicy(p).filter(
      (f) => f.code === "DRAFT_REQUIRING_CONFIRMATION" && f.capability === "transaction_prepare",
    );
    expect(flagged.length, "an ordinary draft row was flagged").toBe(0);
  });

  it("catches a steering ceiling no rule can lift - a flat DENY with no route to approval", () => {
    const p = clone();
    (row(p, "email_send").liftableBy as Set<string>).clear();
    expect(validatePolicy(p).map((f) => f.code)).toContain("UNLIFTABLE_STEERING_CEILING");
  });

  it("...and stays quiet where the ceiling is already at the top of the lattice", () => {
    // The near-miss: an unliftable row whose steering roles admit everything has no refusal to
    // route around, so there is no availability problem to report. Correct for a signing key.
    const p = clone();
    (row(p, "email_send").liftableBy as Set<string>).clear();
    const rc = row(p, "email_send").roleCeilings as Record<string, unknown>;
    for (const k of Object.keys(rc)) rc[k] = "UNTRUSTED_EXTERNAL";
    row(p, "email_send").defaultCeiling = "UNTRUSTED_EXTERNAL";
    const flagged = validatePolicy(p).filter(
      (f) => f.code === "UNLIFTABLE_STEERING_CEILING" && f.capability === "email_send",
    );
    expect(flagged.length, "a row with nothing to refuse was flagged as unliftable").toBe(0);
  });

  it("contradictions() actually returns the contradictions", () => {
    // MUTATION M14, and this one is a live gate rather than a reporting nicety: profiles.ts throws
    // on a non-empty result to stop the conformance package publishing numbers from an invalid
    // table, and doctor, manifest-report and report all count it. Filtering it to always-empty
    // turned every one of those into a rubber stamp, and no test noticed.
    const p = clone() as Record<string, unknown>;
    p.shell_exec = { ...CAPABILITY_POLICY.text_response, capability: "shell_exec" };
    const codes = contradictions(validatePolicy(p as CapabilityPolicy)).map((f) => f.code);
    expect(
      codes,
      "contradictions() returned nothing for a policy carrying an unvetted row - every gate that calls it is a rubber stamp",
    ).toContain("UNKNOWN_CAPABILITY");
  });
});
