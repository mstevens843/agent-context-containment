// The numeric-claim scanner, and the line it draws between a claim and a coincidence.
//
// `verify:numbers` checks a REGISTERED list. Everything outside that list was unchecked prose, and
// every version of the script admitted so in its own output - which is honest and does nothing. v1.0
// added a survey that counts the unchecked surface instead of merely conceding it.
//
// The survey runs in REPORT mode, not gate mode, and these tests are what make that defensible: a
// checker whose output is mostly noise gets ignored, and an ignored checker is how a stale number
// survives. So the noise rules are asserted here - both that they catch real claims and that they
// stay quiet on the shapes that cannot drift. See DEFECTS_FOUND.md §20.

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error - a plain .mjs script helper, deliberately not part of any package's build
// biome-ignore format: the ts-expect-error must apply to the module import line
import { parseSinglePackageTestCount, parseTestCountsForBlock } from "../../../scripts/generated-blocks.mjs";
// @ts-expect-error - a plain .mjs helper, deliberately not part of any package's build
import { numericClaims, scanDocument } from "../../../scripts/lib/numeric-noise.mjs";
// @ts-expect-error - a plain .mjs helper, deliberately not part of any package build
import { stripAnsi } from "../../../scripts/lib/strip-ansi.mjs";

const REPO = join(import.meta.dirname, "..", "..", "..");

// Tests that RUN `scripts/verify-numbers.mjs` must not run inside it. The script counts tests by
// shelling out to `pnpm test`, so without this guard each of them re-enters the script and the whole
// thing recurses. `describe.skipIf` rather than a silent early return, so a skipped run says so.
const REENTRANT = process.env.CONTAINMENT_VERIFY_NUMBERS === "1";

/**
 * The shipped ceiling, read from the LINE rather than from the resolved value.
 *
 * `MAX_UNREGISTERED` takes an environment override so that the ratchet's own tests do not have to
 * rewrite `scripts/verify-numbers.mjs` in place - see the block at the bottom of this file, and
 * DEFECTS_FOUND.md section 37. Matching the literal is what keeps that hook from being a bypass:
 * an override can change what a test run sees, never what ships.
 */
const CEILING_LINE =
  /const MAX_UNREGISTERED = Number\(process\.env\.CONTAINMENT_MAX_UNREGISTERED \?\? (\d+)\);/;

describe("the generated test-count block reads CI output honestly", () => {
  it("parses scoped Turbo package prefixes", () => {
    expect(
      parseTestCountsForBlock(
        [
          "@agent-context-containment/core:test:       Tests  266 passed (266)",
          "@agent-context-containment/conformance:test:       Tests  280 passed (280)",
          "@agent-context-containment/ledger:test:       Tests  89 passed (89)",
        ].join("\n"),
      ),
    ).toEqual([
      ["conformance", 280],
      ["core", 266],
      ["ledger", 89],
    ]);
  });

  it("parses the grouped output shape GitHub produced under execSync", () => {
    expect(
      parseTestCountsForBlock(
        [
          "> @agent-context-containment/core@0.1.0 test /home/runner/work/repo/repo/packages/core",
          "> vitest run",
          " Test Files  15 passed (15)",
          "      Tests  266 passed (266)",
          "> @agent-context-containment/conformance@0.1.0 test /home/runner/work/repo/repo/packages/conformance",
          "> vitest run",
          " Test Files  24 passed (24)",
          "      Tests  287 passed (287)",
        ].join("\n"),
      ),
    ).toEqual([
      ["conformance", 287],
      ["core", 266],
    ]);
  });

  it("parses one package's Vitest summary without relying on Turbo prefixes", () => {
    expect(
      parseSinglePackageTestCount(
        [" Test Files  24 passed (24)", "      Tests  287 passed (287)"].join("\n"),
        "conformance",
      ),
    ).toBe(287);
  });

  it("refuses a red suite instead of summing the packages that happened to pass", () => {
    expect(() =>
      parseTestCountsForBlock(
        [
          "@agent-context-containment/core:test:       Tests  1 failed | 265 passed (266)",
          "@agent-context-containment/ledger:test:       Tests  89 passed (89)",
        ].join("\n"),
      ),
    ).toThrow(/test was red/);
  });

  it("does not accept output with no per-package test summaries", () => {
    expect(() => parseTestCountsForBlock("Tasks: 5 successful, 5 total")).toThrow(
      /could not parse per-package test counts/,
    );
  });
});

