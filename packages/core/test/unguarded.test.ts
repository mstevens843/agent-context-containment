// Guards that no test was watching.
//
// v1.0 ran an adversarial mutation sweep over every safety branch in the engine rather than over the
// eight branches `scripts/audit-mutations.mjs` happens to list. 105 guards were neutralised one at a
// time; 73 failed a named test, and 30 did not. This file closes the ones where the mutation turns a
// REFUSAL INTO AN ALLOW, which is the only direction that matters.
//
// Every test here was written against a specific neutralisation and was watched to fail under it.
// That is the §15 rule: a test that has never been seen to fail is not evidence. The mutation each
// one answers is named in its comment so a future reader can re-run it.
//
// See docs/DEFECTS_FOUND.md §19.

import { describe, expect, it } from "vitest";
import {
  type ActionArg,
  type Capability,
  type Provenance,
  type ReceiptEvidence,
  actionId,
  admitAllowlistMember,
  admitConfirmedTuple,
  admitUserConfirmedValue,
  advanced,
  sourceId,
} from "../src/index.js";

const SCOPE = { nonce: "n", issuedAt: 0, expiresAt: null, source: null } as const;
type Src = { readonly id: ReturnType<typeof sourceId>; readonly provenance: Provenance };
const WEB: readonly Src[] = [{ id: sourceId("web"), provenance: "WEB" }];
const USER: readonly Src[] = [{ id: sourceId("user"), provenance: "USER" }];

const arg = (
  name: string,
  role: ActionArg["role"],
  from = "web",
  path?: string,
  value?: string,
): ActionArg => ({
  name,
  role,
  derivedFrom: [sourceId(from)],
  ...(path !== undefined ? { path } : {}),
  ...(value !== undefined ? { value } : {}),
});

const decide = (
  capability: Capability,
  args: readonly ActionArg[],
  receipts: readonly ReceiptEvidence[] = [],
  sources: readonly Src[] = WEB,
) =>
  advanced.decide({
    action: { id: actionId("a"), capability, tool: "t", args },
    sources,
    receipts,
  });

