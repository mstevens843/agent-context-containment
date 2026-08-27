#!/usr/bin/env node
// Numbers in prose, owned by the code that computes them.
//
// WHY THIS EXISTS. Stale numbers have recurred in FOUR separate passes of this project. `imported 6`
// survived three versions after the split doubled to 34. A silent-attack table read 23/23 long after
// it became 69/69. Test counts have been wrong repeatedly, in both directions. Each time it was
// caught by a person reading carefully, and each time the fix was to retype the number - which is the
// same act that produced the error.
//
// Prose has no type system. This is the type system.
//
//   node scripts/generated-blocks.mjs --check    verify every block matches its generator  (CI)
//   node scripts/generated-blocks.mjs --write    regenerate every block
//
// A block looks like this, and the marker names the generator that owns it:
//
//   <!-- GENERATED:corpus-splits -->
//   ...whatever the generator returns...
//   <!-- /GENERATED -->
//
// WHAT IS DELIBERATELY NOT GENERATED. A number inside a sentence - "declaring a send tool as
// read-only lets 32 of 32 imported attacks through" - reads as prose and would be wrecked by a block
// marker around it. Those are protected differently: `claims.test.ts` requires each to name the
// script that produces it, and `pnpm audit:claims` re-runs that script and compares. Blocks are for
// TABLES; the claim registry is for SENTENCES. Both are needed because neither covers the other.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classify } from "../packages/classifier/dist/index.js";
import {
  MUTANTS,
  REVIEW_WORKFLOWS,
  compareAll,
  loadSplit,
  referenceProfile,
  runCorpus,
  runWorkflow,
  sensitivity,
} from "../packages/conformance/dist/index.js";

const ROOT = new URL("..", import.meta.url).pathname;
const CORPUS = `${ROOT}corpus/`;
const NAMES = ["holdout", "holdout_v2", "tuning", "derived", "adaptive", "imported"];
const splits = NAMES.map((split) => ({ split, cases: loadSplit(CORPUS + split, split) }));
const baseline = { name: "ported production detector", classify };
const all = splits.flatMap((s) => s.cases);

const pad = (s, n) => String(s).padEnd(n);
const frac = (a, b) => (b === 0 ? "  -  " : `${a}/${b}`);
const stripAnsi = (s) => {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 27 && s[i + 1] === "[") {
      let j = i + 2;
      while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || s[j] === ";")) j++;
      if (s[j] === "m") {
        i = j;
        continue;
      }
    }
    out += s[i];
  }
  return out;
};

const testOutputTail = (out) => stripAnsi(out).split("\n").slice(-40).join("\n").trim();

/**
 * Extract the package rows for the test-count block from Turborepo/Vitest output.
 *
 * The first version did this with:
 *
 *   pnpm -s test 2>&1 | grep -E 'Tests +[0-9]+ passed'
 *
 * That hid the useful output when CI went red: `grep` found no all-passing summary, returned 1, and
 * the block generator crashed with empty stdout/stderr. A generated block may depend on a green test
 * suite, but it must fail by naming the suite as red, not by pretending the docs are stale.
 */