describe("what the scanner counts as a numeric claim", () => {
  it("counts a bare count and an N-of-M pair", () => {
    expect(numericClaims("**503 tests across five packages.**").length).toBeGreaterThan(0);
    expect(numericClaims("attacks blocked 9/9 in the holdout").length).toBeGreaterThan(0);
    expect(numericClaims("17 of 17 data-stealing cases got through").length).toBeGreaterThan(0);
  });

  it("does not count a table ROW LABEL, but still counts a claim in a leading cell", () => {
    // The exemption and its limit, together. A leading cell that is entirely an integer is an index
    // - it is how the row is cited - and cannot drift. A leading cell that says something is still a
    // claim. Without the second half this exemption would be a hole shaped like a table.
    expect(numericClaims("| 14 | **A limitation.** Some prose about it. | Open |")).toHaveLength(0);
    expect(
      numericClaims(
        "| 12 | **Small corpus.** n=68 across five splits, 648 variants. | Structural |",
      ),
      "real numbers inside an exempted row stopped being counted",
    ).toEqual(expect.arrayContaining(["68", "648"]));
    expect(
      numericClaims("| 21 of 30 direct-harm | still a claim |").length,
      "a claim in a leading cell was swallowed by the row-label exemption",
    ).toBeGreaterThan(0);
  });

  it("does not count version strings", () => {
    // The single largest source of false positives, and the one that would have made the survey
    // useless: every heading in STATUS.md carries one.
    expect(numericClaims("## v0.4 -> v0.8")).toEqual([]);
    expect(numericClaims("released as 1.0.0-rc")).toEqual([]);
  });

  it("does not count defect references, years, or mutation ids", () => {
    expect(numericClaims("See DEFECTS_FOUND.md §19 and section 15")).toEqual([]);
    expect(numericClaims("recorded in 2026")).toEqual([]);
    expect(numericClaims("MUTATION P28 and M14 and A01")).toEqual([]);
  });

  it("does not count identifiers that merely end in a digit", () => {
    expect(numericClaims("a receipt for acct-1 in slot v[0] from r-1")).toEqual([]);
  });

  it("does not count anything inside inline code", () => {
    expect(numericClaims("run `shasum -a 256 -c MANIFEST.sha256` first")).toEqual([]);
  });

  it("skips fenced code blocks entirely", () => {
    // A code sample is not a release claim. If it were counted, every usage example in the README
    // would be reported as an unverified number.
    const doc = ["prose with no number", "```ts", "const n = 4096;", "```", "more prose"].join(
      "\n",
    );
    expect(scanDocument(doc)).toEqual([]);
  });

  it("skips generated blocks, which have a stronger check than this one", () => {
    // `blocks:check` regenerates each block from its generator and exits 1 on any difference.
    // Counting them here would report the best-protected numbers in the repository as unchecked.
    const doc = [
      "<!-- GENERATED:corpus-splits -->",
      "| holdout | 16 | 98 cases |",
      "<!-- /GENERATED -->",
    ].join("\n");
    expect(scanDocument(doc)).toEqual([]);
  });

  it("still reports a real claim sitting next to all of that", () => {
    // The near-miss for the whole exemption list: a rule set tuned until it reports nothing would
    // pass every test above.
    const doc = ["## v1.0 released 2026", "The corpus covers 98 cases across seven splits."].join(
      "\n",
    );
    const found = scanDocument(doc);
    expect(found.length, "the scanner was tuned until it sees nothing").toBe(1);
    expect(found[0]?.claims).toContain("98");
  });
});

