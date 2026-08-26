// Every split against every policy profile, plus the classifier, in one table.
//
// The rule that shapes this file: A CELL IS ALWAYS (profile, split). There is no code path that
// produces a number for a profile across splits, or for a split across profiles, because the two
// dimensions mean different things and averaging over either one destroys the only information the
// table carries. Pooling splits would claim the frozen holdout and the freely-editable tuning set
// are samples from one population. Pooling profiles would claim there is a single right risk
// appetite - the exact claim this comparison exists to refuse.
//
// `crosspolicy.test.ts` holds that structurally rather than by convention: it asserts the report
// contains no aggregate row, and that the cell count equals profiles x splits exactly.

import type { CorpusCase, Split } from "@agent-containment/core";
import { type SplitMetrics, metricsFor } from "./compare.js";
import type { ContainmentPolicy, TextClassifier } from "./ports.js";
import { PROFILES, PROFILE_INTENT } from "./profiles.js";

export interface Cell {
  readonly profile: string;
  readonly split: string;
  readonly metrics: SplitMetrics;
}

export interface CrossPolicyReport {
  readonly cells: readonly Cell[];
  readonly profiles: readonly string[];
  readonly splits: readonly string[];
}

export function crossPolicy(args: {
  readonly splits: readonly { readonly split: Split; readonly cases: readonly CorpusCase[] }[];
  readonly classifier: TextClassifier;
  readonly profiles?: readonly ContainmentPolicy[];
}): CrossPolicyReport {
  const profiles = args.profiles ?? PROFILES;
  const cells: Cell[] = [];
  for (const p of profiles) {
    for (const s of args.splits) {
      cells.push({
        profile: p.name,
        split: s.split,
        metrics: metricsFor({
          split: s.split,
          cases: s.cases,
          policy: p,
          classifier: args.classifier,
          byClassifier: false,
        }),
      });
    }
  }
  // The classifier is scored per split too, and enters the same table as a fourth row band rather
  // than as a footnote - it is a rival approach, not an appendix.
  for (const s of args.splits) {
    cells.push({
      profile: "classifier",
      split: s.split,
      metrics: metricsFor({
        split: s.split,
        cases: s.cases,
        policy: profiles[0] as ContainmentPolicy,
        classifier: args.classifier,
        byClassifier: true,
      }),
    });
  }
  return {
    cells,
    profiles: [...profiles.map((p) => p.name), "classifier"],
    splits: args.splits.map((s) => s.split),
  };
}

const pad = (s: string, n: number): string => s.padEnd(n);
const frac = (a: number, b: number): string => (b === 0 ? "  -  " : `${a}/${b}`);

export function formatCrossPolicy(r: CrossPolicyReport): string {
  const rule = "=".repeat(100);
  const lines = [
    rule,
    "policy profiles vs the classifier, by split - no cell is an average",
    rule,
    "",
  ];
  lines.push(
    `  ${pad("profile", 15)}${pad("split", 13)}${pad("n", 5)}${pad("attacks blocked", 18)}${pad("benign allowed", 17)}${pad("over-block", 12)}under-block`,
  );
  lines.push(`  ${"-".repeat(96)}`);
  let last = "";
  for (const c of r.cells) {
    const m = c.metrics;
    if (last !== "" && c.profile !== last) lines.push("");
    last = c.profile;
    lines.push(
      `  ${pad(c.profile, 15)}${pad(c.split, 13)}${pad(String(m.n), 5)}` +
        `${pad(frac(m.truePositives, m.attacks), 18)}` +
        `${pad(frac(m.trueNegatives, m.benign), 17)}` +
        `${pad(String(m.falsePositives), 12)}${m.falseNegatives}`,
    );
  }
  lines.push("");
  lines.push(`  ${"-".repeat(96)}`);
  lines.push(
    "  WHAT EACH PROFILE IS FOR - read the numbers against the intent, not against each other",
  );
  lines.push(`  ${"-".repeat(96)}`);
  for (const [name, intent] of Object.entries(PROFILE_INTENT)) {
    lines.push(`  ${pad(name, 15)}${intent}`);
  }
  lines.push(
    `  ${pad("classifier", 15)}a rival technique, not a profile: it reads text and cannot escalate`,
  );
  // ---- the observation a reader would otherwise have to make for me -------------------------
  // A profile with no errors anywhere is not a triumph, it is a measurement failure: the corpus
  // contains nothing that prices its tradeoff. Computed rather than written down, so it disappears
  // on its own the day a case finally costs the reference something.
  const flawless = r.profiles.filter((name) => {
    const own = r.cells.filter((c) => c.profile === name);
    return (
      own.length > 0 &&
      own.every((c) => c.metrics.falsePositives === 0 && c.metrics.falseNegatives === 0)
    );
  });
  if (flawless.length > 0) {
    lines.push("");
    lines.push(`  ${"-".repeat(96)}`);
    lines.push("  READ THIS BEFORE QUOTING THE TABLE");
    lines.push(`  ${"-".repeat(96)}`);
    for (const name of flawless) {
      lines.push(`  ${name} makes no error on any split. That is a fact about the CORPUS, not a`);
      lines.push(
        "  result: it means no case here is hard enough to cost this profile anything, so",
      );
      lines.push(
        "  its position on the safety/utility curve is unmeasured rather than optimal. The",
      );
      lines.push("  other profiles are informative precisely because they do make errors - strict");
      lines.push("  pays in over-block, permissive pays on the laundering splits, and those costs");
      lines.push("  are what a tradeoff looks like when the corpus can see it.");
    }
  }

  lines.push("");
  lines.push(
    "  NOTE ON THE OVER-BLOCK COLUMN. A benign case that ESCALATES lands here unless the case",
  );
  lines.push(
    "  itself expected an escalation, which understates `escalating` - its whole design is to",
  );
  lines.push(
    "  move work from refused to reviewed, and this table has no column for that. The frontier",
  );
  lines.push(
    "  report (pnpm report:frontier) separates the two and is the honest place to read it.",
  );
  lines.push("");
  lines.push("  There is no row here for a profile's total, and there will not be one. `strict`");
  lines.push(
    "  blocking more attacks than `reference` is not `strict` winning - it was built to do",
  );
  lines.push(
    "  that, and the column that prices it is over-block. Which profile is correct depends",
  );
  lines.push("  on which of those two columns you would be answering for, and this table cannot");
  lines.push("  know that. Reporting a single best profile would be inventing an answer.");
  lines.push(rule);
  return lines.join("\n");
}
