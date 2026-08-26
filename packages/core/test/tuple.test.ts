// Correlated parameters.
//
// Receipts are per value, and every check in this library up to v0.3 was too. That leaves a gap the
// individual checks cannot see: a recipient drawn from a valid allowlist, plus an amount inside a
// valid envelope, is a correctly-formed transfer to the wrong person. Both receipts are sound. Each
// answers a question nobody asked about the other, and the question a transfer actually poses -
// "should THIS amount go to THIS recipient?" - was never asked at all.
//
// The gate is deliberately narrow. It fires only when two or more of a row's declared tuple roles
// were DECLASSIFIED SEPARATELY - not merely present. Arguments already within their ceilings raise no
// tuple question, because nothing had to be admitted. Without that scoping this becomes a rules
// engine that fires on ordinary traffic and gets switched off, which protects nobody.

import { describe, expect, it } from "vitest";
import {
  ALL_CAPABILITIES,
  CAPABILITY_POLICY,
  actionId,
  admitConfirmedTuple,
  admitUserConfirmedValue,
  ceilingFor,
  decide,
  sourceId,
} from "../src/index.js";

const SCOPE = { nonce: "n", issuedAt: 0, expiresAt: null, source: null } as const;
const DEST = "acct-4471";
const AMOUNT = "250";

const single = (argName: string, value: string, role: "sink_identity" | "magnitude") =>
  admitUserConfirmedValue({
    candidate: value,
    presented: `Confirm ${value}?`,
    capability: "payment",
    role,
    argName,
    lifts: "UNTRUSTED_EXTERNAL",
    scope: SCOPE,
  });

const tuple = (dest: string, amount: string) =>
  admitConfirmedTuple({
    entries: [
      { argName: "destination", value: dest },
      { argName: "amount", value: amount },
    ],
    presented: `Send ${amount} to ${dest}?`,
    capability: "payment",
    role: "sink_identity",
    lifts: "UNTRUSTED_EXTERNAL",
    scope: SCOPE,
  });

const pay = (over: {
  readonly receipts?: readonly (ReturnType<typeof single> | ReturnType<typeof tuple>)[];
  readonly dest?: string;
  readonly amount?: string;
}) =>
  decide({
    action: {
      id: actionId("p"),
      capability: "payment",
      tool: "payments.transfer",
      args: [
        {
          name: "destination",
          role: "sink_identity",
          derivedFrom: [sourceId("msg")],
          value: over.dest ?? DEST,
        },
        {
          name: "amount",
          role: "magnitude",
          derivedFrom: [sourceId("msg")],
          value: over.amount ?? AMOUNT,
        },
      ],
    },
    sources: [{ id: sourceId("msg"), provenance: "EMAIL" }],
    receipts: (over.receipts ?? []).filter((r) => r !== undefined),
    confirmed: true,
  });

const codes = (v: ReturnType<typeof decide>) => v.reasons.map((r) => r.code);

describe("independently valid values can still be an unsafe pair", () => {
  it("two separate receipts do not authorise the combination", () => {
    // THE FINDING THIS GATE EXISTS FOR. Both receipts are individually sound and the action is
    // confirmed; the pair was still never reviewed as a pair.
    const v = pay({
      receipts: [
        single("destination", DEST, "sink_identity"),
        single("amount", AMOUNT, "magnitude"),
      ],
    });
    expect(v.decision).toBe("NEEDS_REVIEW");
    expect(codes(v)).toContain("tuple_requires_review");
  });

  it("the refusal names both arguments, so the reviewer knows what to look at", () => {
    const v = pay({
      receipts: [
        single("destination", DEST, "sink_identity"),
        single("amount", AMOUNT, "magnitude"),
      ],
    });
    const r = v.reasons.find((x) => x.code === "tuple_requires_review");
    expect(r?.message).toContain("destination");
    expect(r?.message).toContain("amount");
  });

  it("one declassified argument raises no tuple question", () => {
    // The scoping that keeps this from firing on ordinary traffic. One admitted value is one
    // decision, and there is no combination to review.
    const v = pay({ receipts: [single("destination", DEST, "sink_identity")] });
    expect(codes(v)).not.toContain("tuple_requires_review");
  });
});

