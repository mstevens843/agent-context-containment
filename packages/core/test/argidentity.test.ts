// Argument identity: a receipt binds to a SLOT, not to a label.
//
// Defect §11 was a receipt bound by `(capability, role, argName)` admitting two arguments that shared
// a name. v0.8 mitigated the instance - a receipt may not be reused within one action - and left the
// CLASS open, because `argName` was still the key everywhere: `coverFor` matched on it,
// `admittedByReceipt` was a set of names, and `tupleKey` joined names into `"url+url"`.
//
// v0.9 replaces the key. Every argument gets a slot; slots are unique by construction; and a receipt
// that names only a LABEL matches nothing when that label identifies more than one argument. That
// last rule is the one that matters: not "the first wins", not "the last wins" - NONE of them, because
// the issuer of a label-only receipt cannot have meant one rather than the other, and guessing is how
// §11 admitted an argument nobody approved.
//
// These tests are the class, not the instance: duplicate labels, explicit paths, array indices,
// nested object paths, and the tuple gate.

import { describe, expect, it } from "vitest";
import {
  type ActionArg,
  type ReceiptEvidence,
  actionId,
  admitAllowlistMember,
  admitConfirmedTuple,
  admitUserConfirmedValue,
  advanced,
  slotsOf,
  sourceId,
} from "../src/index.js";

const SCOPE = { nonce: "n", issuedAt: 0, expiresAt: null, source: null } as const;
const WEB = [{ id: sourceId("web"), provenance: "WEB" as const }];

const fetchWith = (args: readonly ActionArg[], receipts: readonly ReceiptEvidence[]) =>
  advanced.decide({
    action: { id: actionId("a"), capability: "web_fetch", tool: "http.get", args },
    sources: WEB,
    receipts,
  });

const urlReceipt = (candidate: string, argPath?: string) =>
  admitAllowlistMember({
    candidate,
    allowlist: [candidate],
    capability: "web_fetch",
    role: "sink_identity",
    argName: "url",
    ...(argPath !== undefined ? { argPath } : {}),
    lifts: "UNTRUSTED_EXTERNAL",
    scope: SCOPE,
  });

describe("slotsOf", () => {
  it("a unique name is its own slot", () => {
    expect(slotsOf([arg("to"), arg("body")])).toEqual(["to", "body"]);
  });

  it("an explicit path wins over the name", () => {
    expect(slotsOf([arg("to", "message.to"), arg("to", "message.replyTo")])).toEqual([
      "message.to",
      "message.replyTo",
    ]);
  });

  it("a repeated name is disambiguated positionally", () => {
    expect(slotsOf([arg("url"), arg("url"), arg("body")])).toEqual(["url[0]", "url[1]", "body"]);
  });

  it("slots are unique even when the caller gives two arguments the same explicit path", () => {
    // A colliding path is a caller bug. Uniqueness is what the whole model rests on, so it is
    // enforced rather than assumed - and neither of the colliding pair is matchable by label.
    const slots = slotsOf([arg("a", "same"), arg("b", "same")]);
    expect(new Set(slots).size, `slots collided: ${slots.join(", ")}`).toBe(2);
  });

  it("is total: no throw on an empty or odd argument list", () => {
    expect(slotsOf([])).toEqual([]);
    expect(slotsOf([arg("")]).length).toBe(1);
  });

  it("is deterministic", () => {
    const args = [arg("url"), arg("url"), arg("url", "url[9]")];
    expect(slotsOf(args)).toEqual(slotsOf(args));
  });
});

describe("a label-only receipt cannot admit a duplicated label", () => {
  it("DEFECT §11: one receipt no longer admits two arguments that share a name", () => {
    const r = urlReceipt("https://ok.example");
    expect(r).toBeDefined();
    if (r === undefined) return;
    const v = fetchWith([arg("url"), arg("url")], [r]);
    expect(
      v.decision,
      "a receipt for one URL admitted a second, arbitrary one - defect §11 is back",
    ).not.toBe("ALLOW");
    expect(v.spends.length, "a receipt was spent on an action that was refused").toBe(0);
  });

  it("it admits NEITHER, not merely the second", () => {
    // The rule that makes this a class fix. "The first one wins" would still be a guess, and the
    // issuer of a label-only receipt had no way to express which they meant.
    const r = urlReceipt("https://ok.example");
    if (r === undefined) throw new Error("fixture");
    const v = fetchWith([arg("url"), arg("url")], [r]);
    const declassified = v.reasons.filter((x) => x.code === "declassified").length;
    expect(declassified, "one of the duplicated arguments was still admitted").toBe(0);
  });

  it("and it says why, rather than silently not matching", () => {
    const r = urlReceipt("https://ok.example");
    if (r === undefined) throw new Error("fixture");
    const v = fetchWith([arg("url"), arg("url")], [r]);
    const why = v.reasons.map((x) => x.code);
    expect(
      why,
      "the receipt was ignored silently; a refusal nobody can audit is not a control",
    ).toContain("receipt_capability_mismatch");
  });

  it("the same receipt still works when the label is unambiguous", () => {
    // The fix must not cost the common case. One argument called `url` is its own slot and needs no
    // ceremony at all.
    const r = urlReceipt("https://ok.example");
    if (r === undefined) throw new Error("fixture");
    const v = fetchWith([{ ...arg("url"), value: "https://ok.example" }], [r]);
    expect(v.decision).toBe("ALLOW");
  });
});

