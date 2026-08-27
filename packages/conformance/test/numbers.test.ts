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
// @ts-expect-error - a plain .mjs helper, deliberately not part of any package's build
import { numericClaims, scanDocument } from "../../../scripts/lib/numeric-noise.mjs";

const REPO = join(import.meta.dirname, "..", "..", "..");

// Tests that RUN `scripts/verify-numbers.mjs` must not run inside it. The script counts tests by
// shelling out to `pnpm test`, so without this guard each of them re-enters the script and the whole
// thing recurses. `describe.skipIf` rather than a silent early return, so a skipped run says so.
const REENTRANT = process.env.CONTAINMENT_VERIFY_NUMBERS === "1";

describe("what the scanner counts as a numeric claim", () => {
  it("counts a bare count and an N-of-M pair", () => {
    expect(numericClaims("**503 tests across five packages.**").length).toBeGreaterThan(0);
    expect(numericClaims("attacks blocked 9/9 in the holdout").length).toBeGreaterThan(0);
    expect(numericClaims("17 of 17 data-stealing cases got through").length).toBeGreaterThan(0);
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
    // `102 hand-written and imported` is a registered fact. State it wrong.
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
    writeFileSync(doc, "The corpus is 102 hand-written and imported cases.\n");
    try {
      const { failed, out } = runFast(doc);
      expect(failed, `a CORRECT registered number was reported stale:\n${out}`).toBe(false);
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
      const declared = /const MAX_UNREGISTERED = (\d+);/.exec(
        readFileSync(join(REPO, "scripts/verify-numbers.mjs"), "utf8"),
      )?.[1];
      expect(out, "a document of purely exempted shapes moved the unregistered count").toContain(
        `${declared} UNREGISTERED`,
      );
    } finally {
      rmSync(doc, { force: true });
    }
  });

  it("the ratchet ceiling exists and is not set past the point of meaning", () => {
    const src = readFileSync(join(REPO, "scripts/verify-numbers.mjs"), "utf8");
    const declared = /const MAX_UNREGISTERED = (\d+);/.exec(src);
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
});