describe("verify:numbers can fail, proven without touching a release document", () => {
  // THE CONTROLS THAT NEARLY BROKE THE REPOSITORY. The first version of this block appended a
  // fabricated sentence to docs/ADOPTION_GUIDE.md and rewrote README's test count, restoring both in
  // `finally`. The script counts tests by shelling out to `pnpm test`, so every run re-entered these
  // tests; when the machine died mid-run, none of the 92 nested `finally` blocks executed and the
  // repository was left with 92 copies of the fabricated sentence and a README claiming 99999 tests.
  //
  // Two fixes, both structural rather than careful:
  //   `--fast`  skips the `pnpm test` count, so the script cannot re-enter the suite at all.
  //   `CONTAINMENT_EXTRA_DOC`  adds ONE throwaway file to the scan, so the negative control writes
  //                            to a temp directory and no release document is ever modified.
  //
  // See DEFECTS_FOUND.md §21.

  const runFast = (extra?: string): { readonly failed: boolean; readonly out: string } => {
    try {
      const out = execFileSync("node", ["scripts/verify-numbers.mjs", "--fast"], {
        cwd: REPO,
        encoding: "utf8",
        env: { ...process.env, ...(extra !== undefined ? { CONTAINMENT_EXTRA_DOC: extra } : {}) },
      });
      return { failed: false, out };
    } catch (e) {
      return { failed: true, out: String((e as { stdout?: string }).stdout ?? "") };
    }
  };

  it("a stale registered number fails, and names the file and both values", () => {
    const doc = join(tmpdir(), "acc-stale-number.md");
    // `130 hand-written and imported` is a registered fact. State it wrong.
    writeFileSync(doc, "The corpus is 4242 hand-written and imported cases.\n");
    try {
      const { failed, out } = runFast(doc);
      expect(failed, "a wrong registered number did not fail the check").toBe(true);
      expect(out).toContain("STALE");
      expect(out).toContain("4242");
      expect(out).toContain("acc-stale-number.md");
    } finally {
      rmSync(doc, { force: true });
    }
  });

  it("a correct registered number does not fail", () => {
    // The near-miss. A checker that failed on every document would pass the test above.
    const doc = join(tmpdir(), "acc-fresh-number.md");
    writeFileSync(doc, "The corpus is 130 hand-written and imported cases.\n");
    try {
      const { failed, out } = runFast(doc);
      expect(failed, `a CORRECT registered number was reported stale:\n${out}`).toBe(false);
    } finally {
      rmSync(doc, { force: true });
    }
  });

  // ---- the robust half of the mapping report -----------------------------------------------------
  //
  // WHY THIS PAIR EXISTS. `pnpm report:mapping` states two things about each imported split: how many
  // cases are robust to a peer's capability mapping, and how many break when the tool is understated.
  // The BROKEN half has been a registered fact since section 30. The ROBUST half was registered
  // nowhere, so `docs/LIMITATIONS.md` published **6/6 robust** and `STATUS.md` **6/6 robust, 4/6
  // broken** for three releases after the split grew to 30 and 32 - through every gate, every pass.
  // Half of one report was computed and checked; the other half was typed and trusted.
  //
  // These two tests are the control that half now has. See DEFECTS_FOUND.md section 38.

  it("a wrong robust number is caught, and named", () => {
    const doc = join(tmpdir(), "acc-robust-wrong.md");
    writeFileSync(doc, "Peer mappings leave 6/30 direct-harm robust on that split.\n");
    try {
      const { failed, out } = runFast(doc);
      expect(failed, `a wrong robust fraction passed:\n${out}`).toBe(true);
      // THE STALE LINE, not the fact's name. Asserting the name alone passes when the pattern is
      // EMPTY: the sentence then goes unregistered, the ratchet breaks, `failed` is true anyway, and
      // the fact still appears in the survey table above. Watched: with both robust patterns removed
      // this test stayed green. Only the staleness report can produce the sentence below.
      expect(out).toContain("STALE");
      expect(out).toContain("direct-harm robust: the document says 6");
    } finally {
      rmSync(doc, { force: true });
    }
  });

  it("a wrong data-stealing robust number is caught, and named", () => {
    const doc = join(tmpdir(), "acc-robust-ds-wrong.md");
    writeFileSync(doc, "Peer mappings leave 6/32 data-stealing robust on that split.\n");
    try {
      const { failed, out } = runFast(doc);
      expect(failed, `a wrong data-stealing robust fraction passed:\n${out}`).toBe(true);
      expect(out).toContain("STALE");
      expect(out).toContain("data-stealing robust: the document says 6");
    } finally {
      rmSync(doc, { force: true });
    }
  });

  it("the CORRECT robust numbers do not fail, so the two above mean something", () => {
    // The near-miss: a pattern that flagged every robust sentence would pass both tests above.
    const doc = join(tmpdir(), "acc-robust-right.md");
    writeFileSync(
      doc,
      "Peer mappings leave 30/30 direct-harm robust and 32/32 data-stealing robust.\n",
    );
    try {
      const { failed, out } = runFast(doc);
      expect(failed, `the CORRECT robust fractions were reported stale:\n${out}`).toBe(false);
    } finally {
      rmSync(doc, { force: true });
    }
  });

  it("the robust and mis-declaration facts do not read each other's sentence", () => {
    // THE COLLISION THIS PAIR NEARLY SHIPPED WITH. Both facts describe one split and both are written
    // `N/30`, so a document states them in one sentence. The first robust pattern matched the broken
    // fraction too, reported 21 against a value of 30, and named the sentence that had just been
    // CORRECTED as the stale one - section 30's failure, reproduced while fixing its sibling.
    const doc = join(tmpdir(), "acc-robust-both.md");
    writeFileSync(
      doc,
      "30/30 direct-harm robust and 32/32 data-stealing robust, with 21 of 30 direct-harm and " +
        "32 of 32 data-stealing broken by an understated tool.\n",
    );
    try {
      const { failed, out } = runFast(doc);
      expect(failed, `both facts in one sentence were misread:\n${out}`).toBe(false);
    } finally {
      rmSync(doc, { force: true });
    }
  });

  // ---- the four facts registered in section 39 -----------------------------------------------------
  //
  // Each was an unregistered README headline, enforced only by the ratchet's total. A fact with no
  // control is a pattern nobody has watched fire, which is section 16's shape - so each gets one, and
  // a shared near-miss proves the four together do not simply flag every document.
  const REGISTERED = [
    [
      "generated variants",
      "The suite builds 999 generated laundering variants at run time.",
      "648 generated laundering variants",
    ],
    ["tuning cases", "| `tuning` (999) | freely editable |", "| `tuning` (29) | freely editable |"],
    [
      "policy surface cells",
      "All 999 policy cells were probed.",
      "All 400 policy cells were probed.",
    ],
    [
      "generated agent runs",
      "It reports 999 generated agent runs.",
      "It reports 48 generated agent runs.",
    ],
    // Section 40's four. `silent attacks total` needed its OWN phrasing: stating the classifier's
    // score as `0/99` made the `silent attacks contained` pattern read that 0 as its value - two
    // facts about one table sharing a sentence shape, section 30's collision for the third time. The
    // near-miss below states every one of these in a single document and requires a clean run, which
    // is exactly what catches that.
    [
      "silent attacks total",
      "There are 999 silent attacks in the corpus.",
      "There are 99 silent attacks in the corpus.",
    ],
    [
      "hand-authored cases",
      "| **Everything else** | 999 cases, mine |",
      "| **Everything else** | 59 cases, mine |",
    ],
    [
      "release-valve cells",
      "999 admit it into a payload or selector.",
      "40 admit it into a payload or selector.",
    ],
    [
      "agent-run scenarios",
      "There are 999 multi-step scenarios.",
      "There are 5 multi-step scenarios.",
    ],
  ] as const;

  for (const [id, wrong] of REGISTERED) {
    it(`a wrong \`${id}\` is caught, and named`, () => {
      const doc = join(tmpdir(), `acc-${id.replace(/\W+/g, "-")}.md`);
      writeFileSync(doc, `${wrong}\n`);
      try {
        const { failed, out } = runFast(doc);
        expect(failed, `a wrong ${id} passed:\n${out}`).toBe(true);
        // THE STALE LINE AND THE VALUE, not the fact's name: the name alone appears in the survey
        // table on every run, so asserting it passes even against an empty pattern. That exact
        // weakness shipped in the robust controls above and is recorded in section 38.
        expect(out).toContain("STALE");
        expect(out).toContain(`${id}: the document says 999`);
      } finally {
        rmSync(doc, { force: true });
      }
    });
  }

  it("and the CORRECT values for all four do not fail, so the four above mean something", () => {
    // The shared near-miss. Four checkers that flagged every document would pass every test above.
    const doc = join(tmpdir(), "acc-registered-right.md");
    writeFileSync(doc, `${REGISTERED.map(([, , right]) => right).join("\n\n")}\n`);
    try {
      const { failed, out } = runFast(doc);
      expect(failed, `the CORRECT values were reported stale:\n${out}`).toBe(false);
    } finally {
      rmSync(doc, { force: true });
    }
  });

  it("an unregistered headline number appears in the report and breaks the ratchet", () => {
    const doc = join(tmpdir(), "acc-unregistered.md");
    writeFileSync(doc, "The adapter was checked against 87 separate deployment shapes.\n");
    try {
      const { failed, out } = runFast(doc);
      expect(failed, "a new unregistered number did not break the ratchet").toBe(true);
      expect(out).toContain("RATCHET BROKEN");
    } finally {
      rmSync(doc, { force: true });
    }
  });

  it("exempted version and code numbers create no noise", () => {
    // The other half of the ratchet's credibility: if version strings, code fences and defect
    // references counted, the ceiling would move on every commit and the check would be turned off.
    const doc = join(tmpdir(), "acc-exempt.md");
    writeFileSync(
      doc,
      [
        "## v0.9 -> v1.0, released 2026",
        "See DEFECTS_FOUND.md §19 and section 15. MUTATION P28 and A01.",
        "Run `shasum -a 256 -c MANIFEST.sha256` first.",
        "```ts",
        "const n = 4096;",
        "```",
        "<!-- GENERATED:corpus-splits -->",
        "| holdout | 16 | 98 cases |",
        "<!-- /GENERATED -->",
      ].join("\n"),
    );
    try {
      const { failed, out } = runFast(doc);
      expect(failed, `exempted shapes broke the check:\n${out}`).toBe(false);
      // Read the ceiling from the script rather than repeating it here. A hand-typed number in the
      // test that guards hand-typed numbers is the joke this repository has already told twice.
      // AT OR BELOW THE CEILING, NOT EQUAL TO IT.
      //
      // This asserted the printed count EQUALLED the declared ceiling, which made the stated
      // maintenance action - lowering the ceiling once the count drops - turn the suite red, and
      // made removing an unregistered sentence red too. A ratchet you are punished for tightening
      // is a ratchet nobody tightens. See DEFECTS_FOUND.md section 36.
      const declared = Number(
        CEILING_LINE.exec(readFileSync(join(REPO, "scripts/verify-numbers.mjs"), "utf8"))?.[1] ??
          Number.MAX_SAFE_INTEGER,
      );
      const live = Number(/(\d+) UNREGISTERED/.exec(out)?.[1] ?? Number.MAX_SAFE_INTEGER);
      expect(
        live,
        "a document of purely exempted shapes pushed the unregistered count past the ceiling",
      ).toBeLessThanOrEqual(declared);
    } finally {
      rmSync(doc, { force: true });
    }
  });

  it("the ratchet ceiling exists and is not set past the point of meaning", () => {
    const src = readFileSync(join(REPO, "scripts/verify-numbers.mjs"), "utf8");
    // Matching the LINE, not the resolved value: `CONTAINMENT_MAX_UNREGISTERED` exists so the tests
    // below need not rewrite the script, and this is what stops that hook lifting the shipped bound.
    const declared = CEILING_LINE.exec(src);
    expect(
      declared,
      "the ratchet ceiling is gone - unregistered numbers can grow unchecked",
    ).not.toBe(null);
    expect(
      Number(declared?.[1] ?? Number.MAX_SAFE_INTEGER),
      "MAX_UNREGISTERED was raised past any plausible document set, which disables the ratchet",
    ).toBeLessThan(200);
  });

  it("--fast drops the tests fact rather than registering it as zero", () => {
    // The -1 mistake, one level on. A fact whose value could not be computed must LEAVE the list,
    // not sit in it with a placeholder - a registered fact of 0 flags every correct statement stale.
    const { out } = runFast();
    expect(out).not.toMatch(/^\s*tests\s+0\s/m);
    expect(out).not.toContain("-1");
  });

  // THE TWO HALVES OF THE IMPORTED SPLIT, each with its own control.
  //
  // These exist because the TOTAL was registered and correct at 62 while both halves still read
  // (17) in README.md - a correct sum over two wrong addends, which no check could see. A fact per
  // half, and a control per fact, is the only arrangement that catches that.
  const HALVES = [
    [
      "direct-harm imported",
      "Two halves: direct-harm (4242) and data-stealing (32), reported apart.",
    ],
    [
      "data-stealing imported",
      "Two halves: direct-harm (30) and data-stealing (777), reported apart.",
    ],
  ] as const;

  for (const [fact, sentence] of HALVES) {
    it(`a wrong ${fact} count is caught, and the report names it`, () => {
      const doc = join(tmpdir(), `acc-${fact.replace(/\s+/g, "-")}.md`);
      writeFileSync(doc, `${sentence}\n`);
      try {
        const { failed, out } = runFast(doc);
        expect(failed, `a wrong ${fact} was not reported stale:\n${out}`).toBe(true);
        expect(out).toContain(fact);
        expect(out).toContain(doc.split("/").pop() ?? "");
      } finally {
        rmSync(doc, { force: true });
      }
    });
  }

  it("the CORRECT half counts do not fail, so the controls above mean something", () => {
    // The near-miss. Both controls would pass against a checker that flagged every sentence.
    const doc = join(tmpdir(), "acc-halves-correct.md");
    writeFileSync(doc, "Two halves: direct-harm (30) and data-stealing (32), reported apart.\n");
    try {
      const { failed, out } = runFast(doc);
      expect(failed, `correct half counts were reported stale:\n${out}`).toBe(false);
    } finally {
      rmSync(doc, { force: true });
    }
  });

  it("the halves are registered SEPARATELY from the total", () => {
    // If either half were folded into `imported cases`, a correct total would keep hiding wrong
    // halves - which is the exact failure these facts were added for.
    const { out } = runFast();
    expect(out).toMatch(/direct-harm imported\s+30\s/);
    expect(out).toMatch(/data-stealing imported\s+32\s/);
    expect(out).toMatch(/imported cases\s+62\s/);
  });
});

