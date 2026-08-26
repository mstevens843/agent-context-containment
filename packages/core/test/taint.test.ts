// Direct tests for the taint wrapper and for provenance propagation.
//
// Two things are under test and they live in different places, which is the point of the design and
// worth pinning separately:
//
//   `Tainted<T>` in taint.ts is a LABELLING DISCIPLINE. It carries a label through ordinary
//   transformation and it is cooperative - a developer who unwraps and re-wraps defeats it. It is
//   ergonomics and a compile-time nudge, not information-flow control.
//
//   The provenance walk in `decide()` is the LOAD-BEARING half. It re-derives taint from declared
//   input provenance at the tool-call boundary, so a value laundered through a plain string is still
//   caught. The laundering tests below drive `decide` for that reason: the walk is where the
//   inheritance actually happens.
//
// LIMITATIONS.md says model-output laundering is the biggest hole in the whole library. These are the
// tests that hold the line it describes.

import { describe, expect, it } from "vitest";

/** A receipt scope for tests that are not about scoping. Replay/expiry live in replay.test.ts. */
const SCOPE = { nonce: "n-1", issuedAt: 1_000, expiresAt: null, source: null } as const;
import {
  ALL_PROVENANCES,
  PROVENANCE_TAINT,
  actionId,
  admitAllowlistMember,
  clean,
  decide,
  joinLabels,
  joinTaint,
  sourceId,
  taintOf,
  tainted,
} from "../src/index.js";

describe("the lattice", () => {
  it("maps every provenance to a level, and only SYSTEM is clean", () => {
    for (const p of ALL_PROVENANCES) {
      expect(taintOf(p), `${p} has no level`).toBe(PROVENANCE_TAINT[p]);
    }
    expect(taintOf("SYSTEM")).toBe("CLEAN");
    expect(taintOf("USER")).toBe("USER_CONTROLLED");
    expect(taintOf("TOOL_OUTPUT")).toBe("TOOL_DERIVED");
    for (const p of ["RETRIEVED", "WEB", "EMAIL", "DOCUMENT", "EXTERNAL_API"] as const) {
      expect(taintOf(p), `${p} is not treated as attacker-authorable`).toBe("UNTRUSTED_EXTERNAL");
    }
  });

  it("joins to the worse of the two, with CLEAN as the identity", () => {
    for (const p of ALL_PROVENANCES) {
      const t = taintOf(p);
      expect(joinTaint("CLEAN", t), `CLEAN is not the identity for ${t}`).toBe(t);
      expect(joinTaint(t, t)).toBe(t);
      expect(joinTaint(t, "UNTRUSTED_EXTERNAL")).toBe("UNTRUSTED_EXTERNAL");
    }
    expect(joinTaint("USER_CONTROLLED", "TOOL_DERIVED")).toBe("TOOL_DERIVED");
    expect(joinTaint("TOOL_DERIVED", "USER_CONTROLLED")).toBe("TOOL_DERIVED");
  });

  it("folds an empty label list to CLEAN, the only defensible identity", () => {
    expect(joinLabels([]).taint).toBe("CLEAN");
    expect(joinLabels([]).mixed).toBe(false);
  });
});

describe("Tainted", () => {
  it("preserves the label through map and joins it through chain and zip", () => {
    const web = tainted("hostile", "WEB");
    expect(web.map((s) => s.toUpperCase()).label.taint).toBe("UNTRUSTED_EXTERNAL");

    const joined = clean("ours").chain(() => tainted("theirs", "EMAIL"));
    expect(joined.label.taint).toBe("UNTRUSTED_EXTERNAL");
    expect([...joined.label.provenance].sort()).toEqual(["EMAIL", "SYSTEM"]);

    const zipped = clean("a").zip(tainted("b", "TOOL_OUTPUT"));
    expect(zipped.label.taint).toBe("TOOL_DERIVED");
  });

  it("marks mixed exactly when more than one trust class contributed", () => {
    expect(clean("a").label.mixed).toBe(false);
    expect(tainted("a", "WEB").label.mixed).toBe(false);
    expect(clean("a").zip(tainted("b", "WEB")).label.mixed).toBe(true);
    // Two sources in the SAME class are not a splice.
    expect(tainted("a", "WEB").zip(tainted("b", "EMAIL")).label.mixed).toBe(false);
  });

  it("does not leak the payload through JSON.stringify", () => {
    // A naive { value, label } record puts the payload in every log line. The value is captured in
    // closure scope instead and is not reachable as a property.
    const t = tainted("super-secret-token", "EMAIL");
    expect(JSON.stringify(t).includes("super-secret-token")).toBe(false);
    expect(JSON.stringify(t.label).includes("super-secret-token")).toBe(false);
  });

  it("unwrap returns the DECLASSIFICATION's value, not the wrapped one", () => {
    // The single most important line in taint.ts. It makes check-versus-use divergence
    // unrepresentable: the usual "verify a hash then use what you were holding" design lets code
    // validate one string and send another.
    const d = admitAllowlistMember({
      candidate: "alice@ourcorp.com",
      allowlist: ["alice@ourcorp.com"],
      capability: "email_send",
      role: "sink_identity",
      argName: "to",
      scope: SCOPE,
      lifts: "UNTRUSTED_EXTERNAL",
    });
    const smuggled = tainted("mallory@evil.tld", "EMAIL");
    expect(smuggled.unwrap(d!, "email_send")).toBe("alice@ourcorp.com");
  });

  it("unwrap refuses a receipt issued for a different capability", () => {
    const d = admitAllowlistMember({
      candidate: "alice@ourcorp.com",
      allowlist: ["alice@ourcorp.com"],
      capability: "text_response",
      role: "payload",
      argName: "text",
      scope: SCOPE,
      lifts: "UNTRUSTED_EXTERNAL",
    });
    let thrown: unknown;
    try {
      tainted("alice@ourcorp.com", "EMAIL").unwrap(d!, "payment");
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { code?: string })?.code).toBe("undeclassified_unwrap");
  });

  it("unwrap refuses a receipt that does not lift far enough", () => {
    const d = admitAllowlistMember({
      candidate: "x",
      allowlist: ["x"],
      capability: "email_send",
      role: "sink_identity",
      argName: "to",
      scope: SCOPE,
      lifts: "USER_CONTROLLED",
    });
    let thrown: unknown;
    try {
      tainted("x", "WEB").unwrap(d!, "email_send");
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { code?: string })?.code).toBe("undeclassified_unwrap");
  });

  it("unsafeUnwrap hands back the value and a warning that names the bypass", () => {
    // The escape hatch exists so the library is not removed wholesale. It always returns a warning
    // alongside, so the bypass appears in an audit whether or not the caller reads it.
    const { value, warning } = tainted("payload", "WEB").unsafeUnwrap("legacy integration");
    expect(value).toBe("payload");
    expect(warning).toContain("POLICY BYPASS");
    expect(warning).toContain("legacy integration");
  });
});

