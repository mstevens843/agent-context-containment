// Direct tests for the containment checker.
//
// The README offers `checkContainment()` as "runnable against a third party's decision log", and it
// shipped with nothing exercising it. That is the worst place in the repository to have no coverage:
// a checker nobody has run is a checker that certifies whatever it is handed, and the entire value of
// this function is that it can be given to someone who does not trust the engine.
//
// These tests build DecisionRecord arrays BY HAND rather than going through the corpus runner. That
// is deliberate. The records are shaped the way a foreign implementation would emit them - vocabulary
// fields typed as plain `string`, so an unknown capability arrives as a FINDING rather than as a
// parse error - and driving them through the runner would only ever produce records this library
// already agrees with.

import { describe, expect, it } from "vitest";
import {
  type DecisionRecord,
  type ViolationCode,
  checkContainment,
  formatViolations,
  isContained,
} from "../src/index.js";

/** A well-formed record that re-derives to ALLOW. Every test below perturbs one thing about it. */
const clean = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  seq: 1,
  actionId: "a1",
  capability: "text_response",
  tool: "reply",
  decision: "ALLOW",
  reasons: ["within_taint_ceiling"],
  sources: [{ id: "task", provenance: "USER" }],
  args: [{ name: "text", role: "payload", derivedFrom: ["task"] }],
  performed: true,
  ...over,
});

const codes = (log: readonly DecisionRecord[], options = {}): ViolationCode[] =>
  checkContainment(log, options).map((v) => v.code);

describe("checkContainment", () => {
  it("passes a log it agrees with", () => {
    expect(checkContainment([clean()])).toEqual([]);
    expect(isContained([clean()])).toBe(true);
  });

  it("reports every problem rather than stopping at the first", () => {
    // A log can be wrong in several independent ways at once, and a checker that stops at the first
    // hides the rest. This record is wrong in three.
    const found = codes([
      clean({
        capability: "not_a_capability",
        decision: "MAYBE",
        sources: [{ id: "task", provenance: "VIBES" }],
      }),
    ]);
    expect(found).toContain("UNKNOWN_DECISION");
    expect(found).toContain("UNKNOWN_PROVENANCE");
    expect(found).toContain("UNKNOWN_CAPABILITY");
    expect(found.length).toBeGreaterThan(2);
  });
});

describe("the breach findings", () => {
  it("CONTAINMENT_BREACH: performed, and the policy re-derives to a refusal", () => {
    // The finding this library exists for. The shell did the thing; the table says it should not
    // have. Everything else in this file is bookkeeping by comparison.
    const found = codes([
      clean({
        capability: "payment",
        decision: "ALLOW",
        sources: [{ id: "page", provenance: "WEB" }],
        args: [{ name: "destination", role: "sink_identity", derivedFrom: ["page"] }],
        performed: true,
      }),
    ]);
    expect(found).toContain("CONTAINMENT_BREACH");
  });

  it("PERFORMED_WITHOUT_ALLOW: the shell ignored its own engine", () => {
    // Deliberately a different code from CONTAINMENT_BREACH. One says your engine decided wrong; the
    // other says your shell overrode it. Different bugs, different owners, and when auditing an
    // implementation you did not write, telling them apart is most of the value.
    const found = codes([
      clean({ decision: "DENY", reasons: ["taint_exceeds_ceiling"], performed: true }),
    ]);
    expect(found).toContain("PERFORMED_WITHOUT_ALLOW");
    expect(found).not.toContain("CONTAINMENT_BREACH");
  });

  it("EFFECT_WITHOUT_DECISION: an empty log plus performed actions is not a clean bill of health", () => {
    // The check that survives an implementation with no engine at all. On the benchmark this project
    // grew out of, a candidate scored a perfect 113/113 by never writing to the ledger it was graded
    // against. "No evidence of wrongdoing" is not the same statement as "evidence of no wrongdoing".
    const found = codes([], { performedActions: new Set(["ghost-1", "ghost-2"]) });
    expect(found).toEqual(["EFFECT_WITHOUT_DECISION", "EFFECT_WITHOUT_DECISION"]);
    expect(isContained([], { performedActions: new Set(["ghost-1"]) })).toBe(false);
  });

  it("does not report an orphan for an action the log accounts for", () => {
    expect(codes([clean()], { performedActions: new Set(["a1"]) })).toEqual([]);
  });
});