// ---------------------------------------------------------------------------------------------
// THE RATCHET, AND THE FACT-COVERAGE CHECK, EACH FROM BOTH SIDES.
//
// Added after a refutation pass measured two things: the ratchet was pinned to EQUALITY, so doing
// the maintenance it asks for turned the suite red; and two registered facts passed their negative
// controls while matching zero sentences in any shipping document. See DEFECTS_FOUND.md section 36.
// ---------------------------------------------------------------------------------------------

describe("the test count survives CI colour, which is what actually broke", () => {
  // THE DEFECT THIS PINS. Vitest turns colour OFF when its output is piped - every local run - and
  // FORCES it ON under `CI=true`, so the line a human reads as `Tests  348 passed (348)` arrives as
  // `ESC[2m      Tests ESC[22m ESC[1mESC[32m348 passedESC[39m...`. No pattern that expects digits
  // after `Tests` can cross those escapes.
  //
  // So in CI this script counted a green suite as ZERO tests, and - worse - could not have detected a
  // RED one either, which means the section 35 refusal never worked there at all. Locally it matched
  // every single time, which is why it survived several passes. See DEFECTS_FOUND.md section 43.
  const ESC = String.fromCharCode(27);
  const green = `${ESC}[2m      Tests ${ESC}[22m ${ESC}[1m${ESC}[32m348 passed${ESC}[39m${ESC}[22m${ESC}[90m (348)${ESC}[39m`;
  const red = `${ESC}[2m      Tests ${ESC}[22m ${ESC}[1m${ESC}[31m1 failed${ESC}[39m | ${ESC}[32m347 passed${ESC}[39m (348)`;

  it("a coloured PASS summary is countable once stripped", () => {
    const clean = stripAnsi(green);
    expect([...clean.matchAll(/Tests\s+(\d+) passed/g)].map((m) => m[1])).toEqual(["348"]);
  });

  it("a coloured FAIL summary is still recognised as red", () => {
    // The half that matters more. An undetected red suite in CI would have been counted, not refused.
    const clean = stripAnsi(red);
    expect(/Tests\s+\d+\s+failed/.test(clean), "a red CI suite reads as green").toBe(true);
  });

  it("and without stripping, neither works - which is the bug, asserted", () => {
    // The near-miss. If vitest ever stopped colouring under CI these fixtures would still pass while
    // asserting nothing, so this states the failing behaviour directly.
    expect(/Tests\s+\d+\s+failed/.test(red)).toBe(false);
    expect([...green.matchAll(/Tests\s+(\d+) passed/g)]).toHaveLength(0);
  });

  it("both scripts that count tests use the ONE shared implementation", () => {
    // A private copy in one file and none in the other is exactly how this happened:
    // `generated-blocks.mjs` could read a CI summary and `verify-numbers.mjs` could not.
    for (const f of ["scripts/verify-numbers.mjs", "scripts/generated-blocks.mjs"]) {
      expect(
        readFileSync(join(REPO, f), "utf8"),
        `${f} does not use the shared stripAnsi`,
      ).toContain('from "./lib/strip-ansi.mjs"');
    }
    // And no file may keep a private copy again.
    expect(
      readFileSync(join(REPO, "scripts/generated-blocks.mjs"), "utf8"),
      "generated-blocks re-grew a private stripAnsi - the two can drift apart again",
    ).not.toMatch(/const stripAnsi = /);
  });

  it("verify:numbers counts the suite correctly with CI=true set", () => {
    // THE END-TO-END PIN, in the environment that was failing. Everything above is about a fixture;
    // this runs the real script the way GitHub Actions does.
    const out = execFileSync("node", ["scripts/verify-numbers.mjs", "--fast"], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
    });
    // `--fast` drops the tests fact, so assert the run is clean rather than the count - the count
    // itself is covered by the fixtures above and by the script's own refusal.
    expect(out).not.toContain("PRINTED NO");
  });
});

