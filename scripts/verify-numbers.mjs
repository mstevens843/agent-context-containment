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
// "declaring a send tool as read-only lets 32 of 32 attacks through" reads as prose and a block
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

/**
 * Like `run`, but REPORTS whether the command succeeded instead of throwing or swallowing it.
 *
 * Needed for the test count, which used `... || true` and therefore could not tell a green suite
 * from a red one. See the comment above `testRun`.
 */
const runStatus = (cmd) => {
  try {
    return {
      ok: true,
      out: execSync(cmd, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, CONTAINMENT_VERIFY_NUMBERS: "1" },
      }),
    };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

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

// THE TEST COUNT REFUSES TO GUESS, AND THE FIRST VERSION GUESSED SILENTLY IN THE WORST DIRECTION.
//
// It ran `pnpm -s test | grep -E 'Tests +[0-9]+ passed' || true` and summed the matches. Vitest
// prints `Tests  1 failed | 254 passed` when anything fails, which that pattern does NOT match, and
// `|| true` swallowed the non-zero exit. So a package with one failing test contributed ZERO, the
// total silently dropped by a whole package, and the script reported the DOCUMENTS as stale:
//
//   STALE  README.md   tests: the document says 622, `pnpm test` produces 367
//
// against a README that was right, because the suite was red. A checker that blames the prose when
// the code is broken is worse than no checker: it sends you to fix the wrong file, and it does it
// with a precise-looking number. This happened repeatedly during the v1.0.1 passes and was each time
// mistaken for a circular-dependency artefact. See DEFECTS_FOUND.md section 35.
//
// The rule the rest of this script already follows: a fact that cannot be computed LEAVES the list.
// It is never registered with a placeholder, and never registered with a number nobody stands behind.
const testRun = FAST ? { ok: true, out: "" } : runStatus("pnpm -s test 2>&1");
const testFailed =
  !FAST &&
  (!testRun.ok || /Tests\s+\d+\s+failed/.test(testRun.out) || /\bfailed\s*\|/.test(testRun.out));
const testTotal = testFailed
  ? -1
  : [...testRun.out.matchAll(/Tests\s+(\d+) passed/g)].reduce((n, m) => n + Number(m[1]), 0);
if (testFailed) {
  console.log("");
  console.log("  THE TEST SUITE IS NOT GREEN, so the `tests` fact is NOT REGISTERED for this run.");
  console.log(
    "  It is not stale documentation - it is a red suite, and counting passes from a red",
  );
  console.log(
    "  run under-reports by a whole package per failing file. Fix the suite, then re-run.",
  );
  console.log("");
}

// v1.0-rc: five more facts registered, chosen from the unregistered survey by which numbers a reader
// would act on. Each is COMPUTED here, never remembered, which is the only property that makes a
// registered fact different from the prose it replaces.
const holdoutCount = (cases[SPLITS.indexOf("holdout")] ?? []).length;

// The imported split's two halves, counted from the files upstream's rows are composed into. They
// are registered SEPARATELY from the total because a correct total can hide two wrong halves: both
// read (17) for a release while the total already said 62.
const importedHalf = (file) =>
  JSON.parse(readFileSync(join(ROOT, "corpus/imported", file), "utf8")).length;
const directHarmCount = importedHalf("injecagent.json");
const dataStealingCount = importedHalf("injecagent_ds.json");

const examplesCount = ["examples", "examples/agents"].reduce(
  (n, dir) => n + readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".ts")).length,
  0,
);

