// `decide` is TOTAL: every input produces a verdict, and no input produces an exception.
//
// The engine has claimed this since it was written - "it NEVER throws for any input including a
// malformed one" - and the claim carries its own justification directly beneath it: a policy engine
// that throws is a policy engine whose caller writes a try/catch, and that catch block is the
// bypass. A caller who wraps `decide` and treats the catch as "proceed" has removed containment
// entirely, and they will write that catch the first time a decision crashes in production.
//
// THE CLAIM WAS FALSE, AND NOTHING IN THE REPOSITORY COULD HAVE NOTICED. Nine of sixteen malformed
// shapes threw, including `null`, a missing `action`, and any non-array `sources`. The claim lived
// only in a source comment: `docs/claims.json` graded `core-is-pure` (no imports, no clock, no
// randomness, nothing async) and said nothing about throwing, and `audit:docs` scans README.md and
// the claim registry - not source comments. So the sentence sat outside the very apparatus this
// project built to stop itself overstating. See DEFECTS_FOUND.md section 24.
//
// "TypeScript already prevents this" is not an answer. The published packages ship CJS and ESM to
// consumers with no compiler in the path, decision inputs are routinely deserialised from JSON off
// a queue, and `any` crosses package edges. Those are exactly the paths a hostile value travels.
//
// FAIL CLOSED, ALWAYS. Every malformed input is DENY. A malformed decision request is a bug or an
// attack, and both deserve the same answer.

import { describe, expect, it } from "vitest";
import { ALL_PARAM_ROLES, type Verdict, actionId, decide, sourceId } from "../src/index.js";

/** Every shape a caller has actually managed to produce, plus the ones an attacker would try. */
const MALFORMED: readonly (readonly [string, unknown])[] = [
  ["null", null],
  ["undefined", undefined],
  ["a string", "not an input"],
  ["a number", 42],
  ["an array", []],
  ["an empty object", {}],
  ["action missing", { sources: [], receipts: [] }],
  ["action null", { action: null, sources: [] }],
  ["action a string", { action: "send", sources: [] }],
  ["args missing", { action: { tool: "t", capability: "text_response" }, sources: [] }],
  ["args a string", { action: { tool: "t", capability: "text_response", args: "x" }, sources: [] }],
  ["args null", { action: { tool: "t", capability: "text_response", args: null }, sources: [] }],
  [
    "an arg is null",
    { action: { tool: "t", capability: "text_response", args: [null] }, sources: [] },
  ],
  [
    "an arg is a string",
    { action: { tool: "t", capability: "text_response", args: ["a"] }, sources: [] },
  ],
  [
    "arg.derivedFrom a string",
    {
      action: {
        tool: "t",
        capability: "text_response",
        args: [{ name: "a", role: "content", derivedFrom: "s" }],
      },
      sources: [],
    },
  ],
  ["sources missing", { action: { tool: "t", capability: "text_response", args: [] } }],
  ["sources null", { action: { tool: "t", capability: "text_response", args: [] }, sources: null }],
  [
    "sources a string",
    { action: { tool: "t", capability: "text_response", args: [] }, sources: "s" },
  ],
  [
    "a source is null",
    { action: { tool: "t", capability: "text_response", args: [] }, sources: [null] },
  ],
  [
    "source.derivedFrom a number",
    {
      action: { tool: "t", capability: "text_response", args: [] },
      sources: [{ id: "s", provenance: "SYSTEM", derivedFrom: 7 }],
    },
  ],
  [
    "receipts a string",
    { action: { tool: "t", capability: "text_response", args: [] }, sources: [], receipts: "r" },
  ],
];

/** Every verdict must be usable by a caller that does not read the reasons. */
const wellFormed = (v: Verdict) => {
  expect(typeof v.decision).toBe("string");
  expect(["ALLOW", "DENY", "NEEDS_REVIEW", "NEEDS_DECLASSIFICATION"]).toContain(v.decision);
  expect(Array.isArray(v.reasons)).toBe(true);
  expect(Array.isArray(v.effects)).toBe(true);
  expect(Array.isArray(v.spends)).toBe(true);
  expect(v.provenance instanceof Set).toBe(true);
};