describe("the test count survives a warm turbo cache", () => {
  // WHAT THIS IS ABOUT. CI failed with `tests 0 (pnpm test)` and three release documents reported
  // stale for saying 711. Every document was right: `blocks:check` runs the suite two steps earlier,
  // so the counting run was a full turbo cache hit that replayed no task logs, `matchAll` found no
  // `Tests N passed` summaries, and the sum of nothing is 0. See DEFECTS_FOUND.md section 43.
  const SCRIPT = readFileSync(join(REPO, "scripts/verify-numbers.mjs"), "utf8");

  it("forces execution, so a cache hit cannot leave nothing to count", () => {
    expect(
      SCRIPT,
      "the counting run no longer forces execution - a warm turbo cache can make it count zero tests",
    ).toContain("TURBO_FORCE=true pnpm -s test");
  });

  it("and generated-blocks does too, so the order of CI steps stops mattering", () => {
    // That file already throws when it cannot parse, so its failure was loud rather than wrong - but
    // only because `blocks:check` happens to run before anything warms the cache. An invisible
    // ordering dependency is not a defence.
    expect(readFileSync(join(REPO, "scripts/generated-blocks.mjs"), "utf8")).toContain(
      "TURBO_FORCE=true pnpm -s test",
    );
  });

  it("refuses outright when the suite is green but printed no summary", () => {
    // THE CHECK THAT ACTUALLY HOLDS, and the reason it is on the OUTPUT rather than on any particular
    // way of failing. Section 35 added a refusal for a RED suite; this is a GREEN one that printed
    // nothing, which that refusal did not cover. Registering the sum of no summaries registers 0 -
    // the placeholder this script's own rule forbids.
    expect(SCRIPT).toContain("testUncountable");
    expect(SCRIPT).toContain("PRINTED NO `Tests N passed` SUMMARY");
  });

  it("the refusal exits non-zero, rather than reporting every correct count as stale", () => {
    // Driven for real: point the counting run at a command that succeeds and prints no summary, and
    // require a refusal rather than a pile of stale-number findings. This is the CI shape exactly.
    // Driven through the env hook rather than by copying the script: a copy in a temp directory
    // cannot resolve its own relative imports, and rewriting the shipped file in place is what
    // section 37 forbade. `true` succeeds and prints nothing - a green run with no summary.
    let failed = false;
    let out = "";
    try {
      out = execFileSync("node", ["scripts/verify-numbers.mjs"], {
        cwd: REPO,
        encoding: "utf8",
        env: { ...process.env, CONTAINMENT_TEST_CMD: "true" },
      });
    } catch (e) {
      failed = true;
      out = `${String((e as { stdout?: string }).stdout ?? "")}${String((e as { stderr?: string }).stderr ?? "")}`;
    }
    expect(failed, "a suite that printed no summary was accepted").toBe(true);
    expect(out).toContain("PRINTED NO");
    expect(out, "it reported documents as stale instead of naming the harness").not.toContain(
      "stale number(s)",
    );
  });

  it("and the hook cannot change what ships", () => {
    // The near-miss. If the default were not the forcing command, the test above would be watching a
    // refusal that the shipped script can never reach.
    expect(SCRIPT).toContain('?? "TURBO_FORCE=true pnpm -s test 2>&1"');
  });
});