// The gates in CI's `claim-gates` job. `claimregistry.test.ts` separately asserts WHICH gates are
// present; this only counts them.
//
// COUNTED FROM THE JOB, NOT FROM AN ALLOWLIST. The first version matched an alternation of gate
// names written out here, which meant the count only moved when somebody remembered to edit it: a
// gate was added to the workflow and this silently went on reporting the old number, so the fact
// was under-counting the thing it exists to describe. Same failure as the mis-declaration pattern
// whose denominator was a literal, and the same fix - read the artifact, do not restate it.
//
// `install` and `build` are setup, not gates. Everything else the job runs is a claim gate by
// construction, so a new one is counted the day it is added.
const ciYaml = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const claimGatesJob = ciYaml.slice(
  ciYaml.indexOf("  claim-gates:"),
  ciYaml.indexOf("  # The git-object freeze"),
);
const ciGates =
  [...claimGatesJob.matchAll(/^\s*- run: pnpm ([\w:-]+)/gm)]
    .map((m) => m[1])
    .filter((name) => name !== "install" && name !== "build").length +
  (ciYaml.includes("corpus/holdout/MANIFEST.sha256") ? 1 : 0);

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
// ---- four more facts read out of the same report ------------------------------------------------
//
// Each was an UNREGISTERED number in `README.md` - reported by the survey, enforced only by the
// ratchet's total. They are the highest-value ones left there: every one is computed by a command
// that already runs, and every one is quoted as a headline. `648 generated variants`, `all 400 policy
// cells`, and the `tuning` split size are the three figures the README leans on hardest after the
// corpus total. Registering a number that a command already prints costs nothing and removes it from
// the pile the ratchet is merely counting. See DEFECTS_FOUND.md section 39.
//
// PARSED WITH A REFUSAL, like the silent-attack table below: a fact this script cannot compute must
// stop the run, not register -1 and flag every correct sentence as stale.
const splitSize = (name) =>
  Number(new RegExp(String.raw`^\s+${name}\s+(\d+)\s`, "m").exec(reportOut)?.[1] ?? -1);
const generatedCount = splitSize("generated");
const tuningCount = splitSize("tuning");
const surfaceCells = Number(/cells on the surface\s+(\d+)/.exec(reportOut)?.[1] ?? -1);
// SUMMED FROM THE ROWS, not read from a total line, because the report prints no total - and a
// hand-typed 48 next to six rows of 8 is exactly the kind of arithmetic that goes stale silently.
const plannerOut = run("node scripts/planner-report.mjs");
const plannerRows = [...plannerOut.matchAll(/^\s{2}(\w+)\s+(\d+)\s+\d+\/\d+/gm)];
const plannerRuns = plannerRows.reduce((n, m) => n + Number(m[2]), 0);

// Three more the report already computes and no pattern reached: the hand-authored provenance count,
// the release-valve cell count, and the agent-run scenario count. Each is quoted as a headline in a
// release-facing document. See DEFECTS_FOUND.md section 40.
const originalCount = Number(/^\s+original\s+(\d+)\s/m.exec(reportOut)?.[1] ?? -1);
const valveCells = Number(
  /RELEASE VALVES \(by design\):\s*(\d+)\s+cells/.exec(reportOut)?.[1] ?? -1,
);
// COUNTED FROM THE ROWS. The report names the scenarios and prints no total, and
// `docs/LIMITATIONS.md` row 11 types the 5 by hand.
const runRows = [
  ...reportOut.matchAll(/^ {2}([a-z][\w-]+)\s+\d+\s+\d+\s+\d+\s+\d+\s+(?:yes|no)\s*$/gm),
];
const agentScenarios = runRows.length;

for (const [id, v] of [
  ["generated variants", generatedCount],
  ["tuning cases", tuningCount],
  ["policy surface cells", surfaceCells],
  ["generated agent runs", plannerRuns > 0 ? plannerRuns : -1],
  ["hand-authored cases", originalCount],
  ["release-valve cells", valveCells],
  ["agent-run scenarios", agentScenarios > 0 ? agentScenarios : -1],
]) {
  if (v < 0) {
    console.error(`verify-numbers: could not read \`${id}\` from \`pnpm report\`.`);
    console.error("  The report's wording moved. Fix the parse rather than shipping a -1.");
    process.exit(2);
  }
}

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