export const parseTestCountsForBlock = (raw) => {
  const out = stripAnsi(raw);
  const failedSummaries = out
    .split("\n")
    .filter((line) => /:test:\s+(Test Files|Tests)\s+.*\bfailed\b/.test(line));

  if (failedSummaries.length > 0) {
    throw new Error(
      [
        "generated-blocks: pnpm test was red while computing the test-counts block.",
        "This is a test failure, not stale generated documentation.",
        ...failedSummaries.slice(-8),
      ].join("\n"),
    );
  }

  const per = [...out.matchAll(/^([^:\n]+):test:\s+Tests\s+(\d+)\s+passed\b/gm)].map((m) => {
    const packageName = m[1].includes("/") ? m[1].slice(m[1].lastIndexOf("/") + 1) : m[1];
    return [packageName, Number(m[2])];
  });

  if (per.length === 0) {
    throw new Error(
      [
        "generated-blocks: could not parse per-package test counts from `pnpm -s test` output.",
        "The test-count block parser needs to be updated for the current runner output.",
        testOutputTail(out),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return per.sort((a, b) => b[1] - a[1]);
};

const runTestsForCountBlock = () => {
  try {
    return execSync("pnpm -s test", {
      cwd: ROOT,
      encoding: "utf8",
      shell: "/bin/bash",
      stdio: "pipe",
    });
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    throw new Error(
      [
        "generated-blocks: `pnpm -s test` failed while computing the test-counts block.",
        "Fix the test suite first; do not refresh generated documentation from a red run.",
        testOutputTail(out),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
};

// ---- the generators ---------------------------------------------------------------------------
// Each returns the exact text of one block. Keyed by the name in the marker.
const GENERATORS = {
  "domain-demos": () => {
    // Which domains the demo set covers and what each one stops. Generated so that adding a domain
    // updates the README, and so the framing claim - general infrastructure, payments as one domain
    // among several - is a fact the code produces rather than a sentence somebody typed.
    const results = REVIEW_WORKFLOWS.map(runWorkflow);
    const lines = ["| domain | the attack it stops | safe steps kept |", "|---|---|---|"];
    for (const r of results) {
      const stopped = r.refused + r.stalled;
      lines.push(
        `| **${r.domain}** | ${r.title.toLowerCase()} | ${r.completed + r.reviewed} kept, ${stopped} stopped |`,
      );
    }
    return lines.join("\n");
  },

  "mapping-sensitivity": () => {
    // The imported split's robustness figures. Hand-typed in corpus/imported/ATTRIBUTION.md until
    // v1.0, where they were found three versions stale - in the one document family the prose guard
    // did not scan.
    const HERE = `${ROOT}corpus/imported/`;
    const imported = loadSplit(`${ROOT}corpus/imported`, "imported");
    const lines = ["```"];
    for (const [file, label] of [
      ["MAPPING.json", "direct harm  "],
      ["MAPPING_DS.json", "data stealing"],
    ]) {
      const m = JSON.parse(readFileSync(HERE + file, "utf8"));
      const rs = m.cases.map((x) =>
        sensitivity(
          x,
          imported.find((c) => c.id === x.id),
        ),
      );
      const robust = rs.filter((r) => r.robust).length;
      const broken = rs.filter((r) => r.permittedByUnderstating.length > 0).length;
      lines.push(
        `${label}  ROBUST to peer mappings ${robust}/${rs.length}   permitted when UNDERSTATED ${broken}/${rs.length}`,
      );
    }
    lines.push("```");
    return lines.join("\n");
  },

  "corpus-splits": () => {
    const kinds = {};
    for (const c of all) kinds[c.source.kind] = (kinds[c.source.kind] ?? 0) + 1;
    const lines = ["| split | n | | source kind | n |", "|---|---|---|---|---|"];
    const kindRows = Object.entries(kinds).sort((a, b) => b[1] - a[1]);
    splits.forEach((s, i) => {
      const k = kindRows[i];
      lines.push(
        `| \`${s.split}\` | ${s.cases.length} | | ${k ? `\`${k[0]}\`` : ""} | ${k ? k[1] : ""} |`,
      );
    });
    lines.push(`| **total** | **${all.length}** | | | |`);
    return lines.join("\n");
  },

  "holdout-headline": () => {
    // The four numbers a reader is most likely to quote, and until v1.0 the only headline table in
    // the repository that was hand-typed and outside any block - the exact shape of the four prior
    // staleness recurrences. It happened to be correct; nothing enforced that.
    const h = splits.find((s) => s.split === "holdout");
    const cmp = compareAll({ splits: [h], policy: referenceProfile, classifier: baseline });
    const c = cmp.containment[0];
    const k = cmp.classifier[0];
    return [
      "|  | containment | classifier |",
      "|---|---|---|",
      `| **attacks blocked** | **${frac(c.truePositives, c.attacks)}** | **${frac(k.truePositives, k.attacks)}** |`,
      `| **benign allowed** | **${frac(c.trueNegatives, c.benign)}** | **${frac(k.trueNegatives, k.benign)}** |`,
      `| **silent attacks blocked** (no injection wording) | **${frac(c.silentAttacksCaught, c.silentAttacks)}** | **${frac(k.silentAttacksCaught, k.silentAttacks)}** |`,
      `| **benign quoted-attack cases over-blocked** | **${c.falsePositives}/${c.benign}** | **${k.falsePositives}/${k.benign}** |`,
    ].join("\n");
  },

  "classifier-vs-containment": () => {
    const cmp = compareAll({ splits, policy: referenceProfile, classifier: baseline });
    const lines = [
      "```",
      "  CONTAINMENT                                    CLASSIFIER BASELINE",
      "  split         n    blocked  allowed   escal    blocked  allowed   FN   FP",
    ];
    cmp.containment.forEach((c, i) => {
      const k = cmp.classifier[i];
      lines.push(
        `  ${pad(c.split, 14)}${pad(c.n, 5)}${pad(frac(c.truePositives, c.attacks), 9)}${pad(frac(c.trueNegatives, c.benign), 10)}${pad(c.escalatedCorrectly, 9)}` +
          `${pad(frac(k.truePositives, k.attacks), 9)}${pad(frac(k.trueNegatives, k.benign), 10)}${pad(k.falseNegatives, 5)}${k.falsePositives}`,
      );
    });
    const silent = cmp.containment.reduce((n, c) => n + c.silentAttacks, 0);
    const silentCaught = cmp.containment.reduce((n, c) => n + c.silentAttacksCaught, 0);
    const silentClassifier = cmp.classifier.reduce((n, c) => n + c.silentAttacksCaught, 0);
    const attacks = cmp.containment.reduce((n, c) => n + c.attacks, 0);
    const benign = cmp.containment.reduce((n, c) => n + c.benign, 0);
    const fp = cmp.containment.reduce((n, c) => n + c.falsePositives, 0);
    const fn = cmp.containment.reduce((n, c) => n + c.falseNegatives, 0);
    lines.push("");
    lines.push("  SILENT ATTACKS - no injection wording for any text detector to find");
    lines.push(
      `  ${pad("", 14)}${pad(silent, 5)}${pad(frac(silentCaught, silent), 28)}${frac(silentClassifier, silent)}`,
    );
    lines.push("");
    lines.push("  UTILITY - what survives the policy");
    lines.push(`    over-blocked   ${fp}/${benign} benign cases refused`);
    lines.push(`    under-blocked  ${fn}/${attacks} attacks allowed`);
    lines.push("```");
    return lines.join("\n");
  },

  "mutant-bite-matrix": () => {
    const bites = (policy, cases) =>
      runCorpus({ cases, policy, classifier: baseline }).results.filter((r) => {
        if (r.outOfScope) return false;
        if (r.groundTruth === "attack") return !r.containmentRefused;
        return r.containmentRefused && r.escalatedAsExpected !== true;
      }).length;
    const lines = [
      "```",
      `  ${pad("mutant", 38)}${NAMES.map((n) => String(n.slice(0, 9)).padStart(11)).join("")}${"total".padStart(9)}`,
    ];
    for (const m of MUTANTS) {
      const per = splits.map((s) => bites(m, s.cases));
      lines.push(
        `  ${pad(m.name, 38)}${per.map((n) => String(n).padStart(11)).join("")}${String(per.reduce((a, b) => a + b, 0)).padStart(9)}`,
      );
    }
    lines.push("```");
    return lines.join("\n");
  },

  // ---- repo-stats ------------------------------------------------------------------------------
  // WHY THIS IS GENERATED RATHER THAN REGISTERED. A line-count table is the worst kind of hand-typed
  // number: nobody re-counts it, every pass invalidates it, and it looks authoritative. At v1.0-rc
  // every row of it was stale - 34 test files when there were 41, 13 examples when there were 14,
  // 11,018 source lines when there were 11,296 - and none of it was caught, because the unregistered
  // survey only reported it. Counting beats registering here: there is nothing to keep in sync.
  "repo-stats": () => {
    const count = (cmd) =>
      Number(execSync(cmd, { cwd: ROOT, encoding: "utf8", shell: "/bin/bash" }).trim());
    const loc = (find) =>
      Number(
        execSync(`${find} | xargs wc -l | tail -1 | awk '{print $1}'`, {
          cwd: ROOT,
          encoding: "utf8",
          shell: "/bin/bash",
        }).trim(),
      );
    const SRC =
      "find packages -name '*.ts' -not -name '*.test.ts' -not -path '*/node_modules/*' -not -path '*/dist/*'";
    const TEST = "find packages -name '*.test.ts' -not -path '*/node_modules/*'";
    const EX = "find examples -name '*.ts'";
    const SCRIPT = "find scripts -name '*.mjs'";
    const srcLoc = loc(SRC);
    const testLoc = loc(TEST);
    const exLoc = loc(EX);
    const scriptLoc = loc(SCRIPT);
    const testFiles = count(`${TEST} | wc -l`);
    const exFiles = count(`${EX} | wc -l`);
    const scriptFiles = count(`${SCRIPT} | wc -l`);
    const shellFiles = count("find scripts -name '*.sh' | wc -l");
    // COUNTED OVER `docs/` ONLY, AND THAT IS NOT A SIMPLIFICATION.
    //
    // The first version counted every `.md` in the repository - including STATUS.md, which is where
    // this block LIVES. Writing the block changed STATUS.md's length, which changed the number the
    // block reports, which made the block stale again: `blocks:write` followed immediately by
    // `blocks:check` failed with no fixed point to converge on. A generated block that counts the
    // file it is written into cannot be checked. `docs/` carries no generated blocks.
    const docFiles = count("find docs -name '*.md' | wc -l");
    const docLoc = loc("find docs -name '*.md'");
    const n = (x) => x.toLocaleString("en-US");
    return [
      "| | |",
      "|---|---|",
      `| Source LOC | **${n(srcLoc)}** across 5 packages |`,
      `| Test LOC | **${n(testLoc)}** across ${testFiles} files |`,
      `| Example LOC | **${n(exLoc)}** across ${exFiles} files |`,
      `| Script LOC | **${n(scriptLoc)}** — ${scriptFiles} report/proof/import scripts, ${shellFiles} shell |`,
      `| Total TypeScript | **${n(srcLoc + testLoc + exLoc)}** |`,
      `| Docs (docs/) | **${n(docLoc)} lines** across ${docFiles} files |`,
    ].join("\n");
  },
  "test-counts": () => {
    // Read from the packages themselves rather than from a remembered figure.
    const per = parseTestCountsForBlock(runTestsForCountBlock());
    const total = per.reduce((n, [, c]) => n + c, 0);
    const rows = per.map(([p, c]) => `| \`${p}\` | ${c} |`);
    return ["| package | tests |", "|---|---|", ...rows, `| **total** | **${total}** |`].join("\n");
  },
};

// ---- the files that carry blocks ---------------------------------------------------------------
// Any file may carry a block. `corpus/imported/ATTRIBUTION.md` is here because its numbers went
// stale for three versions while sitting in the one directory nothing scanned.
const FILES = ["README.md", "STATUS.md", "corpus/imported/ATTRIBUTION.md"];
const OPEN = /<!-- GENERATED:([a-z0-9-]+) -->/g;

const main = () => {
  const mode = process.argv.includes("--write") ? "write" : "check";
  let problems = 0;
  let blocks = 0;

  /**
   * Blank out fenced code blocks before scanning for markers.
   *
   * Documenting the marker format is indistinguishable from using it, and the natural place to write
   * the example is a fenced block. Without this, `docs/ADVERSARIAL_AUDIT.md` explaining what a marker
   * looks like would be parsed as a marker naming a generator called "name" - which is exactly what
   * happened the first time, on this script's second run, in a sentence in STATUS.md. Replaced with
   * spaces rather than removed, so every reported offset still points at the right line.
   */
  const outsideCode = (text) => text.replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length));

  for (const file of FILES) {
    const path = ROOT + file;
    let text = readFileSync(path, "utf8");
    const found = [...outsideCode(text).matchAll(OPEN)];
    for (const m of found) {
      const name = m[1];
      const gen = GENERATORS[name];
      const startTag = `<!-- GENERATED:${name} -->`;
      const endTag = "<!-- /GENERATED -->";
      const from = text.indexOf(startTag);
      const to = text.indexOf(endTag, from);
      if (to === -1) {
        console.error(`  ${file}: block "${name}" opens and never closes`);
        problems++;
        continue;
      }
      if (gen === undefined) {
        console.error(
          `  ${file}: block "${name}" names no generator. Known: ${Object.keys(GENERATORS).join(", ")}`,
        );
        problems++;
        continue;
      }
      blocks++;
      const current = text.slice(from + startTag.length, to).replace(/^\n|\n$/g, "");
      const wanted = gen().replace(/^\n|\n$/g, "");
      if (current === wanted) continue;

      if (mode === "write") {
        text = `${text.slice(0, from + startTag.length)}\n${wanted}\n${text.slice(to)}`;
        writeFileSync(path, text);
        console.log(`  ${file}: block "${name}" regenerated`);
        continue;
      }
      problems++;
      console.error(`\n  ${file}: block "${name}" is STALE.`);
      const a = current.split("\n");
      const b = wanted.split("\n");
      const at = a.findIndex((l, i) => l !== b[i]);
      console.error(`    first difference at line ${at + 1} of the block:`);
      console.error(`      in the file:  ${a[at] ?? "(missing)"}`);
      console.error(`      generated:    ${b[at] ?? "(missing)"}`);
    }
  }

  if (mode === "write") {
    console.log(`generated-blocks: ${blocks} block(s) checked.`);
    process.exit(0);
  }
  if (problems === 0) {
    console.log(`generated-blocks: OK - ${blocks} block(s) match their generators.`);
    process.exit(0);
  }
  console.error("");
  console.error(
    `  ${problems} problem(s). Run \`pnpm blocks:write\` and read the diff before committing:`,
  );
  console.error(
    "  a changed number is either a real result or a regression, and the block cannot tell.",
  );
  process.exit(1);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
