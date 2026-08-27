#!/usr/bin/env node
// Hand-typed numbers in prose, checked against what the code actually produces.
//
// WHY THIS EXISTS, and it is not a comfortable reason. `docs/claims.json` stated as one of its own
// rules: "A numeric claim must name the script that produces it. `pnpm audit:claims` re-runs that
// script and compares." **It did not re-run anything.** `audit:claims` checked that a claim NAMES a
// command; nothing ever ran the command or compared the number.
//
// Found by editing five load-bearing numbers to wrong values and watching `pnpm audit:docs` pass all
// five. That is the §17 shape once more: a rule describing a check that was never built.
//
// Generated BLOCKS solve this for tables. They cannot solve it for a number inside a sentence -
// "declaring a send tool as read-only lets 17 of 17 attacks through" reads as prose and a block
// marker mid-sentence would wreck it. So instead: compute the fact, then scan every document for a
// sentence stating a DIFFERENT value for that same fact.
//
//   pnpm verify:numbers
//
// WHAT IT CANNOT DO. It knows the handful of facts listed below. A number nobody registered here is
// still unchecked prose, and the honest response to that is the list being short and load-bearing
// rather than pretending to be complete.

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadSplit } from "../packages/conformance/dist/index.js";
import { scanDocument } from "./lib/numeric-noise.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

// Declared HERE, beside ROOT, because both the stale-number loop and the unregistered survey read
// it and the survey is defined further down the file. The first attempt declared it next to the
// release-facing list, below the stale loop, which put every run into a temporal-dead-zone
// ReferenceError - the script was broken for ALL invocations, not just the hooked ones.
const EXTRA_DOC = process.env.CONTAINMENT_EXTRA_DOC;
const SPLITS = ["holdout", "holdout_v2", "tuning", "derived", "adaptive", "imported"];

// RE-ENTRANCY GUARD. This script shells out to `pnpm test` to count tests, and the test suite
// contains tests that shell out to THIS SCRIPT to prove it can fail. Left alone that is unbounded
// recursion - it survived one pass only because turbo's cache happened to short-circuit the inner
// run, which is not a property to rely on. The marker is set on every child process; the tests that
// invoke this script skip themselves when they see it, so the outer run exercises them and the inner
// run does not. See DEFECTS_FOUND.md §21.
const run = (cmd) =>
  execSync(cmd, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, CONTAINMENT_VERIFY_NUMBERS: "1" },
  });

// ---- the facts, computed rather than remembered ------------------------------------------------
const cases = SPLITS.map((s) => loadSplit(`${ROOT}corpus/${s}`, s));
const total = cases.reduce((n, c) => n + c.length, 0);
const importedCount = (cases[SPLITS.indexOf("imported")] ?? []).length;

// `--fast` SKIPS THE TEST COUNT, AND ONLY THAT.
//
// Counting tests means running the whole suite, which makes this script slow and - worse - makes it
// unusable from inside a test. The tests that prove this script CAN FAIL are about the scanner and
// the ratchet, not about counting tests, so they pass `--fast` and the `tests` fact drops out of the
// registered list for that run. Every other fact is still computed and still checked.
//
// The alternative was a re-entrancy guard alone, which left two nested full-suite runs per test file
// and timed out. See DEFECTS_FOUND.md §21.
const FAST = process.argv.includes("--fast");
const testOutput = FAST ? "" : run("pnpm -s test 2>&1 | grep -E 'Tests +[0-9]+ passed' || true");
const testTotal = [...testOutput.matchAll(/Tests\s+(\d+) passed/g)].reduce(
  (n, m) => n + Number(m[1]),
  0,
);

// v1.0-rc: five more facts registered, chosen from the unregistered survey by which numbers a reader
// would act on. Each is COMPUTED here, never remembered, which is the only property that makes a
// registered fact different from the prose it replaces.
const holdoutCount = (cases[SPLITS.indexOf("holdout")] ?? []).length;

const examplesCount = ["examples", "examples/agents"].reduce(
  (n, dir) => n + readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".ts")).length,
  0,
);

// The gates in CI's `claim-gates` job. Counted from the workflow rather than from a list here, so
// the number and the thing it describes cannot drift apart. `claimregistry.test.ts` separately
// asserts WHICH gates are present; this only counts them.
const ciYaml = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const ciGates =
  [
    ...ciYaml.matchAll(
      /^\s*- run: pnpm (blocks:check|verify:numbers|audit:docs|audit:claims|audit:mutations|audit:release)$/gm,
    ),
  ].length + (ciYaml.includes("corpus/holdout/MANIFEST.sha256") ? 1 : 0);

