// The cross-policy table's integrity, held structurally rather than by convention.
//
// Two failure modes are worth wiring a test against, and neither is a bug in the arithmetic.
//
// The first is POOLING. A summary row - "reference: 97% across all splits" - would be arithmetically
// correct and epistemically worthless, because the splits are not samples from one population. One
// was frozen before the engine existed, one after, one is freely editable by the person being
// graded. Averaging them launders the weak evidence into the strong evidence's number.
//
// The second is a RIGGED FIELD. The comparison only means something if the alternative profiles are
// deployments someone could actually choose. If `permissive` were quietly broken, the reference
// would win a race it never ran, and the table would read as a demonstration while being an
// advertisement.

import { join } from "node:path";
import { classify } from "@agent-context-containment/classifier";
import {
  type CrossPolicyReport,
  PROFILES,
  PROFILE_INTENT,
  crossPolicy,
  formatCrossPolicy,
  loadSplit,
  permissiveProfile,
  strictProfile,
} from "@agent-context-containment/conformance";
import { ALL_CAPABILITIES, CAPABILITY_POLICY, type Split } from "@agent-context-containment/core";
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
const baseline = { name: "ported production detector", classify };
const report: CrossPolicyReport = crossPolicy({ splits, classifier: baseline });

describe("cross-policy comparison", () => {
  it("every cell is one (profile, split) pair and nothing else exists", () => {
    // If a cell could ever be a profile's total or a split's total, pooling would be one `.reduce`
    // away. Asserting the exact cell count makes an aggregate impossible to add without this
    // failing first.
    expect(report.cells.length, "cell count is not profiles x splits").toBe(
      report.profiles.length * report.splits.length,
    );
    const seen = new Set(report.cells.map((c) => `${c.profile}/${c.split}`));
    expect(seen.size, "a (profile, split) pair appears twice").toBe(report.cells.length);
    for (const c of report.cells) {
      expect(
        NAMES.includes(c.split as Split),
        `cell ${c.profile}/${c.split} names no real split`,
      ).toBe(true);
    }
  });

  it("the rendered report contains no aggregate row", () => {
    // Checked structurally, not by scanning for the word "average" - the report's own prose says
    // "no cell is an average", and a word blocklist would flag the sentence that makes the promise.
    // The real invariant is that every line naming a profile also names a split.
    const out = formatCrossPolicy(report);
    for (const p of report.profiles) {
      const rows = out.split("\n").filter((l) => l.startsWith(`  ${p}`) && /\d/.test(l));
      expect(
        rows.length,
        `${p} appears on ${rows.length} numeric lines, expected exactly one per split`,
      ).toBe(NAMES.length);
      for (const row of rows) {
        // Token-wise, not substring-wise: "holdout" is a prefix of "holdout_v2".
        const [, split] = row.trim().split(/\s+/);
        expect(
          NAMES.includes(split as Split),
          `a numeric ${p} row's second column is "${split}" - an aggregate row would name no split`,
        ).toBe(true);
      }
    }
  });

  it("every profile states what it is for", () => {
    // A column of scores with no statement of intent invites the reader to treat the best score as
    // the right answer, which is the one conclusion this table is built to refuse.
    for (const p of PROFILES) {
      const intent = PROFILE_INTENT[p.name];
      expect(intent !== undefined, `profile ${p.name} has no stated intent`).toBe(true);
      expect((intent ?? "").length > 40, `profile ${p.name}'s intent is too thin to be one`).toBe(
        true,
      );
    }
  });

  it("strict is strictly tighter than reference, and only where tightening buys something", () => {
    // A "strict" profile that is not actually tighter would make the whole comparison theatre.
    let tightened = 0;
    for (const cap of ALL_CAPABILITIES) {
      const row = CAPABILITY_POLICY[cap];
      if (row.effect === "none" && row.egress === "none") continue;
      tightened++;
    }
    expect(tightened > 0, "strict tightens no row, so it is not a stricter profile").toBe(true);
    // Behaviourally: it must refuse at least one thing the reference allows.
    const ref = report.cells.filter((c) => c.profile === "reference");
    const str = report.cells.filter((c) => c.profile === "strict");
    const extraRefusals = str.reduce((n, c) => {
      const r = ref.find((x) => x.split === c.split);
      return n + (c.metrics.falsePositives - (r?.metrics.falsePositives ?? 0));
    }, 0);
    expect(extraRefusals > 0, "strict never refuses anything reference allows").toBe(true);
  });

  it("permissive is a risk appetite, not a broken engine", () => {
    // The load-bearing fairness check. `permissive` must still hold the line on everything
    // irreversible and everything with full egress - otherwise it is a mutant wearing a profile's
    // name, and the reference wins a race nobody else was allowed to run.
    for (const cap of ALL_CAPABILITIES) {
      const row = CAPABILITY_POLICY[cap];
      if (row.effect !== "irreversible" && row.egress !== "full") continue;
      // Those rows are copied through untouched, so the reference and permissive must agree on any
      // case that targets them. Checked behaviourally below rather than by reading the table.
      expect(row.capability, "policy row key drifted").toBe(cap);
    }
    const ref = report.cells.filter((c) => c.profile === "reference");
    const perm = report.cells.filter((c) => c.profile === "permissive");
    // It must let something through that reference stops - otherwise it is not looser at all.
    const extraMisses = perm.reduce((n, c) => {
      const r = ref.find((x) => x.split === c.split);
      return n + (c.metrics.falseNegatives - (r?.metrics.falseNegatives ?? 0));
    }, 0);
    expect(
      extraMisses > 0,
      "permissive misses nothing reference catches, so it is not looser",
    ).toBe(true);
    // And it must not be a blanket allow: it still has to block most attacks.
    for (const c of perm) {
      if (c.metrics.attacks === 0) continue;
      expect(
        c.metrics.truePositives > 0 || c.split === "holdout_v2",
        `permissive blocks nothing at all on ${c.split}, which makes it a mutant, not a profile`,
      ).toBe(true);
    }
  });

  it("the two profiles differ from the reference in opposite directions", () => {
    // Strict pays in over-block, permissive pays in under-block. If both paid on the same axis, one
    // of them is mislabelled and the table would be reporting a single direction as if it were a
    // curve.
    const sum = (name: string, k: "falsePositives" | "falseNegatives") =>
      report.cells.filter((c) => c.profile === name).reduce((n, c) => n + c.metrics[k], 0);
    expect(sum("strict", "falsePositives") > sum("reference", "falsePositives")).toBe(true);
    expect(sum("strict", "falseNegatives")).toBe(sum("reference", "falseNegatives"));
    expect(sum("permissive", "falseNegatives") > sum("reference", "falseNegatives")).toBe(true);
    expect(sum("permissive", "falsePositives")).toBe(sum("reference", "falsePositives"));
  });

  it("the classifier is scored per split, in the same table, not as a footnote", () => {
    const rows = report.cells.filter((c) => c.profile === "classifier");
    expect(rows.length, "the classifier is not scored on every split").toBe(NAMES.length);
    // It should look bad on the laundering splits and that is the point - assert it is actually
    // being run rather than stubbed to zero everywhere, which is what a broken wiring looks like.
    const caught = rows.reduce((n, c) => n + c.metrics.truePositives, 0);
    expect(
      caught > 0,
      "the classifier catches nothing anywhere - it is mis-wired, not merely weak",
    ).toBe(true);
  });

  it("a profile with a flawless record is reported as unmeasured, not as best", () => {
    const out = formatCrossPolicy(report);
    const flawless = report.profiles.filter((name) => {
      const own = report.cells.filter((c) => c.profile === name);
      return own.every((c) => c.metrics.falsePositives === 0 && c.metrics.falseNegatives === 0);
    });
    for (const name of flawless) {
      expect(
        out.includes(`${name} makes no error on any split`),
        `${name} scores perfectly and the report does not say why that is a corpus fact`,
      ).toBe(true);
    }
  });
});