describe("provenance inheritance in decide()", () => {
  const act = (capability: "payment" | "read_only_tool", from: string) => ({
    id: actionId("t"),
    capability,
    tool: "t",
    args: [{ name: "a", role: "sink_identity" as const, derivedFrom: [sourceId(from)] }],
  });

  it("model output inherits the join of everything it was shown", () => {
    // The biggest hole in the library if an integration gets it wrong: summarise a hostile page and
    // the summary is a fresh string produced by a component you trust. Label it CLEAN and containment
    // is gone end to end, because every attacker needs only to get their string paraphrased once.
    const v = decide({
      action: act("payment", "summary"),
      sources: [
        { id: sourceId("page"), provenance: "WEB" },
        { id: sourceId("summary"), provenance: "TOOL_OUTPUT", derivedFrom: [sourceId("page")] },
      ],
    });
    expect(v.taint).toBe("UNTRUSTED_EXTERNAL");
    expect([...v.provenance].sort()).toEqual(["TOOL_OUTPUT", "WEB"]);
    expect(v.decision).not.toBe("ALLOW");
  });

  it("inheritance cuts both ways - a summary of trusted material stays clean", () => {
    const v = decide({
      action: act("read_only_tool", "summary"),
      sources: [
        { id: sourceId("policy"), provenance: "SYSTEM" },
        { id: sourceId("summary"), provenance: "TOOL_OUTPUT", derivedFrom: [sourceId("policy")] },
      ],
    });
    expect(v.taint).toBe("TOOL_DERIVED");
    expect(v.decision).toBe("ALLOW");
  });

  it("a cycle in the derivation graph fails closed", () => {
    // Possible in a hostile or simply buggy integration. Failing closed on a malformed graph is
    // cheaper than trusting the caller not to build one.
    const v = decide({
      action: act("read_only_tool", "a"),
      sources: [
        { id: sourceId("a"), provenance: "TOOL_OUTPUT", derivedFrom: [sourceId("b")] },
        { id: sourceId("b"), provenance: "TOOL_OUTPUT", derivedFrom: [sourceId("a")] },
      ],
    });
    expect(v.taint).toBe("UNTRUSTED_EXTERNAL");
  });

  it("an undeclared source fails closed rather than being treated as clean", () => {
    const v = decide({ action: act("read_only_tool", "ghost"), sources: [] });
    expect(v.taint).toBe("UNTRUSTED_EXTERNAL");
  });

  it("reports an argument-level splice, and the report does not change the decision", () => {
    // Pins the correction recorded in DEFECTS_FOUND.md section 6. An earlier comment claimed this
    // branch could not fire; it fires. What it cannot do is change the decision, because the
    // escalation is gated on an irreversible effect and no acting capability admits a splice within
    // its ceiling. Two claims, and only the second one was ever true.
    const v = decide({
      action: {
        id: actionId("s"),
        capability: "read_only_tool",
        tool: "accounts.get",
        args: [
          {
            name: "ref",
            role: "sink_identity",
            derivedFrom: [sourceId("crm"), sourceId("policy")],
          },
        ],
      },
      sources: [
        { id: sourceId("crm"), provenance: "TOOL_OUTPUT" },
        { id: sourceId("policy"), provenance: "SYSTEM" },
      ],
    });
    expect(v.reasons.map((r) => r.code)).toContain("mixed_provenance");
    expect(v.decision).toBe("ALLOW");
  });

  it("does not report a splice when one argument draws from a single trust class", () => {
    const v = decide({
      action: {
        id: actionId("s"),
        capability: "email_send",
        tool: "gmail.send",
        args: [
          { name: "to", role: "sink_identity", derivedFrom: [sourceId("task")] },
          { name: "body", role: "payload", derivedFrom: [sourceId("msg")] },
        ],
      },
      sources: [
        { id: sourceId("task"), provenance: "USER" },
        { id: sourceId("msg"), provenance: "EMAIL" },
      ],
    });
    // Mixed at the ACTION level and at no argument. This is "summarise this thread and send it to
    // Alice", the ordinary use of an email assistant, and it must not escalate.
    expect(v.reasons.map((r) => r.code)).not.toContain("mixed_provenance");
    expect(v.decision).toBe("ALLOW");
  });
});
