// The provenance graph is a DAG, not a tree, and the engine must be total.
//
// Three defects are pinned here, all of them in the same walk, all of them found by an independent
// reviewer reading `resolveTaint` rather than by any gate in this repository. That is the reason
// this file exists as well as the reason it is worth reading.
//
//   Section 23 - A DIAMOND OVER-TAINTED. One `seen` set was shared across a node's siblings and
//   never unwound, so the set meant "everything visited" rather than "the current path". A node
//   reached by a SECOND path was misread as a cycle and resolved to the top of the lattice. Every
//   node in the graph could be SYSTEM and the join still came back UNTRUSTED_EXTERNAL. It failed
//   CLOSED, so nothing leaked - it refused work nobody had any reason to refuse, which is the
//   failure mode that gets a control switched off.
//
//   Section 24 - THE WALK COULD THROW. It recursed, so a chain about ten thousand deep died with a
//   RangeError. `decide`'s own contract says it never throws, and the reason is written above it:
//   a policy engine that throws is a policy engine whose caller writes a try/catch, and that catch
//   block is the bypass.
//
//   Section 25 - AN UNKNOWN ROLE FAILED OPEN. `ceilingFor` asked whether a role was in the STEERING
//   set; a misspelling is not, so it collected `defaultCeiling` - the LOOSEST ceiling on the row.
//   This is the only one of the three that could ALLOW something.
//
// WHY NONE OF THIS WAS CAUGHT. Zero of the 213 source nodes in the corpus have more than one
// parent, and no test declared a `Source` with two. The multi-parent cases that do exist are all
// ARGUMENT-level, and those were always safe because `decide` passed a fresh set per argument. The
// one shape nobody wrote down was the one shape that was broken - which is the general lesson, and
// why the cases below are also carried in `corpus/tuning/provenance_dag.json`.

import { describe, expect, it } from "vitest";
import { type Provenance, type Source, actionId, decide, sourceId } from "../src/index.js";

/** A source, spelled compactly. */
const src = (id: string, provenance: Provenance, ...from: string[]): Source => ({
  id: sourceId(id),
  provenance,
  ...(from.length > 0 ? { derivedFrom: from.map((f) => sourceId(f)) } : {}),
});

/** An action whose single argument hangs off one source. */
const act = (capability: "payment" | "read_only_tool" | "email_send", from: string) => ({
  id: actionId("t"),
  capability,
  tool: "t",
  args: [{ name: "a", role: "sink_identity" as const, derivedFrom: [sourceId(from)] }],
});

/**
 * The diamond: one document, two extracts drawn from it, one summary drawn from both.
 *
 * This is not an exotic graph. It is the ordinary shape of `derivedOutput`, whose whole purpose is
 * "content one of our own tools produced FROM other content" - and a model shown two chunks of one
 * document produces exactly this.
 */
const diamond = (root: Provenance, rest: Provenance = "SYSTEM"): readonly Source[] => [
  src("doc", root),
  src("left", rest, "doc"),
  src("right", rest, "doc"),
  src("summary", rest, "left", "right"),
];

describe("a diamond is not a cycle", () => {
  it("an all-clean diamond stays CLEAN", () => {
    // The headline of section 23. Every node is SYSTEM; the only thing separating this from a chain
    // is that two paths reconverge. Before the fix this returned UNTRUSTED_EXTERNAL.
    const v = decide({ action: act("read_only_tool", "summary"), sources: diamond("SYSTEM") });
    expect(v.taint).toBe("CLEAN");
  });

  it("the diamond and the equivalent chain agree", () => {
    // The sharpest statement of the bug: the verdict depended on the SHAPE of the graph rather than
    // on the trust of anything in it. Reading MORE of the same clean document flipped an ALLOW into
    // a human approval prompt.
    const asChain = [
      src("doc", "SYSTEM"),
      src("left", "SYSTEM", "doc"),
      src("summary", "SYSTEM", "left"),
    ];
    const chain = decide({ action: act("email_send", "summary"), sources: asChain });
    const dia = decide({ action: act("email_send", "summary"), sources: diamond("SYSTEM") });
    expect(dia.taint).toBe(chain.taint);
    expect(dia.decision).toBe(chain.decision);
    expect(dia.decision).toBe("ALLOW");
  });

  it("a diamond carries the join of its shared ancestor, not the best path", () => {
    // The fix must not become "ignore the second path". The ancestor's taint still has to arrive.
    const v = decide({ action: act("read_only_tool", "summary"), sources: diamond("USER") });
    expect(v.taint).toBe("USER_CONTROLLED");
  });

  it("an untrusted shared ancestor still poisons the whole diamond", () => {
    // The direction that matters for safety. If the memo could ever LOWER a taint this is where it
    // would show, so this is the negative control for the repair itself.
    const v = decide({ action: act("read_only_tool", "summary"), sources: diamond("WEB") });
    expect(v.taint).toBe("UNTRUSTED_EXTERNAL");
    expect(v.decision).not.toBe("ALLOW");
  });

  it("reports every provenance that contributed, through both arms", () => {
    const v = decide({
      action: act("read_only_tool", "summary"),
      sources: [
        src("doc", "DOCUMENT"),
        src("left", "TOOL_OUTPUT", "doc"),
        src("right", "SYSTEM", "doc"),
        src("summary", "TOOL_OUTPUT", "left", "right"),
      ],
    });
    expect([...v.provenance].sort()).toEqual(["DOCUMENT", "SYSTEM", "TOOL_OUTPUT"]);
  });

  it("two parents with disjoint ancestries were always fine, and still are", () => {
    // The control that says the fix did not change behaviour nobody complained about.
    const v = decide({
      action: act("read_only_tool", "summary"),
      sources: [src("task", "USER"), src("cfg", "SYSTEM"), src("summary", "SYSTEM", "task", "cfg")],
    });
    expect(v.taint).toBe("USER_CONTROLLED");
  });
});