describe("decide is total", () => {
  for (const [name, input] of MALFORMED) {
    it(`does not throw on ${name}, and denies`, () => {
      let v: Verdict | undefined;
      expect(() => {
        v = decide(input as never);
      }, `${name} threw`).not.toThrow();
      expect(v?.decision, `${name} was not denied`).toBe("DENY");
      expect(v?.reasons.map((r) => r.code)).toContain("malformed_input");
      wellFormed(v as Verdict);
    });
  }

  it("a malformed input is never ALLOWed", () => {
    // The single property that matters. Stated separately from the loop so that a future shape
    // added to MALFORMED cannot pass by being denied for some unrelated reason.
    for (const [name, input] of MALFORMED) {
      const v = decide(input as never);
      expect(v.decision, `${name} was allowed`).not.toBe("ALLOW");
      expect(v.spends, `${name} spent a receipt`).toHaveLength(0);
    }
  });

  it("survives a deterministic sweep of mangled inputs", () => {
    // A seeded walk rather than `Math.random`, so a failure is reproducible. The engine forbids
    // randomness in its own source; a test that cannot reproduce its own failure is no better.
    let seed = 0x9e3779b9;
    const next = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const soup: unknown[] = [null, undefined, 0, -1, "", "x", true, [], {}, Number.NaN, () => 0];
    const pick = () => soup[Math.floor(next() * soup.length)];

    for (let i = 0; i < 500; i++) {
      const input = {
        action: {
          tool: pick(),
          capability: next() < 0.5 ? "email_send" : pick(),
          args: next() < 0.5 ? [{ name: pick(), role: pick(), derivedFrom: pick() }] : pick(),
        },
        sources: next() < 0.5 ? [{ id: pick(), provenance: pick(), derivedFrom: pick() }] : pick(),
        receipts: pick(),
      };
      let v: Verdict | undefined;
      expect(
        () => {
          v = decide(input as never);
        },
        `threw on iteration ${i}: ${JSON.stringify(input)}`,
      ).not.toThrow();
      expect(v?.decision, `allowed on iteration ${i}`).not.toBe("ALLOW");
    }
  });

  it("a well-formed input is still decided normally", () => {
    // The empty-set floor for this file. A gate that denies everything would pass every test above
    // and protect nothing - that is the section 19 lesson, applied to this file's own subject.
    const v = decide({
      action: {
        id: actionId("answer"),
        tool: "answer",
        capability: "text_response",
        args: [{ name: "body", role: "payload", derivedFrom: [sourceId("web")] }],
      },
      sources: [{ id: sourceId("web"), provenance: "WEB" }],
      receipts: [],
    });
    expect(v.decision).toBe("ALLOW");
    expect(v.reasons.map((r) => r.code)).not.toContain("malformed_input");
  });
});

describe("an unrecognised role fails closed", () => {
  // Section 25, and the only one of the three defects in this pass that could ALLOW something.
  // `ceilingFor` asked whether the role was in the STEERING set. A misspelling is not in that set,
  // so it fell through to `defaultCeiling` - the loosest ceiling on the row - and a WEB-derived
  // recipient on `email_send` became an ALLOW purely by mislabelling the argument.

  const withRole = (role: string) =>
    decide({
      action: {
        id: actionId("send"),
        tool: "send",
        capability: "email_send",
        args: [
          { name: "to", role: role as never, value: "a@b.com", derivedFrom: [sourceId("page")] },
        ],
      },
      sources: [{ id: sourceId("page"), provenance: "WEB" }],
      receipts: [],
    });

  it("does not admit untrusted input through a misspelled steering role", () => {
    expect(withRole("sink_identity").decision).not.toBe("ALLOW");
    expect(withRole("sink_identiy").decision).not.toBe("ALLOW");
    expect(withRole("recipient").decision).not.toBe("ALLOW");
    expect(withRole("").decision).not.toBe("ALLOW");
  });

  it("treats an unknown role at least as strictly as the strictest known one", () => {
    // Stated as a relation rather than a literal so that re-rating a row cannot silently invert it.
    const unknown = withRole("not_a_real_role");
    const strictest = ALL_PARAM_ROLES.map((r) => withRole(r));
    expect(unknown.decision).not.toBe("ALLOW");
    for (const v of strictest) {
      if (v.decision === "ALLOW") continue;
      expect(unknown.decision).not.toBe("ALLOW");
    }
  });

  it("still admits a clean value through an unknown role", () => {
    // The release valve. Failing closed on an unknown role must not mean refusing everything: a
    // developer literal is still a developer literal.
    const v = decide({
      action: {
        id: actionId("send"),
        tool: "send",
        capability: "email_send",
        args: [
          { name: "to", role: "not_a_real_role" as never, value: "ops@corp.com", derivedFrom: [] },
        ],
      },
      sources: [{ id: sourceId("cfg"), provenance: "SYSTEM" }],
      receipts: [],
    });
    expect(v.decision).toBe("ALLOW");
  });
});