describe("the disagreement findings", () => {
  it("DECISION_DISAGREEMENT: the engine differs from the table, nothing performed", () => {
    const found = codes([
      clean({
        capability: "text_response",
        decision: "DENY",
        reasons: ["taint_exceeds_ceiling"],
        performed: false,
      }),
    ]);
    expect(found).toContain("DECISION_DISAGREEMENT");
    expect(found).not.toContain("CONTAINMENT_BREACH");
  });

  it("MISSING_REASONS: a refusal nobody can audit is not a control", () => {
    const found = codes([clean({ decision: "DENY", reasons: [], performed: false })]);
    expect(found).toContain("MISSING_REASONS");
  });

  it("does not demand reasons on an ALLOW", () => {
    expect(codes([clean({ reasons: [] })])).toEqual([]);
  });
});

describe("the vocabulary findings", () => {
  it("UNKNOWN_CAPABILITY is a finding, not a parse error", () => {
    // The record's vocabulary fields are plain `string` on purpose. A checker whose input type admits
    // only its own enum cannot report "you performed a capability we have never heard of" - the value
    // fails to parse and the finding surfaces as a crash in the harness instead of a line in the
    // report. Permissive at the parse boundary, strict in the check.
    const found = codes([clean({ capability: "wallet.drain", performed: false })]);
    expect(found).toContain("UNKNOWN_CAPABILITY");
  });

  it("an undeclared capability that was performed is also a breach", () => {
    const found = codes([clean({ capability: "wallet.drain", performed: true })]);
    expect(found).toContain("UNKNOWN_CAPABILITY");
    expect(found).toContain("CONTAINMENT_BREACH");
  });

  it("UNKNOWN_DECISION and UNKNOWN_PROVENANCE", () => {
    expect(codes([clean({ decision: "PROBABLY_FINE" })])).toContain("UNKNOWN_DECISION");
    expect(codes([clean({ sources: [{ id: "task", provenance: "TRUST_ME" }] })])).toContain(
      "UNKNOWN_PROVENANCE",
    );
  });

  it("NON_MONOTONIC_SEQ: an out-of-order log is not a log", () => {
    const found = codes([clean({ seq: 5 }), clean({ seq: 2, actionId: "a2" })]);
    expect(found).toContain("NON_MONOTONIC_SEQ");
  });
});

describe("re-derivation uses the shipped table", () => {
  it("follows derivedFrom, so a laundered record is caught", () => {
    const found = codes([
      clean({
        capability: "payment",
        decision: "ALLOW",
        sources: [
          { id: "page", provenance: "WEB" },
          { id: "summary", provenance: "TOOL_OUTPUT", derivedFrom: ["page"] },
        ],
        args: [{ name: "destination", role: "sink_identity", derivedFrom: ["summary"] }],
        performed: true,
      }),
    ]);
    expect(found).toContain("CONTAINMENT_BREACH");
  });

  it("honours a recorded confirmation", () => {
    const record = clean({
      capability: "payment",
      decision: "ALLOW",
      sources: [{ id: "task", provenance: "USER" }],
      args: [
        { name: "destination", role: "sink_identity", derivedFrom: ["task"] },
        { name: "amount", role: "magnitude", derivedFrom: ["task"] },
      ],
      performed: true,
    });
    // Without the confirmation the table says NEEDS_REVIEW, so an ALLOW that was performed is a breach.
    expect(codes([{ ...record, confirmed: false }])).toContain("CONTAINMENT_BREACH");
    // With it, the same record is clean.
    expect(codes([{ ...record, confirmed: true }])).toEqual([]);
  });
});

describe("formatViolations", () => {
  it("says so plainly when there is nothing wrong", () => {
    expect(formatViolations([])).toBe("containment: no violations");
  });

  it("names the code and the action for each finding", () => {
    const out = formatViolations(
      checkContainment([clean({ decision: "DENY", reasons: [], performed: true })]),
    );
    expect(out).toContain("PERFORMED_WITHOUT_ALLOW");
    expect(out).toContain("a1");
  });
});