// COUNTED FROM THE MARKERS, NOT FROM `blocks:check`. The first version shelled out to the checker
// and read its summary line - which meant this script CRASHED, rather than reporting, whenever a
// block was merely out of date. Worse, `repo-stats` counts the lines in `scripts/`, so editing THIS
// file invalidated that block and took the number checker down with it. A checker that fails when
// its neighbour is stale cannot be the thing that tells you a number is stale.
const blockCount = ["README.md", "STATUS.md", "corpus/imported/ATTRIBUTION.md"].reduce(
  (n, f) =>
    n + (readFileSync(join(ROOT, f), "utf8").match(/<!-- GENERATED:[a-z0-9-]+ -->/g) ?? []).length,
  0,
);

// The silent-attack total is a SUM over the per-split table `pnpm report` prints, not a line in it.
// Parsing it from the table is the point: a number derived from the same rows the reader sees cannot
// drift from them. The first version of this looked for a single "N of N" line, found nothing, and
// registered the fact as -1 - which would have flagged every CORRECT statement as stale. A fact that
// cannot compute is worse than no fact, so the sum is asserted non-zero below.
const reportOut = run("node scripts/report.mjs");
// Bounded to the table itself: from its header to the first blank line after the column titles.
// The first version sliced to end-of-output and summed 117 instead of 69 by walking into the tables
// that follow - a parse that produces a confident wrong number, which is worse than one that fails.
const silentStart = reportOut.indexOf("SILENT ATTACKS");
const afterHeader = reportOut.indexOf("classifier", silentStart);
const blockEnd = reportOut.indexOf("\n\n", afterHeader);
const silentBlock = reportOut.slice(afterHeader, blockEnd === -1 ? undefined : blockEnd);
const silentRows = [...silentBlock.matchAll(/^\s+\w+\s+\d+\s+(\d+)\/(\d+)\s/gm)];
const silentContained = silentRows.reduce((n, m) => n + Number(m[1]), 0);
const silentTotal = silentRows.reduce((n, m) => n + Number(m[2]), 0);
if (silentRows.length === 0 || silentContained === 0) {
  console.error(
    "verify-numbers: could not parse the SILENT ATTACKS table from `pnpm report`. Refusing to register a fact this script cannot compute - fix the parse rather than shipping a -1.",
  );
  process.exit(2);
}

