// What `pnpm doctor` is allowed to imply.
//
// A deployment report is read once, quickly, by somebody deciding whether to ship. That makes its
// wording load-bearing in a way ordinary prose is not: a reader who finishes it believing the tool
// verified their topology has been misled by a command that never claimed to, and the difference
// between those two sentences is the entire trust boundary.
//
// These assertions were prose in `doctor.mjs` and in `TRUST_BOUNDARIES.md`. They are here because a
// distinction that lives only in a comment survives exactly as long as the person who wrote it.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");
const out = execFileSync("node", [join(REPO, "scripts", "doctor.mjs")], {
  cwd: REPO,
  encoding: "utf8",
});

describe("the deployment doctor states what it cannot see", () => {
  it("says the ledger guarantees are CLAIMS, not proofs", () => {
    // It prints a table of what each adapter says it survives. Without this line a reader takes the
    // table for verification, and nothing verifies a single cell of it.
    expect(out).toContain("These are CLAIMS, not proofs");
  });

  it("names cross-host topology as something it cannot check", () => {
    expect(out).toContain("whether your hosts share one database");
    const cannot = out.slice(out.indexOf("WHAT THIS CANNOT SEE"));
    expect(
      cannot.includes("whether your hosts share one database"),
      "the topology limit is mentioned somewhere other than the CANNOT SEE section, where a skimming reader will miss it",
    ).toBe(true);
  });

  it("never claims to have proven or verified anything", () => {
    // The word it must not use about itself. Checked line by line so a disclaimer containing the
    // word does not exempt an assertion elsewhere - the exact failure that made the prose guard
    // useless in §17.
    for (const line of out.split("\n")) {
      if (!/\b(proves?|proven|verified|guarantee[sd]?)\b/i.test(line)) continue;
      expect(
        /\bnot\b|\bnothing\b|\bcannot\b|\bno\b/i.test(line),
        `doctor asserts a proof or guarantee:\n    ${line.trim()}`,
      ).toBe(true);
    }
  });

  it("says plainly that it reads declarations rather than a running system", () => {
    expect(out).toContain("this reads declarations, not processes");
  });

  it("its stale-reclaim figures come from running the ledger, not from a script", () => {
    // A demonstration that printed a story would be worse than none: it would look like evidence.
    // The numbers must move with the clock, which only real calls do.
    expect(out).toMatch(/at t=500\s+reserved=1 consumed=1 stranded=0/);
    expect(out).toMatch(/at t=9999\s+reserved=1 consumed=1 stranded=1/);
    const src = readFileSync(join(REPO, "scripts", "doctor.mjs"), "utf8");
    expect(
      src.includes("await l.reserve") && src.includes("await l.stats"),
      "the stale-reclaim section prints numbers it did not compute",
    ).toBe(true);
  });

  it("names the high-blast-radius rows as something the reader must audit", () => {
    // The single highest-leverage question in a deployment, and one the doctor cannot answer.
    expect(out).toContain("AUDIT THESE FIRST");
    expect(out).toContain("nothing here can answer it for you");
  });

  it("says a clean advisory run is a fact about vocabulary, not behaviour", () => {
    expect(out).toContain("a fact about vocabulary, not about behaviour");
  });
});