describe("the ratchet can be tightened, and cannot be loosened quietly", () => {
  const SCRIPT = join(REPO, "scripts/verify-numbers.mjs");

  /**
   * Runs the script at a chosen ceiling WITHOUT editing it.
   *
   * The first version rewrote `scripts/verify-numbers.mjs` in place and restored it in a `finally`.
   * That leaves the repository corrupted if the run is killed, and it was observed leaving
   * `MAX_UNREGISTERED = 9999` behind after an interrupted suite - a shipped script one Ctrl-C away
   * from lying about its own ceiling. The script now reads an override from the environment for
   * exactly this, the way `CONTAINMENT_EXTRA_DOC` exists so no test writes into a release document.
   * See DEFECTS_FOUND.md section 37.
   */
  const atCeiling = (n: number): { readonly failed: boolean; readonly out: string } => {
    try {
      const out = execFileSync("node", ["scripts/verify-numbers.mjs", "--fast"], {
        cwd: REPO,
        encoding: "utf8",
        env: { ...process.env, CONTAINMENT_MAX_UNREGISTERED: String(n) },
      });
      return { failed: false, out };
    } catch (e) {
      return { failed: true, out: String((e as { stdout?: string }).stdout ?? "") };
    }
  };

  /** The shipped ceiling, read from the LINE rather than the resolved value. */
  const declared = (): number =>
    Number(CEILING_LINE.exec(readFileSync(SCRIPT, "utf8"))?.[1] ?? Number.MAX_SAFE_INTEGER);

  const liveCount = (): number =>
    Number(/(\d+) UNREGISTERED/.exec(atCeiling(9_999).out)?.[1] ?? Number.NaN);

  it("the live count is at or below the shipped ceiling", () => {
    expect(liveCount()).toBeLessThanOrEqual(declared());
  });

  it("lowering the ceiling TO the current count passes", () => {
    // The maintenance action the script asks for. It used to turn the suite red.
    expect(atCeiling(liveCount()).failed, "tightening to the live count was rejected").toBe(false);
  });

  it("lowering the ceiling BELOW the current count fails, and says why", () => {
    const { failed, out } = atCeiling(liveCount() - 1);
    expect(failed, "a ceiling under the live count was accepted").toBe(true);
    expect(out).toContain("RATCHET BROKEN");
  });

  it("the override cannot raise what ships", () => {
    // The hook exists for these tests. If it could move the shipped bound it would be a bypass.
    expect(readFileSync(SCRIPT, "utf8")).toMatch(CEILING_LINE);
  });
});

