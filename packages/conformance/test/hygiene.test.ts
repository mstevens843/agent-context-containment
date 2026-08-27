// Repo hygiene, as an invariant rather than a habit.
//
// A release candidate should not carry scratch files. This is a small rule, and it is here because
// the alternative - noticing by eye - is what let `probe-tmp.mjs` sit unreferenced in the repository
// root across three release passes. See DEFECTS_FOUND.md §20, §21 and §22.
//
// THE EXEMPTION LIST IS NOW EMPTY, AND THAT IS THE POINT. It held exactly one entry, carried a
// removal command, and was written so that deleting the file it excused would FAIL this suite and
// force the entry out. That is what happened: the file was removed at v1.0 finalization, the
// "exemption outlives the file" test failed on the next run, and the entry went with it. An
// exemption that cannot outlive its cause is a queue; one that can is a convention.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");

/**
 * Root scripts allowed to exist without being referenced by a package script.
 *
 * EMPTY, AND IT MUST STAY EMPTY. An entry here is a known violation with a reason and an owner, not
 * a permission. Adding one is a deliberate act that shows up in a diff; the tests below make sure it
 * cannot become permanent or plural.
 */
const KNOWN_DEBRIS = new Set<string>();

describe("the repository root carries no unreferenced scripts", () => {
  const rootScripts = readdirSync(REPO).filter(
    (f) => (f.endsWith(".mjs") || f.endsWith(".mts") || f.endsWith(".js")) && !f.startsWith("."),
  );

  it("every root script is referenced by a package script, or is recorded debris", () => {
    const pkg = readFileSync(join(REPO, "package.json"), "utf8");
    const unreferenced = rootScripts.filter((f) => !pkg.includes(f) && !KNOWN_DEBRIS.has(f));
    expect(
      unreferenced,
      `unreferenced script(s) in the repository root: ${unreferenced.join(", ")}. Wire it into package.json, move it under scripts/ with a real name, or delete it. Do NOT add it to KNOWN_DEBRIS - that list is for violations already being removed.`,
    ).toEqual([]);
  });

  it("the known-debris list names only files that still exist", () => {
    // A stale exemption is worse than none: it reads as a live problem and quietly widens the rule.
    // This is the test that evicted `probe-tmp.mjs`'s entry the moment the file was deleted.
    for (const f of KNOWN_DEBRIS) {
      expect(
        rootScripts.includes(f),
        `KNOWN_DEBRIS still lists "${f}", which is gone. Remove the entry - the exemption has outlived the file.`,
      ).toBe(true);
    }
  });

  it("the known-debris list is empty at release", () => {
    // The release condition, stated as a test rather than as a checklist line somebody reads once.
    // A publish-candidate with recorded debris is not clean; it is documented as dirty.
    expect(
      [...KNOWN_DEBRIS],
      "the release carries recorded debris. Delete the file, or do not call this a publish candidate.",
    ).toEqual([]);
  });
});