describe("a tuple receipt admits the exact combination", () => {
  it("admits the pair it was ratified for", () => {
    const v = pay({
      receipts: [
        single("destination", DEST, "sink_identity"),
        single("amount", AMOUNT, "magnitude"),
        tuple(DEST, AMOUNT),
      ],
    });
    expect(v.decision).toBe("ALLOW");
    expect(codes(v)).toContain("tuple_confirmed");
  });

  it("does not admit a substituted member", () => {
    // The recipient the human agreed to, and an amount they did not.
    const v = pay({
      amount: "50000",
      receipts: [
        single("destination", DEST, "sink_identity"),
        single("amount", "50000", "magnitude"),
        tuple(DEST, AMOUNT),
      ],
    });
    expect(v.decision).toBe("NEEDS_REVIEW");
    expect(codes(v)).toContain("tuple_requires_review");
  });

  it("does not admit a different recipient at the confirmed amount", () => {
    const v = pay({
      dest: "acct-9999",
      receipts: [
        single("destination", "acct-9999", "sink_identity"),
        single("amount", AMOUNT, "magnitude"),
        tuple(DEST, AMOUNT),
      ],
    });
    expect(v.decision).toBe("NEEDS_REVIEW");
  });

  it("is order-independent, because the key is canonical", () => {
    // A pair reordered is the same pair. Sorting by argument name means a reordering cannot be used
    // to disguise a substitution, and cannot accidentally invalidate an honest receipt either.
    const reversed = admitConfirmedTuple({
      entries: [
        { argName: "amount", value: AMOUNT },
        { argName: "destination", value: DEST },
      ],
      presented: `Send ${AMOUNT} to ${DEST}?`,
      capability: "payment",
      role: "sink_identity",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    expect(reversed?.argName).toBe(tuple(DEST, AMOUNT)?.argName);
    expect(reversed?.admitted).toBe(tuple(DEST, AMOUNT)?.admitted);
  });
});

describe("the tuple rule refuses to issue when it should", () => {
  it("refuses a single-entry tuple, which is just a value receipt wearing a hat", () => {
    expect(
      admitConfirmedTuple({
        entries: [{ argName: "destination", value: DEST }],
        presented: `Confirm ${DEST}?`,
        capability: "payment",
        role: "sink_identity",
        lifts: "UNTRUSTED_EXTERNAL",
        scope: SCOPE,
      }),
    ).toBe(undefined);
  });

  it("refuses when the prompt did not show every member", () => {
    // A prompt naming one value while quietly carrying another is the confirmation-UI attack with
    // extra steps, and it is worse for a tuple because the unshown member is the dangerous one.
    expect(
      admitConfirmedTuple({
        entries: [
          { argName: "destination", value: DEST },
          { argName: "amount", value: AMOUNT },
        ],
        presented: `Send a payment to ${DEST}?`,
        capability: "payment",
        role: "sink_identity",
        lifts: "UNTRUSTED_EXTERNAL",
        scope: SCOPE,
      }),
    ).toBe(undefined);
  });
});

describe("the tuple policy model is declarative", () => {
  it("every declared combination has a stable id, two or more roles, and a stated reason", () => {
    // The reason this is a list of records rather than a condition in the engine: a reviewer who
    // reads no TypeScript can see which combinations the policy treats as one decision, and a change
    // to that set is a visible line in a diff rather than a branch somebody has to go and find.
    for (const k of ALL_CAPABILITIES) {
      for (const t of CAPABILITY_POLICY[k].tuplePolicies ?? []) {
        expect(t.id.length, `${k} has a tuple with no id`).toBeGreaterThan(0);
        expect(t.roles.length, `${k}.${t.id} is not a combination`).toBeGreaterThan(1);
        expect(t.why.length, `${k}.${t.id} does not say why`).toBeGreaterThan(20);
        expect(new Set(t.roles).size, `${k}.${t.id} repeats a role`).toBe(t.roles.length);
      }
    }
  });

  it("covers the combinations worth covering, and says which", () => {
    const covered = ALL_CAPABILITIES.flatMap((k) =>
      (CAPABILITY_POLICY[k].tuplePolicies ?? []).map((t) => `${k}:${t.id}`),
    ).sort();
    expect(covered).toEqual([
      "account_modify:target_and_setting",
      "email_send:recipient_and_control",
      "file_write:path_and_mode",
      "payment:recipient_and_amount",
      "read_only_tool:target_and_control",
      "transaction_broadcast:recipient_and_amount",
      "transaction_broadcast:recipient_and_asset",
    ]);
  });

  it("declares no combination that could never fire", () => {
    // A policy that cannot trigger looks like coverage and is none - the same shape as v0's
    // laundering case, which aimed at a defect and did not discriminate. The tuple gate fires only on
    // roles that were DECLASSIFIED, so every role in a declared combination must have a ceiling low
    // enough that something can exceed it. `email_send` names (sink_identity, control) and NOT
    // (sink_identity, payload) for exactly this reason: a body sits at the top of the lattice and is
    // therefore never declassified.
    for (const k of ALL_CAPABILITIES) {
      const row = CAPABILITY_POLICY[k];
      for (const t of row.tuplePolicies ?? []) {
        for (const role of t.roles) {
          expect(
            ceilingFor(row, role),
            `${k}.${t.id} names ${role}, whose ceiling is the top of the lattice - nothing can ever be declassified into it, so this combination can never fire`,
          ).not.toBe("UNTRUSTED_EXTERNAL");
        }
      }
    }
  });
});