describe("a registered fact that guards no sentence is caught", () => {
  it("fails, and names the fact, when a fact matches nothing in any shipping document", () => {
    // The section 16 shape at the level of one fact: a pattern that CAN fire, proven by its own
    // negative control, but which fires on nothing that ships. The phantom fact is injected through
    // the environment rather than by rewriting the script, for the reason above.
    let failed = false;
    let out = "";
    try {
      out = execFileSync("node", ["scripts/verify-numbers.mjs", "--fast"], {
        cwd: REPO,
        encoding: "utf8",
        env: { ...process.env, CONTAINMENT_PHANTOM_FACT: "1" },
      });
    } catch (e) {
      failed = true;
      out = String((e as { stdout?: string }).stdout ?? "");
    }
    expect(failed, "a fact guarding nothing was accepted").toBe(true);
    expect(out).toContain("MATCH NO SENTENCE");
    expect(out).toContain("a fact nobody states");
  });

  it("and without the hook, every shipped fact guards something", () => {
    // The near-miss: a check that always failed would pass the test above.
    const { failed } = (() => {
      try {
        execFileSync("node", ["scripts/verify-numbers.mjs", "--fast"], {
          cwd: REPO,
          encoding: "utf8",
        });
        return { failed: false };
      } catch {
        return { failed: true };
      }
    })();
    expect(failed, "a shipped fact guards no sentence").toBe(false);
  });
});
