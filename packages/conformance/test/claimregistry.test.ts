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
const scripts: Record<string, string> = JSON.parse(
  readFileSync(join(REPO, "package.json"), "utf8"),
).scripts;

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
      const nc = c.negativeControl ?? "";
      expect(
        nc.length > 20,
        `${c.id} is ${c.grade} with no negative control - this is the §15 shape: a test that passes and may not be able to fail`,
      ).toBe(true);
      // AND IT MUST NAME SOMETHING THAT EXISTS. Until v1.0 this rule checked the string's LENGTH and
      // nothing else, so an adversarial reviewer replaced the purity claim's control - the most
      // fundamental claim in the project - with 76 characters of nonsense and `audit:claims` still
      // reported 25/25. A control that cannot be resolved to an artifact is prose. See §19.
      const anchors = [
        ...nc.matchAll(/\b((?:packages|scripts|corpus|docs|examples)\/[\w./-]+)/g),
      ].map((m) => m[1] ?? "");
      const commands = [...nc.matchAll(/\b((?:pnpm|npx)\s+[\w:-]+)/g)].map((m) => m[1] ?? "");
      const cites = c.mutation !== undefined || anchors.length > 0 || commands.length > 0;
      expect(
        cites,
        `${c.id}'s negative control names no artifact - no mutation, no path, no command. ` +
          `A reviewer cannot check it and neither can this test: "${nc.slice(0, 60)}"`,
      ).toBe(true);
      for (const a of anchors) {
        expect(
          existsSync(join(REPO, a)),
          `${c.id}'s negative control cites ${a}, which does not exist`,
        ).toBe(true);
      }
      for (const cmd of commands) {
        const script = cmd.replace(/^(?:pnpm|npx)\s+/, "");
        if (script === "vitest" || script === "test") continue;
        expect(
          Object.hasOwn(scripts, script),
          `${c.id}'s negative control cites \`${cmd}\`, which is not a package script`,
        ).toBe(true);
      }
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

  it("every gate the registry leans on actually runs in CI", () => {
    // §17 found the control for the whole mutant apparatus sitting outside CI. v1.0 found the same
    // thing one level up: NONE of audit:docs, blocks:check, verify:numbers, audit:claims or
    // audit:mutations ran in CI, so the repository shipped with `audit:docs` exiting 1 and a README
    // number seven tests stale while every checkmark was green.
    //
    // A gate that does not run is a gate that does not exist, and the failure is silent by
    // construction - which is the one failure mode this project keeps rediscovering. So the workflow
    // file is an asserted artifact now: delete a step and this fails. See DEFECTS_FOUND.md §19.
    const ci = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8");
    for (const gate of [
      "pnpm blocks:check",
      "pnpm verify:numbers",
      "pnpm audit:docs",
      "pnpm audit:claims",
      "pnpm audit:mutations",
      "pnpm adversary",
      "pnpm audit:release",
    ]) {
      expect(
        ci.includes(gate),
        `CI does not run \`${gate}\`. Every claim it defends is unguarded on every push.`,
      ).toBe(true);
    }
    // verify:freeze is deliberately NOT a gate: it exits 1 by design and would make CI permanently
    // red for a limitation the project reports rather than a defect. Pinned so that "it is not in
    // CI" stays a recorded decision instead of becoming an oversight somebody quietly corrects.
    expect(
      ci.includes("pnpm verify:freeze"),
      "verify:freeze is a gate now - it exits 1 by design, so CI can never be green again",
    ).toBe(false);

    // The frozen holdout is gated too, in its own job and without a toolchain, so a drifted corpus
    // fails in seconds with a red X that says "the corpus drifted" rather than "the build broke".
    expect(
      ci.includes("corpus/holdout/MANIFEST.sha256"),
      "CI no longer verifies the frozen holdout against its manifest",
    ).toBe(true);

    // POSTGRES MUST STAY OUT, and the reason must stay written down. Without DATABASE_URL the proof
    // reports SKIPPED / NOT PROVEN and exits 0 - a green step that proved nothing. Adding it would
    // convert an honest skip into a rubber stamp, which is the shape of half of DEFECTS_FOUND.md.
    expect(
      ci.includes("pnpm prove:postgres"),
      "CI runs prove:postgres, which without DATABASE_URL is a green step that proves nothing",
    ).toBe(false);
    expect(
      ci.includes("DATABASE_URL"),
      "the reason Postgres is absent from CI is no longer recorded in the workflow",
    ).toBe(true);
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
