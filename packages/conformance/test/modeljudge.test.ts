// The model judge is optional, and this is what makes "optional" a property rather than a promise.
//
// An off-by-default tool has two ways of quietly becoming on-by-default: it stops skipping cleanly,
// so a pipeline that calls it unconditionally starts failing and someone "fixes" it by supplying a
// key; or a key ends up in the repository, at which point every run is a model run. Both are caught
// here, in tests that need no key themselves.
//
// The third test is about the claim rather than the code: the judge must be described as
// supplementary everywhere it is described at all, because a number that changes when nobody changed
// anything cannot sit beside numbers that do not.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");
const SCRIPT = join(REPO, "scripts", "model-judge.mjs");

const run = (env: Record<string, string | undefined>, args: string[] = []): string =>
  execFileSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ANTHROPIC_API_KEY: undefined, ...env } as NodeJS.ProcessEnv,
  });

describe("model judge harness", () => {
  it("both modes skip cleanly with no key, so an unconditional pipeline stays green", () => {
    // execFileSync throws on a non-zero exit, so reaching the assertion is itself the exit-code test.
    for (const args of [[], ["--mode=labels"], ["--mode=engine"]]) {
      const out = run({}, args);
      expect(out, `mode ${args[0] ?? "(default)"} did not skip`).toContain("skipped");
      expect(out).toContain("ANTHROPIC_API_KEY is not set");
    }
  });

  it("both modes refuse to call a model under CI even when a key is present", () => {
    // The key here is a literal that is not one. If this test ever needs a real key to pass, the
    // harness has stopped being optional.
    for (const args of [["--mode=labels"], ["--mode=engine"]]) {
      const out = run({ ANTHROPIC_API_KEY: "not-a-real-key", CI: "true" }, args);
      expect(out, `mode ${args[0]} ran under CI`).toContain(
        "refusing to make model calls under CI",
      );
    }
  });

  it("an unknown mode fails loudly rather than silently picking one", () => {
    // A typo that quietly ran the wrong judge would produce a plausible report answering a different
    // question, which is worse than an error.
    expect(() => run({}, ["--mode=engien"])).toThrow();
  });

  it("the engine mode samples the splits where a wrong REASON would cost most", () => {
    // Not a style point. The label judge never looks at what the engine said, so it cannot see a
    // correct decision reached for a reason that does not apply - and the splits where that matters
    // are the exact imports and the two built to launder.
    const src = readFileSync(SCRIPT, "utf8");
    for (const split of ["imported", "derived", "holdout_v2", "adaptive"]) {
      expect(src, `the engine mode does not sample ${split}`).toContain(`"${split}"`);
    }
  });

  it("the engine mode judges the decision and the reasons as separate columns", () => {
    // They fail separately - that is the entire point of docs/RIGHT_ANSWER_WRONG_REASON.md - so a
    // single "is this right" score would hide the failure mode the mode was added to look for.
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).toContain("decisionSound");
    expect(src).toContain("reasonsSound");
    expect(
      src,
      "the report does not explain what a sound-decision/unsound-reasons row means",
    ).toContain("the decision is sound and the reasons are not is the interesting row");
  });

  it("model judgment is never consulted by any test in this repository", () => {
    // The rule that keeps it supplementary. If a test ever imported the judge's output, a number that
    // changes on its own would be gating a build.
    const dirs = [join(REPO, "packages"), join(REPO, "corpus")];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", "dist", ".turbo"].includes(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(ts|json)$/.test(name)) continue;
        const text = readFileSync(p, "utf8");
        // The judge writes to MODEL_JUDGE_OUT / MODEL_JUDGE_JSON. Nothing may read those back in.
        if (/MODEL_JUDGE_(OUT|JSON)/.test(text) && !p.endsWith("modeljudge.test.ts")) {
          offenders.push(p.slice(REPO.length + 1));
        }
      }
    };
    for (const d of dirs) walk(d);
    expect(offenders.join(", "), "something reads the model judge's output as input").toBe("");
  });

  it("no committed file contains anything shaped like an API key", () => {
    // Cheap, and the failure it prevents is not cheap. Walks the tree rather than trusting that the
    // only place a key could appear is the one script that uses one.
    const SKIP = new Set(["node_modules", ".git", "dist", ".turbo", "coverage"]);
    const suspicious: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (SKIP.has(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(ts|js|mjs|cjs|json|md|ya?ml|sh)$/.test(name)) continue;
        const text = readFileSync(p, "utf8");
        // Anthropic keys start sk-ant-; the generic sk- form catches other vendors' too. The
        // pattern is written in pieces so this file does not itself match it.
        const pattern = new RegExp(`sk${"-"}ant${"-"}[A-Za-z0-9_-]{16,}|sk${"-"}[A-Za-z0-9]{32,}`);
        if (pattern.test(text)) suspicious.push(p.slice(REPO.length + 1));
      }
    };
    walk(REPO);
    expect(suspicious.join(", "), "a file looks like it contains a live API key").toBe("");
  });

  it("the harness describes itself as supplementary wherever it describes itself", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src, "the script does not say it is not a source of truth").toContain(
      "Not a source of truth",
    );
    expect(src, "the script does not say results are supplementary").toContain("supplementary");
    // And the claim has to survive into the artifact it writes, not just its own header.
    expect(src, "the markdown it emits does not carry the caveat").toContain(
      "does not gate anything and is not a source of truth",
    );
  });

  it("sampling is deterministic, so a supplementary result is reproducible", () => {
    // A judge that samples randomly produces a number nobody can check. Asserted on the source
    // because running it needs a key: the script must not reach for a random source at all.
    const src = readFileSync(SCRIPT, "utf8");
    expect(src.includes("Math.random"), "the judge samples randomly and cannot be reproduced").toBe(
      false,
    );
    expect(src).toContain("deterministic stride");
  });
});