describe("cycles still fail closed", () => {
  // Everything here passed BEFORE the fix too. That is the point: the repair had to keep the
  // property that made the original code look correct.

  it("a two-node cycle is the top of the lattice", () => {
    const v = decide({
      action: act("read_only_tool", "a"),
      sources: [src("a", "SYSTEM", "b"), src("b", "SYSTEM", "a")],
    });
    expect(v.taint).toBe("UNTRUSTED_EXTERNAL");
  });

  it("a self-cycle is the top of the lattice", () => {
    const v = decide({ action: act("read_only_tool", "s"), sources: [src("s", "SYSTEM", "s")] });
    expect(v.taint).toBe("UNTRUSTED_EXTERNAL");
  });

  it("a cycle feeding a diamond poisons the diamond", () => {
    // The case the repair could plausibly have broken: a memo written while a cycle was being cut
    // is reused on a second path. A cut resolves to the TOP of the lattice, so such a value can
    // only ever be too STRICT - never too permissive. This pins that direction.
    const v = decide({
      action: act("read_only_tool", "join"),
      sources: [
        src("y", "SYSTEM", "z"),
        src("z", "SYSTEM", "y"),
        src("left", "SYSTEM", "y"),
        src("right", "SYSTEM", "y"),
        src("join", "SYSTEM", "left", "right"),
      ],
    });
    expect(v.taint).toBe("UNTRUSTED_EXTERNAL");
  });

  it("an edge to an undeclared source fails closed", () => {
    const v = decide({ action: act("read_only_tool", "ghost"), sources: [] });
    expect(v.taint).toBe("UNTRUSTED_EXTERNAL");
  });
});

describe("the walk is iterative, so depth cannot throw", () => {
  it("resolves a chain fifty thousand deep", () => {
    // Recursion died at roughly ten thousand with a RangeError. The number here is deliberately far
    // past that: a limit that is merely raised is a limit somebody will still find.
    const N = 50_000;
    const sources: Source[] = [src("s0", "SYSTEM")];
    for (let i = 1; i <= N; i++) sources.push(src(`s${i}`, "SYSTEM", `s${i - 1}`));
    const v = decide({ action: act("read_only_tool", `s${N}`), sources });
    expect(v.taint).toBe("CLEAN");
  });

  it("a deep chain carries its taint the whole way", () => {
    // Depth must not become a laundering path: one WEB node at the bottom of a long chain has to
    // still reach the top.
    const N = 20_000;
    const sources: Source[] = [src("s0", "WEB")];
    for (let i = 1; i <= N; i++) sources.push(src(`s${i}`, "SYSTEM", `s${i - 1}`));
    const v = decide({ action: act("read_only_tool", `s${N}`), sources });
    expect(v.taint).toBe("UNTRUSTED_EXTERNAL");
  });

  it("stacked diamonds stay affordable", () => {
    // Unwinding the path WITHOUT a memo is exponential: 20 stacked diamonds is 4.2 million visits.
    // This is the test that would hang rather than fail if the memo were ever removed, so it is
    // written at a depth where the difference is decisive rather than marginal.
    const N = 60;
    const sources: Source[] = [src(`L${N}`, "SYSTEM")];
    for (let i = 0; i < N; i++) {
      sources.push(src(`L${i}`, "SYSTEM", `a${i}`, `b${i}`));
      sources.push(src(`a${i}`, "SYSTEM", `L${i + 1}`));
      sources.push(src(`b${i}`, "SYSTEM", `L${i + 1}`));
    }
    const started = Date.now();
    const v = decide({ action: act("read_only_tool", "L0"), sources });
    expect(v.taint).toBe("CLEAN");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("a wide fan-out is resolved once per node, not once per path", () => {
    const WIDTH = 5_000;
    const sources: Source[] = [src("root", "SYSTEM")];
    const names: string[] = [];
    for (let i = 0; i < WIDTH; i++) {
      names.push(`n${i}`);
      sources.push(src(`n${i}`, "SYSTEM", "root"));
    }
    sources.push({
      id: sourceId("all"),
      provenance: "SYSTEM",
      derivedFrom: names.map((n) => sourceId(n)),
    });
    const v = decide({ action: act("read_only_tool", "all"), sources });
    expect(v.taint).toBe("CLEAN");
  });
});
