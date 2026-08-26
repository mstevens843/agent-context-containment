// Direct tests for the declassification rules.
//
// These exist because the rules were shipped with no test coverage at all while the README described
// them as the release valve that keeps the library usable. 302 lines of the most security-sensitive
// code in the package, graded by nothing. That is the sharpest criticism available of a project whose
// argument is that engines should be graded on mechanism, and it is the cheapest to answer.
//
// The organising property under test is the admissibility rule from DECLASSIFICATION.md: a rule may
// admit a value for a sensitive parameter only if the set it can possibly admit is FINITE, enumerable
// from CLEAN inputs, and safe element by element. Every test below is that rule in one specific
// shape - which value came back, how large the codomain was, and what the rule refused.

import { describe, expect, it } from "vitest";

/** A receipt scope for tests that are not about scoping. Replay/expiry live in replay.test.ts. */
const SCOPE = { nonce: "n-1", issuedAt: 1_000, expiresAt: null, source: null } as const;
import {
  ALL_CAPABILITIES,
  ALL_DECLASSIFICATION_RULES,
  CAPABILITY_POLICY,
  ContainmentError,
  admitAllowlistMember,
  admitAttestedToolOutput,
  admitCleanSelection,
  admitEchoOfClean,
  admitNumericEnvelope,
  admitUserConfirmedValue,
  bitsOfChoice,
  declassifyShape,
} from "../src/index.js";

const CAP = "email_send" as const;
const ROLE = "sink_identity" as const;
const ARG = "to";
const LIFT = "UNTRUSTED_EXTERNAL" as const;

describe("admitAllowlistMember", () => {
  const allowlist = ["alice@ourcorp.com", "bob@ourcorp.com", "carol@ourcorp.com"];

  it("returns the matched member, never the input", () => {
    // The whole normalise-one-side family of bugs dies here. Code that compares a trimmed,
    // lower-cased form and then ships the raw form lets a homoglyph or an appended zero-width
    // character through a comparison it appeared to pass. Returning the member makes that
    // unrepresentable: the value that was checked is the value that is used.
    const d = admitAllowlistMember({
      candidate: "alice@ourcorp.com",
      allowlist,
      capability: CAP,
      role: ROLE,
      argName: ARG,
      scope: SCOPE,
      lifts: LIFT,
    });
    expect(d?.admitted).toBe(allowlist[0]);
    expect(d?.rule).toBe("allowlist_member");
  });

  it("refuses anything not in the list", () => {
    for (const candidate of ["mallory@evil.tld", "ALICE@OURCORP.COM", "alice@ourcorp.com "]) {
      const d = admitAllowlistMember({
        candidate,
        allowlist,
        capability: CAP,
        role: ROLE,
        argName: ARG,
        scope: SCOPE,
        lifts: LIFT,
      });
      expect(d, `"${candidate}" was admitted and is not a member`).toBe(undefined);
    }
  });

  it("reports a codomain the size of the list", () => {
    const d = admitAllowlistMember({
      candidate: "bob@ourcorp.com",
      allowlist,
      capability: CAP,
      role: ROLE,
      argName: ARG,
      scope: SCOPE,
      lifts: LIFT,
    });
    expect(d?.codomain).toEqual({ kind: "finite", cardinality: 3 });
    expect(bitsOfChoice(d!.codomain)).toBe(2);
  });
});

