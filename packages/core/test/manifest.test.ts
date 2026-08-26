// Capability-manifest validation, and the boundary it does not move.
//
// The engine enforces flow GIVEN the declaration. On the imported data-stealing split, declaring the
// send tool as read-only lets **17 of 17** attacks through - not a corner case, the whole split. So
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
});