// The mutation count was UNREGISTERED and stated in four places, so it went stale the moment an
// entry was added and nothing said so. Counted from the script's own `MUTATIONS` array, the same
// text `claimregistry.test.ts` greps to bind claims to mutation ids.
const mutationCount = (
  readFileSync(join(ROOT, "scripts/audit-mutations.mjs"), "utf8").match(/^ {4}id: "/gm) ?? []
).length;

const mapping = run("node scripts/mapping-report.mjs");
const understated = [...mapping.matchAll(/Permitted when the tool is UNDERSTATED\s+(\d+)\/(\d+)/g)];
const dhBroken = Number(understated[0]?.[1] ?? -1);
const dsBroken = Number(understated[1]?.[1] ?? -1);
// The split sizes, so a pattern can never disagree with the corpus about how many rows there are.
const dhTotal = Number(understated[0]?.[2] ?? -1);
const dsTotal = Number(understated[1]?.[2] ?? -1);

// THE ROBUST HALF, WHICH WAS NOT REGISTERED AT ALL.
//
// The mis-declaration numbers above have been checked since section 30. Their COUNTERPART - how many
// imported cases are refused under every capability mapping a peer could defend - was never a fact,
// so `docs/LIMITATIONS.md` row 2 went on publishing **6/6 robust** and `STATUS.md` **6/6 robust, 4/6
// broken** long after the split grew to 30 and 32. Both passed every gate. The two halves of one
// report were being held to different standards: one computed and checked, the other typed and
// trusted. See DEFECTS_FOUND.md section 38.
const robust = [...mapping.matchAll(/ROBUST to peer mappings\s+(\d+)\/(\d+)/g)];
const dhRobust = Number(robust[0]?.[1] ?? -1);
const dsRobust = Number(robust[1]?.[1] ?? -1);

// REFUSE TO RUN RATHER THAN REPORT -1 AS A FACT. A regex that stops matching its report yields -1,
// which no document states, so every sentence about it reads as stale and the real cause is buried
// under the noise. That is section 16's shape: a check that cannot fire correctly. Same reasoning as
// the `--fast` rule that a fact which cannot be computed LEAVES the list - but these can always be
// computed when the report runs, so a -1 here means the report's format moved.
for (const [id, v] of [
  ["direct-harm robust", dhRobust],
  ["data-stealing robust", dsRobust],
  ["direct-harm mis-declaration", dhBroken],
  ["data-stealing mis-declaration", dsBroken],
]) {
  if (v < 0) {
    console.error(`  ${id} could not be read from \`pnpm report:mapping\`.`);
    console.error("    The report's wording moved and this pattern silently stopped matching.");
    console.error(
      "    Fix the pattern in scripts/verify-numbers.mjs - do not leave it reporting -1.",
    );
    process.exit(1);
  }
}

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
    // `[*\s]*` between the fraction and the noun, for the same reason the mis-declaration patterns
    // needed it: the documents write `**62/62** rebuild byte-identically` and a pattern demanding a
    // plain space matched none of them. Three statements sat unregistered at a stale 34/34 through a
    // release pass because of exactly this.
    //
    // The last two anchor TABLE CELLS - the release checklist row and the FINAL bolded cell of
    // STATUS.md's history row. Earlier columns in that row are version history and cannot drift.
    patterns: [
      /\b(\d+)\/\d+[*\s]+(?:rebuild|byte-identical)/gi,
      /\b(\d+)\s+imported cases rebuild byte-identically/gi,
      /\b(\d+)\s+of\s+\d+\s+cases are upstream bytes/gi,
      /\b(\d+)\s+`?imported`?\s*\(upstream/gi,
      /`pnpm import:check`[^|\n]*\|\s*\*{0,2}(\d+)\/\d+/gi,
      /\|\s*imports rebuilt from committed source\s*\|(?:[^|\n]*\|)*[^|\n]*?\*\*(\d+)\/\d+\*\*/gi,
      /\|\s*`imported`\s*\((\d+)\)\s*\|/gi,
      /\*\*(\d+)\s+`imported`\*\*/gi,
      // `| exact imports, 62 cases |` in the Checks table, and `**Exact upstream content** | 62
      // cases, corpus/imported/`. Both sat at a stale 34 for three releases: the fact was registered
      // the whole time, and neither PHRASING was. A fact only checks the sentences its patterns
      // reach. See DEFECTS_FOUND.md section 40.
      /\bexact imports,\s*(\d+)\s+cases?\b/gi,
      /\|\s*\*\*Exact upstream content\*\*\s*\|\s*(\d+)\s+cases?\b/gi,
    ],
  },
  {
    id: "corpus cases",
    value: total,
    source: "pnpm report",
    // The third pattern anchors the FINAL bolded cell of STATUS.md's history row. That cell held a
    // stale value through a whole release pass because neither prose pattern reaches into a table,
    // and an unregistered number in a release-facing document is a number nobody is checking.
    // Earlier columns are version history and deliberately out of scope: they cannot drift.
    patterns: [
      // `[*\s]+`, NOT `\s+`. STATUS.md writes this cell as `**130** hand-written and imported`, and a
      // pattern demanding a plain space matched none of it - so that cell sat at a stale 98 for two
      // releases, in the table headed "Counted, not remembered". Same widening the imported-cases and
      // mis-declaration patterns already needed, for the same reason. See DEFECTS_FOUND.md section 38.
      /\b(\d+)[*\s]+hand-written and imported/gi,
      /corpus is\s+(\d+)\s+hand-written/gi,
      /\|\s*hand-authored \+ imported corpus\s*\|(?:[^|\n]*\|)*[^|\n]*?\*\*(\d+)\*\*[^|\n]*\|/gi,
      /\b(\d+)-case corpus\b/gi,
      // Not followed by a percent sign: STATUS.md quotes an old line reading "the corpus is 100%\n      // author-written", and a rule that fires on ordinary English gets suppressed - see the `shows`
      // lesson in claims.test.ts.
      /\bThe corpus is\s+(\d+)(?![%\d])/gi,
    ],
  },
  {
    id: "direct-harm imported",
    value: directHarmCount,
    source: "corpus/imported/injecagent.json",
    // Parenthesised, and the noun comes BEFORE the number - deliberately a different shape from the
    // mis-declaration patterns, which read `N of 30 direct-harm`. Two facts about the same split
    // sharing one sentence shape is how section 30 ended up reporting the wrong one as stale.
    patterns: [/direct[- ]harm[*\s]*\((\d+)\)/gi],
  },
  {
    id: "data-stealing imported",
    value: dataStealingCount,
    source: "corpus/imported/injecagent_ds.json",
    patterns: [/data[- ]stealing[*\s]*\((\d+)\)/gi],
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
      // The freeze section states the size three times in prose and none of it was registered.
      /\b(\d+)\s+cases\.\s+No case (?:was )?added, removed or altered/gi,
      /\|\s*v0 holdout content changed\?\s*\|\s*\*\*No\.\*\*\s*(\d+)\s+cases/gi,
      /altered after the holdout was written:\s*(\d+)\s+cases/gi,
    ],
  },
  {
    id: "holdout manifest files",
    value: Number(run("wc -l < corpus/holdout/MANIFEST.sha256").trim()),
    source: "corpus/holdout/MANIFEST.sha256",
    patterns: [
      /\b(\d+)\/\d+\*{0,2}\s+against the frozen manifest/gi,
      /\b(\d+)\/\d+,\s*gated in CI/gi,
      /SHA-256 per file,\s*(\d+)\/\d+\s+verifying/gi,
    ],
  },
  {
    id: "silent attacks total",
    value: silentTotal,
    source: "pnpm report",
    // THE DENOMINATOR, AND IT NEEDED ITS OWN PHRASING. `packages/classifier/README.md` stated the
    // classifier's score as `0 of 34` - stale, the corpus now holds 99 - and rewriting it as `0/99`
    // made the CONTAINMENT pattern below read the 0 as its own value. Two facts about one table
    // sharing a sentence shape, which is section 30's collision for the third time. This pattern
    // demands `N silent attacks in the corpus` and the containment ones demand a fraction, so
    // neither can read the other's sentence. See DEFECTS_FOUND.md section 40.
    patterns: [/\b(\d+)\s+silent attacks in the corpus\b/gi],
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
    id: "mutation entries",
    value: mutationCount,
    source: "scripts/audit-mutations.mjs",
    patterns: [
      /\b(\d+)\s+critical branches\b/gi,
      /\bPROVEN, for (\d+) listed branches\b/gi,
      /\breports (\d+)\/\d+ caught\b/gi,
      /\*\*(\d+)\/\d+ caught\*\*/gi,
    ],
  },
  {
    id: "registry claims",
    value: claimCount,
    source: "docs/claims.json",
    patterns: [
      /\b(\d+)\s+headline claims\b/gi,
      /\bregistry claims?\s*[:\u2014-]\s*\*{0,2}(\d+)/gi,
      // `docs/claims.json holds the 27 a reader would quote` - stale at 20 for four releases.
      /`docs\/claims\.json`\s+holds the\s+(\d+)\b/gi,
    ],
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
    id: "hand-authored cases",
    value: originalCount,
    source: "pnpm report",
    patterns: [
      /\*\*(\d+)\s+`original`\*\*/gi,
      /\|\s*\*\*Everything else\*\*\s*\|\s*(\d+)\s+cases,\s*mine/gi,
    ],
  },
  {
    id: "release-valve cells",
    value: valveCells,
    source: "pnpm report",
    patterns: [/\b(\d+)\s+admit it into a \*?payload\*?/gi],
  },
  {
    id: "agent-run scenarios",
    value: agentScenarios,
    source: "pnpm report",
    patterns: [/\b(\d+)\s+multi-step scenarios\b/gi],
  },
  {
    id: "generated variants",
    value: generatedCount,
    source: "pnpm report",
    // The README states this three times - as a split row, as a headline, and in the limitations
    // paragraph - and it was unregistered in all three.
    patterns: [
      // `[*\s]+` on BOTH sides of `generated`: STATUS.md writes `**648 generated** variants`, so the
      // bold closes between the noun and `variants` and a plain space matched nothing.
      /\b(\d+)[*\s]+generated[*\s]+(?:laundering[*\s]+)?variants/gi,
      /\|\s*`generated`\s*\((\d+)\)\s*\|/gi,
    ],
  },
  {
    id: "tuning cases",
    value: tuningCount,
    source: "pnpm report",
    patterns: [/\|\s*`tuning`\s*\((\d+)\)\s*\|/gi],
  },
  {
    id: "policy surface cells",
    value: surfaceCells,
    source: "pnpm report",
    // `All 400 policy cells probed` and `0 of 400 policy cells` - the denominator in both.
    patterns: [/(?:All|of)[*\s]+(\d+)[*\s]+policy cells/gi],
  },
  {
    id: "generated agent runs",
    value: plannerRuns,
    source: "pnpm report:planner",
    patterns: [/\b(\d+)[*\s]+generated agent runs/gi],
  },
  {
    // DISJOINT FROM ITS MIS-DECLARATION COUNTERPART, BY CONSTRUCTION.
    //
    // Both facts describe the same split and both are written as `N/30`, so a document naturally
    // states them in ONE sentence: "30/30 direct-harm robust; 21 of 30 broken". The first pattern
    // written here matched the robust fraction AND the broken one, reported 21 against a value of 30,
    // and named the sentence that had just been corrected as the stale one. That is section 30's
    // collision exactly - two facts about one split sharing a sentence shape.
    //
    // So: the robust patterns require the literal word `robust` AFTER the noun, and the
    // mis-declaration patterns carry a negative lookahead refusing it. Neither can match the other's
    // sentence, and the documents must write the fraction the way the pattern reads.
    id: "direct-harm robust",
    value: dhRobust,
    source: "pnpm report:mapping",
    // DENOMINATOR READ FROM THE DATA, like its mis-declaration counterpart, so the pattern cannot
    // rot when the split grows - which is exactly how the `6/6 robust` sentence survived: a pattern
    // that named a literal 6 would have stopped matching, and there was no pattern at all.
    //
    // `robust` must appear within a few words of the fraction. Without that the pattern would match
    // every `30/30` in the tree, and a fact that matches a different fact is worse than no fact.
    patterns: [new RegExp(String.raw`\b(\d+)\s*/\s*${dhTotal}\s+direct-harm\s+robust`, "gi")],
  },
  {
    id: "data-stealing robust",
    value: dsRobust,
    source: "pnpm report:mapping",
    patterns: [new RegExp(String.raw`\b(\d+)\s*/\s*${dsTotal}\s+data-stealing\s+robust`, "gi")],
  },
  {
    id: "direct-harm mis-declaration",
    value: dhBroken,
    source: "pnpm report:mapping",
    // `[*\s]+` between the number and the noun: the docs write this as `**21 of 30** direct-harm`,
    // and a pattern that required a plain space matched none of them. Two deliberately-broken values
    // passed before this was widened.
    //
    // THE DENOMINATOR IS READ FROM THE DATA, NOT TYPED. It used to be the literal `17`, and when the
    // imported split grew to every row in the pinned fixture that pattern stopped matching any
    // current-state sentence - it would have gone on matching only the HISTORICAL quotation in
    // DEFECTS_FOUND.md §18 and reported that as the stale one. A fact whose pattern silently stops
    // matching is a fact nobody is checking, which is §16 exactly. Computed, it cannot rot.
    patterns: [
      new RegExp(
        String.raw`\b(\d+)[*\s]*(?:of|/)[*\s]*${dhTotal}[*\s]+direct-harm(?![\s-]*robust)`,
        "gi",
      ),
      // `**21/30** on the direct-harm split` and `**21/30 against 32/32**` - the noun comes AFTER
      // the fraction in both, so the pattern above could not reach either, and both are
      // current-state claims about the largest hole in the model. See DEFECTS_FOUND.md section 40.
      new RegExp(String.raw`\b(\d+)/${dhTotal}\*{0,2}\s+on the direct-harm split`, "gi"),
      new RegExp(String.raw`\b(\d+)/${dhTotal}\s+against\s+\d+/${dsTotal}`, "gi"),
    ],
  },
  {
    id: "data-stealing mis-declaration",
    value: dsBroken,
    source: "pnpm report:mapping",
    patterns: [
      new RegExp(
        String.raw`\b(\d+)[*\s]*(?:of|/)[*\s]*${dsTotal}[*\s]+(?:imported[*\s]+)?data-stealing(?![\s-]*robust)`,
        "gi",
      ),
    ],
  },
];