const claimCount = JSON.parse(readFileSync(join(ROOT, "docs/claims.json"), "utf8")).claims.length;
const defectCount = (
  readFileSync(join(ROOT, "docs/DEFECTS_FOUND.md"), "utf8").match(/^## \d+\./gm) ?? []
).length;

const mapping = run("node scripts/mapping-report.mjs");
const understated = [...mapping.matchAll(/Permitted when the tool is UNDERSTATED\s+(\d+)\/(\d+)/g)];
const dhBroken = Number(understated[0]?.[1] ?? -1);
const dsBroken = Number(understated[1]?.[1] ?? -1);

// ONLY CURRENT-STATE PHRASINGS. A historical number cannot go stale: "deleting the branch left 74 of
// 74 tests passing" is a fact about a past state and stays true forever, as does a version-history
// column. The first version of this script flagged six of those and two real ones, and a checker
// whose findings are mostly noise gets ignored - which is how a stale number survives.
//
// So each pattern matches the way a CURRENT claim is written, and nothing else. The boundary is
// principled rather than a dodge: past-tense narrative is out of scope because it cannot drift.

/**
 * One fact, and the sentence shapes that state it.
 *
 * `pattern` must capture the number in group 1 and be specific enough that it cannot match a
 * different fact. A loose pattern here produces a confident wrong finding, which is worse than the
 * staleness it is chasing.
 */
const ALL_FACTS = [
  {
    id: "tests",
    value: testTotal,
    source: "pnpm test",
    // "N tests across five packages" - the current-state phrasing. NOT "left 74 of 74 tests
    // passing", which records what a past run did.
    // Three current-state phrasings, all of which have gone stale at least once:
    //   "472 tests across five packages"   - README's headline
    //   "| test | **PASS - 472** ..."      - STATUS's verification table
    //   "| tests | 263 | ... | **472** |"  - STATUS's version table, last cell only
    // The version-table pattern anchors on the FINAL bolded cell of a row whose label is `tests`,
    // because every earlier cell in that row is history and history cannot go stale. v1.0 found two
    // stale counts in STATUS.md that the single original pattern could not see. See §19.
    patterns: [
      /(?<!of\s)\b(\d+)\s+tests?\s+across\b/gi,
      /\|\s*tests?\s*\|\s*PASS[^|]*?\*\*(\d+)\*\*/gi,
      /\bPASS\s*[-\u2014\u2013]\s*\*?\*?(\d+)/gi,
      /\|\s*tests\s*\|(?:[^|\n]*\|)*[^|\n]*?\*\*(\d+)\*\*\s*\|/gi,
    ],
  },
  {
    id: "imported cases",
    value: importedCount,
    source: "pnpm import:check",
    patterns: [
      /\b(\d+)\/\d+\s+rebuild byte-identically/gi,
      /\b(\d+)\s+`?imported`?\s*\(upstream/gi,
    ],
  },
  {
    id: "corpus cases",
    value: total,
    source: "pnpm report",
    patterns: [/\b(\d+)\s+hand-written and imported/gi, /corpus is\s+(\d+)\s+hand-written/gi],
  },
  {
    id: "holdout cases",
    value: holdoutCount,
    source: "corpus/holdout",
    patterns: [
      /\bFrozen holdout,\s*(\d+)\s*cases?\b/gi,
      /\bThe\s+(\d+)\s+v0 holdout cases\b/gi,
      /\b(\d+)\s+holdout cases have not changed\b/gi,
      /\|\s*`holdout`\s*\((\d+)\)/gi,
    ],
  },
  {
    id: "holdout manifest files",
    value: Number(run("wc -l < corpus/holdout/MANIFEST.sha256").trim()),
    source: "corpus/holdout/MANIFEST.sha256",
    patterns: [/\b(\d+)\/\d+\s+against the frozen manifest/gi],
  },
  {
    id: "silent attacks contained",
    value: silentContained,
    source: "pnpm report",
    patterns: [
      /\b(\d+)\s+of\s+\d+\s+silent attacks are contained/gi,
      /\b(\d+)\/\d+\s+silent attacks\b/gi,
    ],
  },
  {
    id: "examples",
    value: examplesCount,
    source: "examples/*.ts + examples/agents/*.ts",
    patterns: [/\bexamples\s*[x\u00d7]\s*(\d+)/gi, /\b(\d+)\s+examples?\s+(?:run|pass)\b/gi],
  },
  {
    id: "CI claim gates",
    value: ciGates,
    source: ".github/workflows/ci.yml",
    patterns: [/\bCI (?:claim )?gates?\s*[:\u2014-]?\s*\*{0,2}(\d+)\*{0,2}/gi],
  },
  {
    id: "generated blocks",
    value: blockCount,
    source: "GENERATED markers in README/STATUS/ATTRIBUTION",
    patterns: [
      /\b(\d+)\s+generated blocks?\b/gi,
      /\bgenerated blocks?\s*[:\u2014-]\s*\*{0,2}(\d+)/gi,
    ],
  },
  {
    id: "registry claims",
    value: claimCount,
    source: "docs/claims.json",
    patterns: [/\b(\d+)\s+headline claims\b/gi, /\bregistry claims?\s*[:\u2014-]\s*\*{0,2}(\d+)/gi],
  },
  {
    id: "defects recorded",
    value: defectCount,
    source: "docs/DEFECTS_FOUND.md",
    patterns: [
      /\|\s*defects recorded\s*\|(?:[^|\n]*\|)*[^|\n]*?\*\*(\d+)[^|\n]*\|/gi,
      /\b(\d+)\s+defects? recorded\b/gi,
    ],
  },
  {
    id: "direct-harm mis-declaration",
    value: dhBroken,
    source: "pnpm report:mapping",
    // `[*\s]+` between the number and the noun: the docs write this as `**9 of 17** direct-harm`,
    // and a pattern that required a plain space matched none of them. Two deliberately-broken values
    // passed before this was widened.
    patterns: [/\b(\d+)[*\s]*(?:of|\/)[*\s]*17[*\s]+direct-harm/gi],
  },
  {
    id: "data-stealing mis-declaration",
    value: dsBroken,
    source: "pnpm report:mapping",
    patterns: [/\b(\d+)[*\s]*(?:of|\/)[*\s]*17[*\s]+(?:imported[*\s]+)?data-stealing/gi],
  },
];

// In `--fast` mode the tests fact was never computed, so it must not be checked - a fact registered
// with a value of 0 would flag every correct statement as stale, which is the -1 mistake one level on.
const FACTS = ALL_FACTS.filter((f) => !(FAST && f.id === "tests"));

// ---- scan every document -----------------------------------------------------------------------
const SKIP = new Set(["node_modules", ".git", "dist", ".turbo"]);
const docs = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    // `.md` AND the claim registry. docs/claims.json is the one document whose whole purpose is to
    // stop overstated claims, and until v1.0 it was the one document no number check could see: an
    // adversarial reviewer rewrote three claim texts to say "999 imported cases", "4 of 4 silent
    // attacks" and "the 500 v0 holdout cases", and every gate stayed green because this walker took
    // `.md` only. A registry that can hold a false number is decoration. See DEFECTS_FOUND.md §19.
    else if (name.endsWith(".md") || name === "claims.json") docs.push(p);
  }
};
walk(ROOT);