describe("a capability the table does not contain fails CLOSED", () => {
  // MUTATION P15: `decision: "DENY"` -> `"ALLOW"` in the unknown-capability block, policy.ts:884.
  // Nothing failed. Before v1.0 the string `unknown_capability` appeared in NO test and in NO corpus
  // case - it existed only in types.ts and policy.ts. `manifest.ts` builds its UNKNOWN_CAPABILITY
  // contradiction on the stated premise that "a MISSING row fails closed - decide refuses a
  // capability it cannot find", and that premise was never once exercised.
  //
  // This is the single most load-bearing default in the engine: every capability nobody has rated
  // yet arrives here. Failing open would mean a typo in a tool binding silently permits everything.

  it("an unrated capability is DENIED, not allowed", () => {
    const v = decide("not_a_real_capability" as Capability, [arg("x", "sink_identity")]);
    expect(
      v.decision,
      "a capability with no policy row was permitted - the engine fails OPEN on the unknown",
    ).toBe("DENY");
  });

  it("it says WHY, so the caller can tell an unrated tool from a refused one", () => {
    const v = decide("not_a_real_capability" as Capability, [arg("x", "sink_identity")]);
    expect(v.reasons.map((r) => r.code)).toContain("unknown_capability");
  });

  it("it fails closed even when every argument is CLEAN and user-supplied", () => {
    // The tempting shape of this bug: "nothing here is tainted, so there is nothing to refuse".
    // Provenance is not the question. An unrated capability has no ceilings, no egress rating and no
    // approval boundary, so there is no basis on which to permit it at any taint level.
    const v = decide(
      "not_a_real_capability" as Capability,
      [arg("x", "sink_identity", "user")],
      [],
      USER,
    );
    expect(v.decision, "an unknown capability was allowed because its arguments looked clean").toBe(
      "DENY",
    );
  });

  it("it spends no receipt on the way out", () => {
    const r = admitUserConfirmedValue({
      candidate: "v",
      presented: "confirm v",
      capability: "not_a_real_capability" as Capability,
      role: "sink_identity",
      argName: "x",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    const v = decide(
      "not_a_real_capability" as Capability,
      [arg("x", "sink_identity")],
      r ? [r] : [],
    );
    expect(v.decision).toBe("DENY");
    expect(
      v.spends.length,
      "a refusal burned a receipt - the approval is gone and bought nothing",
    ).toBe(0);
  });
});

describe("a receipt admits the argument it was issued for, and no other", () => {
  // WHY THESE ASSERT ON `declassified` AND NOT ON THE DECISION. The first draft of this block
  // asserted `decision !== "ALLOW"`, and all four tests passed under their own mutations: on
  // `transaction_broadcast` the action is ALSO refused for requiring confirmation, so the decision
  // word stays a refusal whether or not the receipt wrongly admitted the argument. The test looked
  // like coverage and was coverage of something else - §15, in a test written to close §15.
  //
  // The observable that actually moves is the admission: `coverFor` pushes a `declassified` reason
  // naming the argument. Assert on that and every mutation below is caught.
  // MUTATION P09: weaken the `coverFor` predicate at policy.ts:694 so it compares capability only.
  // The capability half of this was tested; the ROLE half was not, and a receipt approving an amount
  // then admits a recipient.

  it("a receipt for `magnitude` does not admit a `sink_identity` argument", () => {
    const r = admitUserConfirmedValue({
      candidate: "100",
      presented: "send 100",
      capability: "transaction_broadcast",
      role: "magnitude",
      argName: "amount",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    expect(r).toBeDefined();
    if (r === undefined) return;
    const v = decide(
      "transaction_broadcast",
      [arg("amount", "sink_identity")],
      [{ ...r, argName: "amount" }],
    );
    expect(
      v.reasons.map((r) => r.code),
      "a receipt issued for an AMOUNT admitted a RECIPIENT - the role half of receipt binding is gone",
    ).not.toContain("declassified");
  });

  // MUTATION P11: drop `!taintAtMost(a.taint, r.lifts)` at policy.ts:729.
  // A receipt states how far it lifts. Removing the comparison makes every receipt lift everything,
  // which is the arithmetic the whole declassification model rests on.

  it("a receipt does not admit an argument dirtier than what it lifts", () => {
    const r = admitUserConfirmedValue({
      candidate: "acct-1",
      presented: "send to acct-1",
      capability: "transaction_broadcast",
      role: "sink_identity",
      argName: "to",
      lifts: "USER_CONTROLLED",
      scope: SCOPE,
    });
    expect(r).toBeDefined();
    if (r === undefined) return;
    const v = decide("transaction_broadcast", [arg("to", "sink_identity")], [r]);
    expect(
      v.reasons.map((r) => r.code),
      "a receipt lifting USER_CONTROLLED admitted an UNTRUSTED_EXTERNAL recipient",
    ).not.toContain("declassified");
  });

  // MUTATION P12: drop `!row.liftableBy.has(r.rule)` at policy.ts:735.
  // `transaction_broadcast` lists exactly {user_confirmed_value, tuple_confirmed}. An allowlist is
  // not a confirmation: it says the value is one of a set somebody wrote down, not that a human
  // looked at THIS transfer. Removing the check lets any rule admit on any row.

  it("a rule the row does not list admits nothing on that row", () => {
    const r = admitAllowlistMember({
      candidate: "acct-1",
      allowlist: ["acct-1"],
      capability: "transaction_broadcast",
      role: "sink_identity",
      argName: "to",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    expect(r).toBeDefined();
    if (r === undefined) return;
    const v = decide("transaction_broadcast", [arg("to", "sink_identity")], [r]);
    expect(
      v.reasons.map((r) => r.code),
      "an allowlist receipt admitted on a row whose liftableBy is confirmation-only",
    ).not.toContain("declassified");
  });

  // MUTATION P14: drop `slots[i] === a.name` from `labelUnambiguous`, policy.ts:845.
  // `slotsOf` rule 1 says an explicit path IS the slot and "nothing here second-guesses it". This
  // guard is what makes that sentence true: a receipt naming only the label `to` must not reach an
  // argument the caller deliberately pinned to `message.replyTo`.

  it("a label-only receipt does not reach an argument the caller pinned to a path", () => {
    const r = admitUserConfirmedValue({
      candidate: "acct-1",
      presented: "send to acct-1",
      capability: "transaction_broadcast",
      role: "sink_identity",
      argName: "to",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    expect(r).toBeDefined();
    if (r === undefined) return;
    const v = decide(
      "transaction_broadcast",
      [arg("to", "sink_identity", "web", "message.replyTo")],
      [r],
    );
    expect(
      v.reasons.map((r) => r.code),
      "a receipt naming the bare label `to` admitted the argument pinned to message.replyTo",
    ).not.toContain("declassified");
  });
});

describe("a refusal spends nothing", () => {
  // MUTATION P27: `spends: []` -> `spends: spent` on the tuple NEEDS_REVIEW return, policy.ts:1141.
  // A shell that honours `spends` would burn a human approval on an action it then refused. The
  // async ledger's comment calls not doing this "the whole reason for the design", and no test on
  // any refusal path asserted it.
  //
  // REACHING THE PATH IS THE WHOLE DIFFICULTY. The first version of this test refused a `web_fetch`
  // with two identically-labelled arguments - a refusal, with `spends: []`, on a completely
  // different return. It passed under the mutation. To reach line 1141 both arguments must be
  // INDIVIDUALLY admitted by their own receipts and then fail the tuple gate, which is the only
  // state in which `spent` is non-empty at a refusal.

  const confirm = (candidate: string, role: "sink_identity" | "magnitude", argName: string) =>
    admitUserConfirmedValue({
      candidate,
      presented: `send ${candidate}`,
      capability: "transaction_broadcast",
      role,
      argName,
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });

  it("a tuple refusal reports no spent receipts, even though both arguments were admitted", () => {
    const to = confirm("acct-1", "sink_identity", "to");
    const amount = confirm("100", "magnitude", "amount");
    expect(to).toBeDefined();
    expect(amount).toBeDefined();
    if (to === undefined || amount === undefined) return;

    const v = decide(
      "transaction_broadcast",
      [arg("to", "sink_identity"), arg("amount", "magnitude")],
      [to, amount],
    );

    // Both arguments cleared individually - this is the state that makes `spent` non-empty.
    expect(
      v.reasons.filter((r) => r.code === "declassified").length,
      "the two arguments were not individually admitted, so this test is not on the tuple path",
    ).toBe(2);
    // ...and the combination was never ratified, so the action is refused.
    expect(v.decision, "the tuple gate did not fire - this test is not on the refusal path").toBe(
      "NEEDS_REVIEW",
    );
    // The property under test.
    expect(
      v.spends.length,
      `a refusal reported spends=${JSON.stringify(v.spends)} - the human approvals are consumed and bought nothing`,
    ).toBe(0);
  });
});

describe("the tuple gate keys on SLOTS, and only a tuple receipt ratifies", () => {
  // WHY THESE ASSERT ON `tuple_requires_review` AND NOT ON THE DECISION. `transaction_broadcast`
  // also requires confirmation, so it returns NEEDS_REVIEW whether or not the tuple gate fired: all
  // five mutations below left `decision === "NEEDS_REVIEW"` intact and every test passed. The
  // decision word is not an observable of this gate. The REASON is. Third time this trap has closed
  // on a test written to close it - see §19's closing note.
  // Five mutations lived here with nothing behind them. The tuple gate is the last thing standing
  // between "two arguments each approved on their own" and "a combination nobody looked at", so a
  // silent hole in it is a silent hole in the only defence against §11-shaped substitution.

  const confirm = (candidate: string, role: "sink_identity" | "magnitude", argName: string) =>
    admitUserConfirmedValue({
      candidate,
      presented: `send ${candidate}`,
      capability: "transaction_broadcast",
      role,
      argName,
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });

  const pair = () => {
    const to = confirm("acct-1", "sink_identity", "to");
    const amount = confirm("100", "magnitude", "amount");
    if (to === undefined || amount === undefined) throw new Error("fixture receipts did not issue");
    return [to, amount] as const;
  };

  const slotPair = (a = "acct-1", b = "100") => {
    const first = admitUserConfirmedValue({
      candidate: a,
      presented: `send ${a}`,
      capability: "transaction_broadcast",
      role: "sink_identity",
      argName: "v",
      argPath: "v[0]",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    const second = admitUserConfirmedValue({
      candidate: b,
      presented: `send ${b}`,
      capability: "transaction_broadcast",
      role: "magnitude",
      argName: "v",
      argPath: "v[1]",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    if (first === undefined || second === undefined) throw new Error("slot fixture did not issue");
    return [first, second] as const;
  };

  // MUTATION P22: drop `r.rule === "tuple_confirmed"` at policy.ts:1120.
  // A single-value confirmation is a human saying "yes, that recipient". It is not a human saying
  // "yes, that recipient AND that amount together". Without the rule check, any receipt whose
  // argName happens to equal the tuple key ratifies the combination.
  it("a single-value receipt does not ratify a combination, however its argName reads", () => {
    const [to, amount] = pair();
    // A user_confirmed_value receipt forged to carry the tuple key as its argName.
    const impostor = { ...to, argName: "amount+to", admitted: undefined };
    const v = decide(
      "transaction_broadcast",
      [arg("to", "sink_identity"), arg("amount", "magnitude")],
      [to, amount, impostor],
    );
    expect(
      v.reasons.map((r) => r.code),
      "a user_confirmed_value receipt ratified a two-argument combination - the rule check is gone",
    ).toContain("tuple_requires_review");
  });

  // MUTATION P23: drop `r.argName === tupleKey(...)` at policy.ts:1121.
  // A tuple receipt is bound to the pair it names. Without the key check, a confirmation of some
  // OTHER combination ratifies this one.
  it("a tuple receipt for a different pair does not ratify this pair", () => {
    const [to, amount] = pair();
    const elsewhere = admitConfirmedTuple({
      entries: [
        { argName: "somethingElse", value: "x" },
        { argName: "entirely", value: "y" },
      ],
      presented: "confirm x and y",
      capability: "transaction_broadcast",
      role: "sink_identity",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    expect(elsewhere).toBeDefined();
    if (elsewhere === undefined) return;
    const v = decide(
      "transaction_broadcast",
      [arg("to", "sink_identity"), arg("amount", "magnitude")],
      // `admitted: undefined` isolates the KEY check. With `admitted` present the value comparison
      // refuses on its own and the key mutation is invisible - which is why the first draft of this
      // test passed under P23.
      [to, amount, { ...elsewhere, admitted: undefined }],
    );
    expect(
      v.reasons.map((r) => r.code),
      "a tuple receipt naming a completely different pair ratified this combination",
    ).toContain("tuple_requires_review");
  });

  // MUTATIONS P28 / P29 / P30: `admittedByReceipt.add(a.slot)` -> `add(a.arg.name)`, and the same
  // substitution inside `tupleKey` / `tupleValue`.
  //
  // THE CASE THAT DISCRIMINATES is two arguments that SHARE A LABEL in different roles. Keyed by
  // slot they are `v[0]` and `v[1]`, two members, and the gate fires. Keyed by label they are both
  // "v" - `admittedByReceipt` collapses to one entry, the tuple key becomes the self-naming "v+v"
  // that `declassify.ts:566` exists to prevent, and the gate vanishes. Where names are unique the
  // two keyings are identical, which is why every existing test missed this.
  it("two arguments sharing a label are two tuple members, not one", () => {
    const first = admitUserConfirmedValue({
      candidate: "acct-1",
      presented: "send acct-1",
      capability: "transaction_broadcast",
      role: "sink_identity",
      argName: "v",
      argPath: "v[0]",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    const second = admitUserConfirmedValue({
      candidate: "100",
      presented: "send 100",
      capability: "transaction_broadcast",
      role: "magnitude",
      argName: "v",
      argPath: "v[1]",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;

    const v = decide(
      "transaction_broadcast",
      [arg("v", "sink_identity"), arg("v", "magnitude")],
      [first, second],
    );

    // Both cleared individually - so this really is on the tuple path.
    expect(
      v.reasons.filter((r) => r.code === "declassified").length,
      "the two same-labelled arguments were not both admitted; this test is not on the tuple path",
    ).toBe(2);
    expect(
      v.reasons.map((r) => r.code),
      "two arguments sharing the label `v` collapsed into one tuple member and the gate disappeared",
    ).toContain("tuple_requires_review");
  });

  it("a tuple receipt keyed by LABEL does not ratify a slot-keyed combination", () => {
    // The other half of P29: `admitConfirmedTuple` builds its key from `argPath ?? argName`, so a
    // caller who supplies only labels for two same-labelled arguments produces the key "v+v" - a key
    // that names itself twice and identifies neither argument. `declassify.ts:566` exists to prevent
    // exactly this. `admitted` is cleared so the KEY is the only thing under test.
    const selfNaming = admitConfirmedTuple({
      entries: [
        { argName: "v", value: "acct-1" },
        { argName: "v", value: "100" },
      ],
      presented: "confirm acct-1 and 100",
      capability: "transaction_broadcast",
      role: "sink_identity",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    expect(selfNaming).toBeDefined();
    if (selfNaming === undefined) return;
    expect(
      selfNaming.argName,
      "the fixture is wrong: this test needs the self-naming key the guard exists to reject",
    ).toBe("v+v");

    const v = decide(
      "transaction_broadcast",
      [arg("v", "sink_identity", "web", "v[0]"), arg("v", "magnitude", "web", "v[1]")],
      [...slotPair(), { ...selfNaming, admitted: undefined }],
    );
    expect(
      v.reasons.map((r) => r.code),
      'a tuple receipt keyed "v+v" ratified a combination whose real slots are v[0] and v[1]',
    ).toContain("tuple_requires_review");
  });

  it("the tuple VALUE is keyed by slot, so a label-keyed value does not ratify", () => {
    // MUTATION P30: `tupleValue` maps `a.arg.name` instead of `a.slot`.
    //
    // ISOLATING IT TAKES CARE. A receipt built entirely from labels is already refused by the KEY
    // check, so it cannot show whether the VALUE check is keyed correctly - the first draft of this
    // test asserted a substituted value and passed under P30, because a slot-keyed `admitted` never
    // matches a label-keyed `tupleValue` either way.
    //
    // What discriminates is a receipt whose key is slot-correct but whose `admitted` is label-keyed:
    // exactly the drift `declassify.ts:566` promises cannot happen when it says the two builders
    // "stay symmetric". Under P30 the engine's own value string becomes label-keyed too, the two
    // agree, and a combination is ratified by a receipt that never identified its members.
    const [first, second] = slotPair();
    const forged = {
      ...admitConfirmedTuple({
        entries: [
          { argName: "v", argPath: "v[0]", value: "acct-1" },
          { argName: "v", argPath: "v[1]", value: "100" },
        ],
        presented: "confirm acct-1 and 100",
        capability: "transaction_broadcast",
        role: "sink_identity",
        lifts: "UNTRUSTED_EXTERNAL",
        scope: SCOPE,
      }),
      admitted: "v=100&v=acct-1",
    } as ReceiptEvidence;
    expect(
      forged.argName,
      "fixture: the key must be slot-correct so only the VALUE is under test",
    ).toBe("v[0]+v[1]");

    const v = decide(
      "transaction_broadcast",
      [
        arg("v", "sink_identity", "web", "v[0]", "acct-1"),
        arg("v", "magnitude", "web", "v[1]", "100"),
      ],
      [first, second, forged],
    );
    expect(
      v.reasons.map((r) => r.code),
      "a receipt whose admitted value names neither slot ratified the combination",
    ).toContain("tuple_requires_review");
  });
});

describe("the one-receipt-one-slot guard is unreachable, and the invariant that kills it is asserted", () => {
  // PRIORITY 2, and it is the more interesting half of the mutation sweep. `usedReceipts.has(r.id)`
  // at policy.ts cannot fire. A branch that reads as protection and can never run is §13's shape,
  // and this repository holds a "no dead policy" invariant precisely because it has shipped one
  // before.
  //
  // The disposition is KEEP, because the guard is a one-lookup fail-closed backstop and the property
  // that makes it dead - slot uniqueness - is refactor-fragile. What makes keeping it honest rather
  // than decorative is that the invariant is asserted HERE. If slot uniqueness ever weakens, the
  // first test below fails, and the second tells you the dead guard has come alive.

  const SHAPES: ReadonlyArray<readonly [string, string | undefined]> = [
    ["a", undefined],
    ["a", "a"],
    ["a", "b"],
    ["a", "p"],
    ["b", undefined],
    ["b", "p"],
  ];

  const sweep = (): ReadonlyArray<{
    readonly spends: readonly string[];
    readonly codes: readonly string[];
  }> => {
    const out: Array<{ spends: readonly string[]; codes: readonly string[] }> = [];
    for (const first of SHAPES) {
      for (const second of SHAPES) {
        const args = [first, second].map(([name, path]) => arg(name, "sink_identity", "web", path));
        for (const rName of ["a", "b", "p"]) {
          for (const rPath of [undefined, "a", "b", "p"]) {
            const r = admitAllowlistMember({
              candidate: "https://ok.example",
              allowlist: ["https://ok.example"],
              capability: "web_fetch",
              role: "sink_identity",
              argName: rName,
              ...(rPath !== undefined ? { argPath: rPath } : {}),
              lifts: "UNTRUSTED_EXTERNAL",
              scope: SCOPE,
            });
            if (r === undefined) continue;
            const v = decide("web_fetch", args, [r]);
            out.push({ spends: v.spends, codes: v.reasons.map((x) => x.code) });
          }
        }
      }
    }
    return out;
  };

  it("no receipt ever covers two slots of one action", () => {
    // THE LOAD-BEARING INVARIANT. This is the property §11 violated, and it is what makes the guard
    // below redundant. It is asserted over a sweep rather than on one example because the failure
    // mode is a shape nobody thought of.
    for (const { spends } of sweep()) {
      const counts = new Map<string, number>();
      for (const id of spends) counts.set(id, (counts.get(id) ?? 0) + 1);
      const doubled = [...counts.entries()].filter(([, n]) => n > 1);
      expect(
        doubled.length,
        `one receipt was spent on two slots of the same action: ${JSON.stringify(doubled)} - defect §11 is back and slot uniqueness has broken`,
      ).toBe(0);
    }
  });

  it("and so the one-receipt-one-slot guard never fires - recorded, not assumed", () => {
    // If this ever fails, the guard has become REACHABLE. That is not necessarily a bug - it would
    // mean the backstop is now doing work - but it is a change in the model that must be noticed
    // rather than discovered later, so it is pinned. See DEFECTS_FOUND.md §20.
    const fired = sweep().filter((r) => r.codes.includes("receipt_already_consumed"));
    expect(
      fired.length,
      `the one-receipt-one-slot guard fired ${fired.length} time(s). It has been unreachable since v0.9; if that has changed, update the comment at policy.ts and DEFECTS_FOUND.md §20 rather than deleting this test`,
    ).toBe(0);
  });
});

describe("the verdict's reported taint is a JOIN over every argument", () => {
  // MUTATION P32: `overall = joinTaint(overall, taint)` -> `overall = taint`, policy.ts:937.
  //
  // No DECISION changes under this mutation - decisions are per-argument, and each argument is still
  // checked against its own ceiling. What changes is the audit trail: an action carrying an
  // UNTRUSTED_EXTERNAL argument followed by a CLEAN one reports `taint: "CLEAN"`. Every test in the
  // repository asserted decisions, so the whole suite passed while the record lied.
  //
  // This is worth a test precisely BECAUSE nothing refuses differently. `check.ts` re-derives
  // verdicts from a decision log to audit a third party's engine; a taint field that reports the
  // last argument instead of the join makes that log unusable for the thing it exists for.

  it("a clean argument after a dirty one does not launder the record", () => {
    const v = advanced.decide({
      action: {
        id: actionId("a"),
        capability: "text_response",
        tool: "t",
        args: [arg("dirty", "payload", "web"), arg("clean", "payload", "user")],
      },
      sources: [
        { id: sourceId("web"), provenance: "WEB" },
        { id: sourceId("user"), provenance: "USER" },
      ],
      receipts: [],
    });
    expect(
      v.taint,
      "the verdict reported the LAST argument's taint instead of the join - the audit trail launders",
    ).toBe("UNTRUSTED_EXTERNAL");
  });

  it("and the order of the arguments does not change it", () => {
    // The join is commutative; the bug is not. Asserting both orders is what distinguishes a real
    // join from an assignment that happens to be right for one ordering.
    const v = advanced.decide({
      action: {
        id: actionId("a"),
        capability: "text_response",
        tool: "t",
        args: [arg("clean", "payload", "user"), arg("dirty", "payload", "web")],
      },
      sources: [
        { id: sourceId("web"), provenance: "WEB" },
        { id: sourceId("user"), provenance: "USER" },
      ],
      receipts: [],
    });
    expect(v.taint, "the join is order-dependent, so it is not a join").toBe("UNTRUSTED_EXTERNAL");
  });
});

describe("a confirmed tuple's members carry the same guards as a confirmed value", () => {
  // MUTATIONS D16 / D18: the empty-value and deceptive-render refusals inside `admitConfirmedTuple`.
  //
  // The asymmetry is the finding. The IDENTICAL guards on the single-value path
  // (`admitUserConfirmedValue`) are both tested and both caught. The tuple path duplicates them and
  // tested neither - so the higher-value route, the one that ratifies a whole combination, was the
  // unguarded one.

  const entry = (value: string) => ({ argName: "to", argPath: "to", value });

  it("refuses a member with an empty value", () => {
    // An empty member means the human confirmed a blank. `presented.includes("")` is vacuously true,
    // so without this guard the "the human saw every value" check passes trivially.
    const r = admitConfirmedTuple({
      entries: [entry(""), { argName: "amount", argPath: "amount", value: "100" }],
      presented: "send  and 100",
      capability: "transaction_broadcast",
      role: "sink_identity",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    expect(r, "a tuple with an empty member was admitted").toBeUndefined();
  });

  it("refuses a member carrying bidi or zero-width characters", () => {
    // What the human saw and what the machine will use must be the same string. A right-to-left
    // override renders as one account and sends to another - the confirmation-UI attack the
    // single-value path already refuses.
    const deceptive = "acct-‮1";
    const r = admitConfirmedTuple({
      entries: [entry(deceptive), { argName: "amount", argPath: "amount", value: "100" }],
      presented: `send ${deceptive} and 100`,
      capability: "transaction_broadcast",
      role: "sink_identity",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    expect(r, "a tuple member containing a bidi override was admitted").toBeUndefined();
  });

  it("...and admits the same shape once the deception is removed", () => {
    // The near-miss. A guard that refused everything would pass both tests above and be useless.
    const r = admitConfirmedTuple({
      entries: [entry("acct-1"), { argName: "amount", argPath: "amount", value: "100" }],
      presented: "send acct-1 and 100",
      capability: "transaction_broadcast",
      role: "sink_identity",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    expect(r, "an honest tuple was refused - the guards are too broad to be useful").toBeDefined();
  });
});

describe("mixed provenance is reported for STEERING roles only", () => {
  // MUTATION P20: drop `if (!STEERING_ROLES.has(a.arg.role)) return false;` from the mixed-provenance
  // check, so a spliced PAYLOAD also emits `mixed_provenance`.
  //
  // It cannot produce an ALLOW - the check is diagnostic, it pushes a reason and gates nothing - so
  // it sat untested through two passes. What it produces instead is a false positive on ordinary
  // traffic: assembling a message body from a document and a user's words is what an assistant DOES.
  // `policy.ts` calls escalating a spliced payload "the second way this rule over-blocks" and says
  // the narrowing was forced by a real case. A rule that fires on honest inputs gets switched off,
  // and a switched-off rule protects nothing - which is why over-reporting is worth a test even when
  // it cannot change a decision. See DEFECTS_FOUND.md §21.

  const spliced = (role: ActionArg["role"]) =>
    advanced.decide({
      action: {
        id: actionId("a"),
        capability: "text_response",
        tool: "t",
        args: [
          {
            name: "x",
            role,
            derivedFrom: [sourceId("web"), sourceId("user")],
            value: "assembled from two places",
          },
        ],
      },
      sources: [
        { id: sourceId("web"), provenance: "WEB" },
        { id: sourceId("user"), provenance: "USER" },
      ],
      receipts: [],
    });

  it("a payload assembled from two trust classes is not flagged", () => {
    expect(
      spliced("payload").reasons.map((r) => r.code),
      "a spliced message BODY was reported as mixed provenance - this fires on ordinary assistant traffic",
    ).not.toContain("mixed_provenance");
  });

  it("...but a steering argument assembled the same way is", () => {
    // The near-miss, and the half that makes the test mean something: a rule narrowed until it never
    // fires would pass the test above and defend nothing.
    expect(
      spliced("sink_identity").reasons.map((r) => r.code),
      "a spliced STEERING argument was not reported - the splice is now invisible in the audit trail",
    ).toContain("mixed_provenance");
  });
});