describe("admitNumericEnvelope", () => {
  const envelope = { low: 0, high: 100, granularity: 1 } as const;
  const base = {
    ...envelope,
    capability: "payment" as const,
    role: "magnitude" as const,
    argName: "amount",
    scope: SCOPE,
    lifts: LIFT,
  };

  it("admits a number inside the bound", () => {
    expect(admitNumericEnvelope({ ...base, candidate: 50 })?.admitted).toBe(50);
    expect(admitNumericEnvelope({ ...base, candidate: 0 })?.admitted).toBe(0);
    expect(admitNumericEnvelope({ ...base, candidate: 100 })?.admitted).toBe(100);
  });

  it("refuses outside the bound and refuses non-finite values", () => {
    for (const candidate of [
      -1,
      101,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(
        admitNumericEnvelope({ ...base, candidate }),
        `${candidate} was admitted by a [0, 100] envelope`,
      ).toBe(undefined);
    }
  });

  it("throws rather than guessing when the granularity does not bound the codomain", () => {
    // A zero or negative granularity means the admissible set is not finite, so the rule cannot
    // satisfy its own admissibility criterion. Returning `undefined` would read as "this value was
    // refused"; the truth is that the rule was misconfigured, which is programmer error.
    let thrown: unknown;
    try {
      admitNumericEnvelope({ ...base, candidate: 5, granularity: 0 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown instanceof ContainmentError).toBe(true);
    expect((thrown as ContainmentError).code).toBe("inadmissible_declassification");
  });

  it("reports a codomain derived from the bound and the granularity", () => {
    const d = admitNumericEnvelope({ ...base, candidate: 5 });
    expect(d?.codomain).toEqual({ kind: "bounded_numeric", cardinality: 101 });
  });
});

describe("admitEchoOfClean", () => {
  it("is the only rule with a singleton codomain, and therefore zero bits of attacker choice", () => {
    const d = admitEchoOfClean({
      candidate: "inv_8812",
      cleanValue: "inv_8812",
      capability: CAP,
      role: ROLE,
      argName: ARG,
      scope: SCOPE,
      lifts: LIFT,
    });
    expect(d?.codomain).toEqual({ kind: "singleton", cardinality: 1 });
    expect(bitsOfChoice(d!.codomain)).toBe(0);
  });

  it("returns the clean side, not the candidate", () => {
    const cleanValue = "inv_8812";
    const d = admitEchoOfClean({
      candidate: "inv_8812",
      cleanValue,
      capability: CAP,
      role: ROLE,
      argName: ARG,
      scope: SCOPE,
      lifts: LIFT,
    });
    expect(d?.admitted).toBe(cleanValue);
  });

  it("refuses anything that is not byte-identical", () => {
    for (const candidate of ["inv_8813", "inv_8812 ", "INV_8812", ""]) {
      const d = admitEchoOfClean({
        candidate,
        cleanValue: "inv_8812",
        capability: CAP,
        role: ROLE,
        argName: ARG,
        scope: SCOPE,
        lifts: LIFT,
      });
      expect(d, `"${candidate}" echoed a value it does not equal`).toBe(undefined);
    }
  });

  it("uses Object.is, so NaN echoes itself and -0 does not echo 0", () => {
    const nan = admitEchoOfClean({
      candidate: Number.NaN,
      cleanValue: Number.NaN,
      capability: CAP,
      role: ROLE,
      argName: ARG,
      scope: SCOPE,
      lifts: LIFT,
    });
    expect(nan?.admitted).toBe(Number.NaN);
    const zero = admitEchoOfClean({
      candidate: -0,
      cleanValue: 0,
      capability: CAP,
      role: ROLE,
      argName: ARG,
      scope: SCOPE,
      lifts: LIFT,
    });
    expect(zero).toBe(undefined);
  });
});

describe("admitCleanSelection", () => {
  const collection = ["first", "second", "third"];
  const base = { collection, capability: CAP, role: ROLE, argName: ARG, scope: SCOPE, lifts: LIFT };

  it("returns the clean element the tainted index selected", () => {
    expect(admitCleanSelection({ ...base, index: 1 })?.admitted).toBe("second");
  });

  it("is finite, not singleton - the element is clean but the CHOICE was attacker-made", () => {
    // Worth pinning, because a clean return value invites the assumption that nothing was chosen.
    // Something was: which one. That is log2(n) bits and it is why this rule is not admissible for
    // every capability the way echo_of_clean would be.
    const d = admitCleanSelection({ ...base, index: 0 });
    expect(d?.codomain).toEqual({ kind: "finite", cardinality: 3 });
    expect(bitsOfChoice(d!.codomain)).toBe(2);
  });

  it("refuses every index that is not a real position in the collection", () => {
    for (const index of [-1, 3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        admitCleanSelection({ ...base, index }),
        `index ${index} selected something from a 3-element collection`,
      ).toBe(undefined);
    }
  });

  it("cannot be walked into the prototype chain", () => {
    // `collection[key]` on a plain object hands back __proto__ and constructor as live objects
    // rather than undefined, which turns a selection rule into prototype pollution. The bounds check
    // is against an array length and the index is required to be a non-negative integer, so a string
    // key cannot reach a property at all.
    for (const key of ["__proto__", "constructor", "toString", "length"]) {
      expect(
        admitCleanSelection({ ...base, index: key as unknown as number }),
        `"${key}" was treated as an index`,
      ).toBe(undefined);
    }
  });
});

describe("admitUserConfirmedValue", () => {
  const base = { capability: CAP, role: ROLE, argName: ARG, scope: SCOPE, lifts: LIFT };

  it("admits a value the human was shown verbatim", () => {
    const d = admitUserConfirmedValue({
      ...base,
      candidate: "alice@ourcorp.com",
      presented: "Send the summary to alice@ourcorp.com?",
    });
    expect(d?.admitted).toBe("alice@ourcorp.com");
    expect(d?.basis).toContain("Send the summary to alice@ourcorp.com?");
  });

  it("refuses when the prompt did not contain the value", () => {
    // The confirmation has to be about the thing being used. A prompt that said something else is
    // not consent to this.
    const d = admitUserConfirmedValue({
      ...base,
      candidate: "mallory@evil.tld",
      presented: "Send the summary to alice@ourcorp.com?",
    });
    expect(d).toBe(undefined);
  });

  it("refuses characters that let a rendered string lie about what it says", () => {
    // Attacks the library CAN see, so it should. What it cannot see is pixels - truncation, CSS and
    // notification previews are outside it, which LIMITATIONS.md states rather than papering over.
    const deceptive: readonly (readonly [string, string])[] = [
      ["right-to-left override", "alice‮gro c.live@"],
      ["zero-width space", "alice​@ourcorp.com"],
      ["zero-width joiner", "alice‍@ourcorp.com"],
      ["byte-order mark", "alice﻿@ourcorp.com"],
      ["newline", "alice@ourcorp.com\nand also mallory@evil.tld"],
      ["leading space", " alice@ourcorp.com"],
      ["trailing space", "alice@ourcorp.com "],
    ];
    for (const [label, candidate] of deceptive) {
      const d = admitUserConfirmedValue({ ...base, candidate, presented: `Confirm ${candidate}?` });
      expect(d, `${label} was admitted`).toBe(undefined);
    }
  });

  it("refuses an empty value", () => {
    expect(admitUserConfirmedValue({ ...base, candidate: "", presented: "Confirm ?" })).toBe(
      undefined,
    );
  });

  it("is human_ratified rather than singleton, because the attacker still chose the proposal", () => {
    const d = admitUserConfirmedValue({
      ...base,
      candidate: "alice@ourcorp.com",
      presented: "Confirm alice@ourcorp.com?",
    });
    expect(d?.codomain.kind).toBe("human_ratified");
  });
});

describe("declassifyShape", () => {
  it("reports structure and exposes no value anywhere in its result", () => {
    // The structural/value split is the load-bearing distinction in DECLASSIFICATION.md. If a shape
    // result carried a value, a structural check could be mistaken for a value declassification -
    // which is the single most likely way to ship this library broken.
    const shape = declassifyShape({ to: "mallory@evil.tld", amount: 5000, nested: { k: "v" } });
    expect(shape.kind).toBe("object");
    expect(shape.fields).toEqual(["amount", "nested", "to"]);
    const serialised = JSON.stringify(shape);
    expect(serialised.includes("mallory@evil.tld"), "a leaf value leaked into the shape").toBe(
      false,
    );
    expect(serialised.includes("5000"), "a leaf value leaked into the shape").toBe(false);
  });

  it("describes arrays by length and primitives by nothing", () => {
    expect(declassifyShape(["a", "b"])).toEqual({ kind: "array", fields: [], length: 2 });
    expect(declassifyShape("secret")).toEqual({ kind: "primitive", fields: [], length: null });
    expect(declassifyShape(null)).toEqual({ kind: "null", fields: [], length: null });
    expect(declassifyShape(undefined)).toEqual({ kind: "null", fields: [], length: null });
  });
});

describe("the documented refusals stay refused", () => {
  it("ships exactly the rules the policy table names, and no source allowlist", () => {
    // DECLASSIFICATION.md argues at length that a source allowlist is not admissible as a value
    // declassifier: a domain says who SERVED the bytes, never who WROTE them, and every allowlist
    // entry worth having is a user-generated-content host. This test is what stops that argument
    // from being quietly reversed by a future commit that adds the rule everyone asks for.
    expect([...ALL_DECLASSIFICATION_RULES].sort()).toEqual([
      "allowlist_member",
      "attested_tool_output",
      "clean_selection",
      "echo_of_clean",
      "numeric_envelope",
      "tuple_confirmed",
      "user_confirmed_value",
    ]);
    expect(ALL_DECLASSIFICATION_RULES).not.toContain("source_allowlist");
    expect(ALL_DECLASSIFICATION_RULES).not.toContain("schema_validated");
  });

  it("every rule reports a finite codomain, which is the admissibility criterion itself", () => {
    const admitted = [
      admitAllowlistMember({
        candidate: "a",
        allowlist: ["a"],
        capability: CAP,
        role: ROLE,
        argName: ARG,
        scope: SCOPE,
        lifts: LIFT,
      }),
      admitNumericEnvelope({
        candidate: 1,
        low: 0,
        high: 10,
        granularity: 1,
        capability: CAP,
        role: ROLE,
        argName: ARG,
        scope: SCOPE,
        lifts: LIFT,
      }),
      admitEchoOfClean({
        candidate: "a",
        cleanValue: "a",
        capability: CAP,
        role: ROLE,
        argName: ARG,
        scope: SCOPE,
        lifts: LIFT,
      }),
      admitCleanSelection({
        index: 0,
        collection: ["a"],
        capability: CAP,
        role: ROLE,
        argName: ARG,
        scope: SCOPE,
        lifts: LIFT,
      }),
      admitUserConfirmedValue({
        candidate: "a",
        presented: "Confirm a?",
        capability: CAP,
        role: ROLE,
        argName: ARG,
        scope: SCOPE,
        lifts: LIFT,
      }),
    ];
    for (const d of admitted) {
      expect(d, "a rule refused a value it should have admitted").not.toBe(undefined);
      expect(
        Number.isFinite(d!.codomain.cardinality),
        `${d!.rule} reported a non-finite codomain`,
      ).toBe(true);
      expect(d!.codomain.cardinality, `${d!.rule} reported a codomain of zero`).toBeGreaterThan(0);
    }
  });
});

describe("admitAttestedToolOutput", () => {
  const attestation = {
    keyId: "indexer-2026",
    subject: "ct_44190",
    purpose: { capability: "read_only_tool", role: "sink_identity" },
  } as const;
  const ok = () => true;
  const no = () => false;
  const slot = {
    capability: "read_only_tool" as const,
    role: "sink_identity" as const,
    argName: "ref",
    scope: SCOPE,
    lifts: LIFT,
  };

  it("admits an attested value into a read", () => {
    const d = admitAttestedToolOutput({ ...slot, candidate: "ct_44190", attestation, verify: ok });
    expect(d?.admitted).toBe("ct_44190");
    expect(d?.rule).toBe("attested_tool_output");
    expect(d?.basis).toContain("indexer-2026");
  });

  it("refuses when the host's verifier says no", () => {
    expect(
      admitAttestedToolOutput({ ...slot, candidate: "ct_44190", attestation, verify: no }),
    ).toBe(undefined);
  });

  it("an attestation for one value does not admit a different one", () => {
    // The binding. Without it a valid signature becomes a licence to substitute, which is the
    // check-versus-use gap wearing a key.
    const d = admitAttestedToolOutput({ ...slot, candidate: "ct_99999", attestation, verify: ok });
    expect(d).toBe(undefined);
  });

  it("an attestation for one slot does not admit another", () => {
    const d = admitAttestedToolOutput({
      ...slot,
      role: "payload",
      candidate: "ct_44190",
      attestation,
      verify: ok,
    });
    expect(d).toBe(undefined);
  });

  it("REFUSES every capability with a real effect or full egress, however good the signature", () => {
    // THE NARROWING THAT MAKES THE RULE DEFENSIBLE. A signature attests origin, not content safety -
    // a correctly signed response from your own indexer still carries whatever the attacker wrote on
    // the page it indexed. Accepting that from a key while DECLASSIFICATION.md refuses it from a
    // domain would be incoherent. So an attestation can feed a read and can never steer a send, and
    // that is enforced structurally rather than left to whoever writes the policy row.
    for (const capability of ALL_CAPABILITIES) {
      const row = CAPABILITY_POLICY[capability];
      const admissible = row.effect === "none" && row.egress !== "full";
      const d = admitAttestedToolOutput({
        candidate: "v",
        attestation: { keyId: "k", subject: "v", purpose: { capability, role: "sink_identity" } },
        verify: ok,
        capability,
        role: "sink_identity",
        argName: "a",
        scope: SCOPE,
        lifts: LIFT,
      });
      expect(
        d !== undefined,
        `${capability} (effect ${row.effect}, egress ${row.egress}) was ${d ? "admitted" : "refused"} by attestation`,
      ).toBe(admissible);
    }
  });

  it("is a singleton, but not the kind echo_of_clean is", () => {
    // Same cardinality, different provenance of the choice. echo_of_clean returns a value we already
    // held cleanly, so the attacker chose nothing. Here the ATTESTER chose it, and an attester's
    // honesty is an assumption rather than a property - which is why the capability narrowing above
    // has to carry the safety instead.
    const d = admitAttestedToolOutput({ ...slot, candidate: "ct_44190", attestation, verify: ok });
    expect(d?.codomain).toEqual({ kind: "singleton", cardinality: 1 });
  });
});