const problems = [];
let checked = 0;
// EXTRA_DOC joins this loop too. The first version added it only to the unregistered survey, so the
// negative control for a STALE registered number could not fire against it - a test hook that half
// works is the same defect as a check that half runs.
for (const file of [...docs, ...(EXTRA_DOC ? [EXTRA_DOC] : [])]) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const fact of FACTS) {
      for (const pattern of fact.patterns) {
        for (const m of line.matchAll(new RegExp(pattern.source, pattern.flags))) {
          checked++;
          const stated = Number(m[1]);
          if (stated !== fact.value) {
            problems.push({
              file: file.startsWith(ROOT) ? file.slice(ROOT.length) : file,
              line: i + 1,
              fact: fact.id,
              stated,
              actual: fact.value,
              source: fact.source,
              text: line.trim().slice(0, 110),
            });
          }
        }
      }
    }
  });
}

// ---- WHAT NOBODY REGISTERED ---------------------------------------------------------------------
//
// The check above is only as wide as `FACTS`. Every version of this script has said so in its own
// output - "a fact nobody registered here is unchecked prose" - which is honest and does nothing.
// This pass makes the unchecked set VISIBLE, because a limitation you can measure is a different
// thing from one you can only admit.
//
// REPORT MODE, NOT GATE MODE, AND ON PURPOSE. Numeric prose is dense with numbers that cannot go
// stale: version strings, defect section numbers, dates, ordinals, identifiers ending in a digit. A
// checker whose output is mostly noise gets ignored, and an ignored checker is how a stale number
// survives - which is exactly the failure this file exists to answer. So this counts and samples; it
// does not fail the build. Promoting it to a gate is a decision for when the exemption list has
// stopped growing, not before. See DEFECTS_FOUND.md §20.
// A TEST HOOK, AND WHY IT EXISTS RATHER THAN A TEST THAT EDITS README.
//
// The negative controls for this script have to make a release document wrong and watch the script
// fail. The first version did that literally - append a sentence to docs/ADOPTION_GUIDE.md, run,
// restore in `finally`. Two things went wrong at once: the script shells out to `pnpm test`, so each
// run re-entered the test, and when the machine died mid-run none of the 92 nested `finally` blocks
// ran. The repository was left with 92 copies of a fabricated sentence in a release document and a
// README claiming 99999 tests.
//
// A test that can corrupt the artifact it is checking is not a safe test, however careful its
// cleanup. So the scan list is extensible instead: the test writes a throwaway file in a temp
// directory and names it here. No release document is ever touched. See DEFECTS_FOUND.md §21.
const RELEASE_FACING = [
  "/README.md",
  "/STATUS.md",
  "/RELEASE_CHECKLIST.md",
  "/PUBLISHING.md",
  "/docs/TRUST_BOUNDARIES.md",
  "/docs/ADOPTION_GUIDE.md",
  "/docs/LIMITATIONS.md",
  "/docs/REPORT.md",
  "/docs/claims.json",
];

// The noise rules and the document walker live in scripts/lib/numeric-noise.mjs so they can be
// unit-tested without running this script, which shells out to `pnpm test`.