describe("a slot-bound receipt admits exactly its slot", () => {
  it("a receipt for url[0] admits url[0]", () => {
    const r = urlReceipt("https://ok.example", "url[0]");
    if (r === undefined) throw new Error("fixture");
    const v = fetchWith(
      [
        { ...arg("url"), value: "https://ok.example" },
        { ...arg("url"), value: "https://ok.example" },
      ],
      [r],
    );
    // The second slot is still unadmitted, so the action is still refused - but for the RIGHT reason:
    // one slot was covered and the other was not.
    expect(v.reasons.filter((x) => x.code === "declassified").length).toBe(1);
    expect(v.decision).not.toBe("ALLOW");
  });

  it("a receipt for url[0] does NOT admit url[1]", () => {
    const r = urlReceipt("https://evil.example", "url[1]");
    if (r === undefined) throw new Error("fixture");
    const v = fetchWith(
      [
        { ...arg("url"), value: "https://evil.example" },
        { ...arg("url"), value: "https://ok.example" },
      ],
      [r],
    );
    // It matched slot url[1], whose value is https://ok.example, not the admitted one - so it does
    // not cover it either. Nothing is admitted.
    expect(v.reasons.filter((x) => x.code === "declassified").length).toBe(0);
    expect(v.decision).not.toBe("ALLOW");
  });

  it("two slot-bound receipts admit both slots", () => {
    const a = urlReceipt("https://a.example", "url[0]");
    const b = urlReceipt("https://b.example", "url[1]");
    if (a === undefined || b === undefined) throw new Error("fixture");
    const v = fetchWith(
      [
        { ...arg("url"), value: "https://a.example" },
        { ...arg("url"), value: "https://b.example" },
      ],
      [a, b],
    );
    expect(v.decision, v.reasons.map((x) => x.code).join(",")).toBe("ALLOW");
    expect(v.spends.length, "both receipts should have been spent").toBe(2);
  });

  it("nested object paths work the same way", () => {
    // `message.to` and `message.replyTo` share no label at all here, but the point is that an
    // explicit path is honoured verbatim rather than reinterpreted.
    const r = admitUserConfirmedValue({
      candidate: "ops@corp.example",
      presented: "Send to ops@corp.example?",
      capability: "email_send",
      role: "sink_identity",
      argName: "to",
      argPath: "message.to",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    if (r === undefined) throw new Error("fixture");
    const v = advanced.decide({
      action: {
        id: actionId("m"),
        capability: "email_send",
        tool: "smtp.send",
        args: [
          {
            name: "to",
            path: "message.to",
            role: "sink_identity",
            derivedFrom: [sourceId("web")],
            value: "ops@corp.example",
          },
        ],
      },
      sources: WEB,
      receipts: [r],
    });
    expect(v.decision, v.reasons.map((x) => x.code).join(",")).toBe("ALLOW");
  });

  it("a receipt for a path that does not exist admits nothing", () => {
    const r = urlReceipt("https://ok.example", "url[7]");
    if (r === undefined) throw new Error("fixture");
    const v = fetchWith([{ ...arg("url"), value: "https://ok.example" }], [r]);
    expect(v.decision).not.toBe("ALLOW");
    expect(v.reasons.filter((x) => x.code === "declassified").length).toBe(0);
  });
});

describe("the tuple gate keys off slots too", () => {
  it("a tuple ratified for one pair does not cover a different pair with the same labels", () => {
    // `tupleKey` used to join LABELS, so two same-named arguments produced "url+url" - a key that
    // names itself twice and identifies neither pair.
    const t = admitConfirmedTuple({
      entries: [
        { argName: "destination", argPath: "destination", value: "acct-1" },
        { argName: "amount", argPath: "amount", value: "10" },
      ],
      presented: "Pay 10 to acct-1?",
      capability: "payment",
      role: "sink_identity",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    expect(t).toBeDefined();
    expect(t?.argName, "the tuple key is not built from slots").toBe("amount+destination");
  });

  it("a tuple key built from slots matches the engine's own", () => {
    // The two are computed in different files and must agree exactly, or a correctly-ratified pair
    // is refused and nobody can work out why.
    const t = admitConfirmedTuple({
      entries: [
        { argName: "url", argPath: "url[0]", value: "https://a.example" },
        { argName: "mode", argPath: "mode", value: "write" },
      ],
      presented: "https://a.example in write mode?",
      capability: "file_write",
      role: "sink_identity",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: SCOPE,
    });
    expect(t?.argName).toBe("mode+url[0]");
    expect(t?.admitted).toBe("mode=write&url[0]=https://a.example");
  });
});

function arg(name: string, path?: string): ActionArg {
  return {
    name,
    role: "sink_identity",
    derivedFrom: [sourceId("web")],
    ...(path !== undefined ? { path } : {}),
  };
}