// In `--fast` mode the tests fact was never computed, so it must not be checked - a fact registered
// with a value of 0 would flag every correct statement as stale, which is the -1 mistake one level on.
const FACTS = ALL_FACTS.filter((f) => !((FAST || testFailed) && f.id === "tests"));

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

// A REGISTERED FACT THAT MATCHES NO LIVE SENTENCE PROTECTS NOTHING.
//
// Two facts sat in this list passing their negative controls - a deliberately wrong number in a
// throwaway document IS caught, because the PATTERN works - while matching zero sentences in any
// real document. The control proved the pattern could fire; nothing proved it fires on anything
// that ships. That is the section 16 shape at the level of a single fact.
//
// A fact may opt out with `computedOnly: true`, which says "computed for the report, not to guard
// prose". Everything else must be guarding a sentence somebody could get wrong.
const factCoverage = ALL_FACTS.map((f) => {
  let hits = 0;
  for (const file of docs) {
    const rel = file.startsWith(ROOT) ? file.slice(ROOT.length - 1) : file;
    if (!RELEASE_FACING.some((r) => rel.endsWith(r))) continue;
    const text = readFileSync(file, "utf8");
    for (const pt of f.patterns) hits += [...text.matchAll(new RegExp(pt.source, pt.flags))].length;
  }
  return { id: f.id, hits, computedOnly: f.computedOnly === true };
});
// A phantom fact, for the control that proves the check above can fire. Same reasoning as the
// ceiling override: the alternative was a test that edits this file and restores it.
if (process.env.CONTAINMENT_PHANTOM_FACT === "1") {
  factCoverage.push({ id: "a fact nobody states", hits: 0, computedOnly: false });
}
const unguardingFacts = factCoverage.filter((f) => f.hits === 0 && !f.computedOnly);

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
// `--all` PRINTS THE WHOLE LIST, because a sample is unworkable for the one job this section
// creates: going through the pile and deciding, number by number, which are computable facts and
// which are noise. Doing that from a 12-line sample means running the script, editing one document,
// and running it again - and the previous pass resorted to copying this file elsewhere to see the
// rest. A report you have to defeat to read is a report nobody works from. See DEFECTS_FOUND.md §40.
const showAll = process.argv.includes("--all");
for (const u of showAll ? unregistered : unregistered.slice(0, 12))
  console.log(`    ${`${u.file}:${u.line}`.padEnd(32)} ${u.text}`);