// ALL_FACTS, not FACTS. The survey asks "is this number registered anywhere", which is a property of
// the registry and not of how this run was invoked - using the mode-filtered list made `--fast`
// report 119 where a full run reported 112, so the ratchet ceiling depended on the flag.
const registeredPatterns = ALL_FACTS.flatMap((f) => f.patterns);
const unregistered = [];
for (const file of [...docs, ...(EXTRA_DOC ? [EXTRA_DOC] : [])]) {
  const rel = file.startsWith(ROOT) ? file.slice(ROOT.length - 1) : file;
  if (file !== EXTRA_DOC && !RELEASE_FACING.some((r) => rel.endsWith(r))) continue;
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (const hit of scanDocument(text)) {
    const line = lines[hit.line - 1] ?? "";
    // A line already carrying a registered fact is accounted for by the check above.
    if (registeredPatterns.some((pt) => new RegExp(pt.source, pt.flags).test(line))) continue;
    unregistered.push({ file: rel, line: hit.line, text: hit.text.slice(0, 100) });
  }
}

const rule = "=".repeat(96);
console.log(rule);
console.log("hand-typed numbers, checked against what the code produces");
console.log(rule);
console.log("");
for (const f of FACTS)
  console.log(`  ${f.id.padEnd(30)}${String(f.value).padStart(5)}   (${f.source})`);
console.log("");
console.log(`  ${checked} numeric statement(s) found across ${docs.length} document(s).`);
console.log("");
console.log(
  `  ${unregistered.length} UNREGISTERED numeric statement(s) across ${RELEASE_FACING.length} release-facing document(s).`,
);
console.log("  Reported, not enforced individually - but the TOTAL is a ratchet, see below.");
for (const u of unregistered.slice(0, 12))
  console.log(`    ${`${u.file}:${u.line}`.padEnd(32)} ${u.text}`);
if (unregistered.length > 12) console.log(`    ... and ${unregistered.length - 12} more`);

// ---- THE RATCHET --------------------------------------------------------------------------------
//
// WARN mode was the honest answer to "most numeric prose cannot go stale", and it was also a way of
// never having to act. This is the middle position, and it is the one worth defending: the 112
// statements that exist are reported and not enforced, because rewriting them all would be churn -
// but the count may not GROW. A new unregistered number in a release-facing document is a new
// unchecked claim, and that is exactly the thing every defect in this repository started as.
//
// Lowering this number is the maintenance task. Raising it requires deciding, in a diff somebody
// reviews, that a new hand-typed claim is worth it - which is the conversation that was never had
// for any of the 112.
const MAX_UNREGISTERED = 111;
let ratchetFailed = false;
if (unregistered.length > MAX_UNREGISTERED) {
  ratchetFailed = true;
  console.log("");
  console.log(
    `  RATCHET BROKEN: ${unregistered.length} unregistered statements, and the agreed ceiling is ${MAX_UNREGISTERED}.`,
  );
  console.log(
    "  A new hand-typed number entered a release-facing document without a check behind it.",
  );
  console.log("  Register it in FACTS, make it a generated block, or rewrite the sentence to not");
  console.log("  carry a number. Raising MAX_UNREGISTERED is the last resort, not the first.");
} else if (unregistered.length < MAX_UNREGISTERED) {
  console.log("");
  console.log(
    `  The ceiling is ${MAX_UNREGISTERED} and this run found ${unregistered.length}. Lower MAX_UNREGISTERED in`,
  );
  console.log("  scripts/verify-numbers.mjs to lock the improvement in.");
}

if (problems.length === 0 && !ratchetFailed) {
  console.log("  All of them agree with the code.");
  console.log("");
  console.log(
    "  WHAT THIS DOES NOT COVER: any number not in the list above. A fact nobody registered",
  );
  console.log("  here is unchecked prose, and the list being short and load-bearing is the honest");
  console.log("  version of that - not a claim of completeness.");
  console.log(rule);
  process.exit(0);
}

console.log("");
for (const p of problems) {
  console.log(`  STALE  ${p.file}:${p.line}`);
  console.log(
    `         ${p.fact}: the document says ${p.stated}, \`${p.source}\` produces ${p.actual}`,
  );
  console.log(`         ${p.text}`);
}
console.log("");
console.log(`  ${problems.length} stale number(s). Each is a claim nobody re-checked.`);
console.log(rule);
process.exit(1);
