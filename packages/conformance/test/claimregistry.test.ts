// The claim registry, and the rules that keep it from becoming a wish list.
//
// Defect §15: two claims were graded PROVEN on evidence that did not support them, and nothing in
// the repository connected a claim to the test that was supposed to defend it. `docs/claims.json` is
// that connection. These tests are what stop it drifting into decoration.
//
// The rule that matters most is the negative control. A PROVEN claim whose test has never been seen
// to fail is exactly §15 - and the purity claim, found vacuous in the v1.0 audit, had passed for
// months while checking an empty list.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");

interface Claim {
  readonly id: string;
  readonly claim: string;
  readonly grade: string;
  readonly test?: string;
  readonly negativeControl?: string;
  readonly generatedBy?: string;
  readonly mutation?: string;
  readonly note?: string;
}

const registry = JSON.parse(readFileSync(join(REPO, "docs", "claims.json"), "utf8")) as {
  grades: Record<string, string>;
  claims: readonly Claim[];
};

const NEEDS_EVIDENCE = new Set(["PROVEN", "ADAPTER-PROVEN"]);
const mutationSource = readFileSync(join(REPO, "scripts", "audit-mutations.mjs"), "utf8");

describe("claim registry", () => {
  it("has claims, and enough of them to be worth having", () => {
    expect(registry.claims.length, "the registry is empty or trivial").toBeGreaterThan(12);
  });

  it("every claim uses a grade the registry itself defines", () => {
    for (const c of registry.claims) {
      expect(
        Object.keys(registry.grades),
        `${c.id} is graded "${c.grade}", which the registry does not define`,
      ).toContain(c.grade);
    }
  });

  it("claim ids are unique", () => {
    const ids = registry.claims.map((c) => c.id);
    expect(new Set(ids).size, "two claims share an id").toBe(ids.length);
  });

  it("every PROVEN or ADAPTER-PROVEN claim names a test that exists", () => {
    // A claim with no test is a claim nobody is defending. Naming a test that does not exist is
    // worse: it reads as defended.
    for (const c of registry.claims) {
      if (!NEEDS_EVIDENCE.has(c.grade)) continue;
      expect(c.test, `${c.id} is ${c.grade} and names no test`).toBeDefined();
      expect(
        existsSync(join(REPO, c.test ?? "")),
        `${c.id} names "${c.test}", which does not exist`,
      ).toBe(true);
    }
  });

  it("every PROVEN or ADAPTER-PROVEN claim names a negative control", () => {
    // THE §15 RULE. A test that passes proves nothing until something has been seen to make it fail.
    for (const c of registry.claims) {
      if (!NEEDS_EVIDENCE.has(c.grade)) continue;
      expect(
        (c.negativeControl ?? "").length > 20,
        `${c.id} is ${c.grade} with no negative control - this is the §15 shape: a test that passes and may not be able to fail`,
      ).toBe(true);
    }
  });

  it("every claim that names a mutation names one the audit script actually runs", () => {
    // The registry and the mutation harness must not drift apart. A claim citing a mutation that was
    // renamed or removed is citing a check nobody performs.
    for (const c of registry.claims) {
      if (c.mutation === undefined) continue;
      expect(
        mutationSource.includes(`id: "${c.mutation}"`),
        `${c.id} cites mutation "${c.mutation}", which scripts/audit-mutations.mjs does not define`,
      ).toBe(true);
    }
  });

  it("every numeric claim names the command that produces the number", () => {
    // Four separate passes of this project shipped a stale hand-typed number. A number in a sentence
    // cannot live in a generated block, so it must at least say where it came from.
    const NUMERIC = /\b\d+\s*(of|\/)\s*\d+\b|\b\d{2,}\b/;
    for (const c of registry.claims) {
      if (!NUMERIC.test(c.claim)) continue;
      expect(
        c.generatedBy,
        `${c.id} states a number and names no command that produces it: "${c.claim}"`,
      ).toBeDefined();
    }
  });

  it("commands named by claims are real package scripts", () => {
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const c of registry.claims) {
      if (c.generatedBy === undefined) continue;
      // Strip an env prefix like `DATABASE_URL=... `.
      const cmd = c.generatedBy.replace(/^[A-Z_]+=\S+\s+/, "");
      const m = /^(?:pnpm|npm run)\s+(\S+)/.exec(cmd);
      if (m === null) {
        // Not a package script - a path, e.g. scripts/verify-corpus.sh. It must exist.
        expect(
          existsSync(join(REPO, cmd)),
          `${c.id} names "${cmd}", which is neither a script nor a file`,
        ).toBe(true);
        continue;
      }
      expect(
        Object.keys(pkg.scripts),
        `${c.id} names \`${cmd}\`, which package.json does not define`,
      ).toContain(m[1]);
    }
  });

  it("NOT-CLAIMED and DELEGATED entries do not smuggle in a proof", () => {
    // These are statements about what is NOT asserted. Attaching a negative control to one would be
    // claiming evidence for a non-claim, which is how a bounded statement becomes an unbounded one.
    for (const c of registry.claims) {
      if (c.grade !== "NOT-CLAIMED" && c.grade !== "DELEGATED") continue;
      expect(
        c.negativeControl,
        `${c.id} is ${c.grade} and carries a negative control - it is asserting something after all`,
      ).toBeUndefined();
    }
  });

  it("the claims that most need defending are the ones that have it", () => {
    // A registry where everything is NOT-CLAIMED would satisfy every rule above and defend nothing.
    const proven = registry.claims.filter((c) => c.grade === "PROVEN").length;
    expect(
      proven,
      "almost nothing is PROVEN - the registry is dodging rather than tracking",
    ).toBeGreaterThan(6);
  });
});