if (!showAll && unregistered.length > 12)
  console.log(
    `    ... and ${unregistered.length - 12} more (\`node scripts/verify-numbers.mjs --all\`)`,
  );

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
// THE CEILING, AND A TEST HOOK THAT EXISTS SO THE TESTS DO NOT REWRITE THIS FILE.
//
// The ratchet's own tests need to run this script at other ceilings. The first version did that
// by editing this line in place and restoring it in a `finally` - which leaves the repository
// corrupted if the run is killed, and was observed leaving `MAX_UNREGISTERED = 9999` behind after
// an interrupted suite. A shipped script that its own tests rewrite is a shipped script one
// Ctrl-C away from lying. Same reasoning as `CONTAINMENT_EXTRA_DOC`, which exists so a test never
// writes into a real release document. See DEFECTS_FOUND.md section 37.
//
// CI does not set this. The literal below is what ships, and the meta-test in numbers.test.ts
// reads THIS LINE rather than the resolved value, so the override cannot raise the shipped bound.
const MAX_UNREGISTERED = Number(process.env.CONTAINMENT_MAX_UNREGISTERED ?? 51);
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

if (unguardingFacts.length > 0) {
  console.log("");
  console.log(
    `  ${unguardingFacts.length} REGISTERED FACT(S) MATCH NO SENTENCE IN ANY RELEASE-FACING DOCUMENT:`,
  );
  for (const f of unguardingFacts) console.log(`    ${f.id}`);
  console.log("");
  console.log("  Each of those passes its negative control and guards nothing that ships. Either");
  console.log("  write the sentence it should be checking, or mark the fact `computedOnly: true`");
  console.log("  to say plainly that it is for the report rather than for the prose.");
}

if (problems.length === 0 && !ratchetFailed && unguardingFacts.length === 0) {
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
