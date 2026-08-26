// The frontier report, and the word it is not allowed to say.
//
// "0 over-block, 0 under-block" looks like an optimum and is not one. An optimum is a claim about a
// frontier - that nothing else does better on one axis without doing worse on another - and a single
// point cannot support it. The report plots five points instead, and these tests hold it to two
// things: that the arithmetic behind any dominance claim is real, and that no generated output can
// imply optimality the numbers do not establish.
//
// The second is enforced as a text rule on the rendered report, because that is the artifact a reader
// quotes. A caveat in a comment protects nobody.

import { join } from "node:path";
import { classify } from "@agent-containment/classifier";
import {
  type FrontierReport,
  PROFILES,
  PROFILE_INTENT,
  formatFrontier,
  frontier,
  frontierClaims,
  loadSplit,
} from "@agent-containment/conformance";
import type { Split } from "@agent-containment/core";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..", "corpus");
const NAMES: readonly Split[] = [
  "holdout",
  "holdout_v2",
  "tuning",
  "derived",
  "adaptive",
  "imported",
];
const splits = NAMES.map((split) => ({ split, cases: loadSplit(join(ROOT, split), split) }));
const report: FrontierReport = frontier({
  splits,
  classifier: { name: "ported production detector", classify },
});
const rendered = formatFrontier(report);

describe("policy frontier", () => {
  it("plots every profile against every split and nothing else", () => {
    expect(report.points.length).toBe(PROFILES.length * NAMES.length);
    const seen = new Set(report.points.map((p) => `${p.profile}/${p.split}`));
    expect(seen.size, "a (profile, split) point appears twice").toBe(report.points.length);
  });

  it("there are at least five profiles, and each states what it is for", () => {
    expect(
      PROFILES.length,
      "a frontier needs more than the three profiles v0.6 had",
    ).toBeGreaterThan(4);
    for (const p of PROFILES) {
      const intent = PROFILE_INTENT[p.name];
      expect((intent ?? "").length > 40, `profile ${p.name} has no stated intent`).toBe(true);
    }
  });

  it("escalation is counted apart from over-block", () => {
    // The change that makes this report worth having. The cross-policy table folds a benign
    // escalation into over-block, which badly understates `escalating` - its entire design is to move
    // work from refused to reviewed. Those are different outcomes: one destroys the task, the other
    // costs somebody a minute.
    const esc = report.points
      .filter((p) => p.profile === "escalating")
      .reduce((n, p) => n + p.benignEscalated, 0);
    expect(
      esc,
      "the escalating profile escalates nothing, so it is not what it claims to be",
    ).toBeGreaterThan(0);
    const over = report.points
      .filter((p) => p.profile === "escalating")
      .reduce((n, p) => n + p.overBlock, 0);
    expect(over, "escalating destroyed work rather than deferring it").toBe(0);
    // Every benign case lands in exactly one of the three buckets.
    for (const p of report.points) {
      expect(
        p.benignAllowed + p.benignEscalated + p.overBlock,
        `${p.profile}/${p.split}: benign outcomes do not sum to the benign count`,
      ).toBe(p.benign);
      expect(p.attacksContained + p.underBlock, `${p.profile}/${p.split}: attacks do not sum`).toBe(
        p.attacks,
      );
    }
  });

  it("the two axes are genuinely independent - egress_strict is not a copy of strict", () => {
    // A claim the two-axis model makes, tested rather than assumed. If tightening egress alone
    // produced the same numbers as tightening both, the effect axis would be decoration.
    const total = (name: string, k: "overBlock" | "underBlock") =>
      report.points.filter((p) => p.profile === name).reduce((n, p) => n + p[k], 0);
    expect(
      total("egress_strict", "overBlock"),
      "tightening egress alone costs the same as tightening both axes, so the second axis buys nothing",
    ).not.toBe(total("strict", "overBlock"));
    expect(total("egress_strict", "overBlock")).toBeLessThan(total("strict", "overBlock"));
  });

  it("dominance is real arithmetic, not a label", () => {
    const claims = frontierClaims(report);
    const totals = new Map(
      report.profiles.map((name) => {
        const mine = report.points.filter((p) => p.profile === name);
        return [
          name,
          {
            over: mine.reduce((n, p) => n + p.overBlock, 0),
            under: mine.reduce((n, p) => n + p.underBlock, 0),
          },
        ];
      }),
    );
    for (const c of claims) {
      const me = totals.get(c.profile);
      if (me === undefined) continue;
      for (const other of c.dominatedBy) {
        const o = totals.get(other);
        if (o === undefined) continue;
        expect(
          o.over <= me.over && o.under <= me.under && (o.over < me.over || o.under < me.under),
          `${other} is listed as dominating ${c.profile} and does not`,
        ).toBe(true);
      }
      if (c.paretoOptimal) {
        expect(
          c.dominatedBy.length,
          `${c.profile} is called undominated and lists dominators`,
        ).toBe(0);
      }
    }
  });

  it("more than one profile is undominated, which is what a tradeoff looks like", () => {
    // If exactly one profile were undominated, the report would be one step from reading as "here is
    // the best policy" - which is the conclusion it exists to refuse.
    const undominated = frontierClaims(report).filter((c) => c.paretoOptimal);
    expect(
      undominated.length,
      "only one profile is undominated; the corpus cannot separate a tradeoff from a winner",
    ).toBeGreaterThan(1);
  });

  it("no line of the report ASSERTS optimality", () => {
    // A blunt substring ban would flag the report's own disclaimer - "READ THAT AS A BOUND, NOT AS
    // OPTIMALITY" contains the word - which is the same mistake as banning "average" from a report
    // whose header promises no averages. So the rule is per line and it is about assertion: a line
    // may use the word only while negating it.
    const NEGATED = /\bnot\b|\bcannot\b|\bdoes not\b|\bnever\b|\bno\b/i;
    for (const line of rendered.split("\n")) {
      if (!/optimal|\bbest\b|\bwinner\b/i.test(line)) continue;
      expect(
        NEGATED.test(line),
        `this line claims optimality and the arithmetic does not support it:\n    ${line}`,
      ).toBe(true);
    }
    // And the strongest phrasing the report is permitted to use must actually be the bounded one.
    expect(rendered).toContain("not dominated on this corpus");
  });

  it("every dominance claim is printed with its bound attached", () => {
    expect(rendered).toContain("READ THAT AS A BOUND, NOT AS OPTIMALITY");
    expect(rendered, "the report does not say how many profiles were actually tried").toContain(
      "five were tried",
    );
    expect(rendered, "the report does not name the corpus as the limit of the claim").toContain(
      "68 cases chosen by the same person",
    );
  });

  it("no row in the report is an average across splits", () => {
    // Same rule as the cross-policy table: the per-split rows must each name a split. The one
    // corpus-wide block is explicitly labelled a shape rather than a score.
    for (const name of report.profiles) {
      const rows = rendered.split("\n").filter((l) => l.startsWith(`  ${name}`) && /%/.test(l));
      expect(rows.length, `${name} has ${rows.length} rate rows, expected one per split`).toBe(
        NAMES.length,
      );
    }
    expect(rendered).toContain("Totals here are a SHAPE, not a score");
  });
});
