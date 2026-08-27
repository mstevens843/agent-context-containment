// The boundary test. Fails the build if the pure core grows the ability to do anything.
//
// The sibling repo planned this and never wrote it. It is here because the purity claim in every
// file header is worth exactly nothing without something that checks it, and because the failure
// mode is silent: `decide()` reading a clock still returns plausible answers, right up until two
// runs of the same input disagree and nobody can reproduce the bug.
//
// Note that a `lib: ["ES2022"]` tsconfig does NOT catch `Date.now()` or `Math.random()` - both are
// in ES2022 and always will be. That gap is what this test covers.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..", "src");

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return f.endsWith(".ts") ? [p] : [];
  });

/** Strip comments only. Prose cannot fail the build; string CONTENTS survive. */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/**
 * Strip comments AND string literals, so a banned word quoted inside a string does not fail.
 *
 * DO NOT USE THIS FOR THE IMPORT SCAN. That was defect §16: this function ran first, so
 * `from "node:fs"` became `from ""`, the specifier regex `[^"']+` required at least one character
 * and matched nothing, and the import check looped over an empty list on every file. "The pure core
 * imports nothing at all" - the most fundamental claim in this project, graded PROVEN and cited in
 * four documents - was defended by a test that could not fail from the day it was written.
 *
 * The two needs are genuinely different and that is why they are two functions now: an import
 * specifier IS a string literal, and a banned identifier must not be found inside one.
 */
const withoutStrings = (text: string): string =>
  withoutComments(text)
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

const FILES = sources(SRC).map((p) => ({
  path: p,
  /** Comments gone, strings intact. For anything that reads a string, i.e. imports. */
  imports: withoutComments(readFileSync(p, "utf8")),
  /** Comments and strings gone. For anything that reads an identifier. */
  body: withoutStrings(readFileSync(p, "utf8")),
}));

describe("the import scanner itself", () => {
  // §16 was a scanner that matched nothing. Its fix was a scanner that matched prose. Both are ways
  // of not checking what the claim says, so both directions are tested - the negative case first,
  // because that is the one that made the check vacuous for months.
  const scan = (text: string): string[] =>
    [
      ...withoutComments(text).matchAll(
        /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
      ),
      ...withoutComments(text).matchAll(/^[ \t]*import\s*["']([^"']+)["']/gm),
    ].map((m) => m[1] ?? "");

  it("finds a MULTI-LINE import, which the first anchored version missed", () => {
    // Found by injecting one and watching nothing fail. This is the form biome produces for any
    // multi-symbol import and the form most files in packages/core actually use - so the scanner
    // caught the tidy case and missed the common one.
    expect(scan('import {\n  readFileSync,\n} from "node:fs";')).toEqual(["node:fs"]);
    expect(scan('import { readFileSync }\n  from "node:fs";')).toEqual(["node:fs"]);
    expect(scan('export {\n  a,\n  b,\n} from "./types.js";')).toEqual(["./types.js"]);
  });

  it("finds a real import, which is the whole point and was broken until v1.0", () => {
    expect(scan(`import { readFileSync } from "node:fs";`)).toEqual(["node:fs"]);
    expect(scan(`import "./polyfill.js";`)).toEqual(["./polyfill.js"]);
    expect(scan(`export { x } from "./types.js";`)).toEqual(["./types.js"]);
    expect(scan(`import type { A } from "./a.js";`)).toEqual(["./a.js"]);
  });

  it("does not find one in prose", () => {
    // The false positive the §16 fix introduced. A scanner that cries wolf gets deleted, and a
    // deleted scanner is the vacuous one again.
    expect(scan('const m = `"${id}" is derived from "${from}", which is undeclared`;')).toEqual([]);
    expect(scan('throw new Error("this value came from "web" and is untrusted");')).toEqual([]);
  });

  it("does not find one in a comment", () => {
    expect(scan(`// import { x } from "node:fs" would break the contract`)).toEqual([]);
  });
});

describe("the pure core stays pure", () => {
  it("imports nothing at all", () => {
    // Zero dependencies, and no Node builtins either. The package must run identically in Node,
    // a browser, Deno, Bun, React Native and a Worker.
    for (const f of FILES) {
      // ANCHORED TO A STATEMENT, not to the word "from" anywhere.
      //
      // Fixing §16 meant scanning text with string literals INTACT, and the first version then
      // matched prose: `ingest.ts` builds an error message containing `is derived from "${from}"`,
      // which read as an import of the specifier `${from}`. A vacuous check became a noisy one, which
      // is a better failure and is still a wrong one - and a scanner that cries wolf gets deleted.
      //
      // So the pattern requires an `import`/`export` keyword before the `from`, on the same
      // statement. It also catches a bare side-effect `import "x"`, which the old pattern missed
      // entirely and which is the form most likely to smuggle in a polyfill.
      // ACROSS NEWLINES, and that correction matters more than the anchoring did.
      //
      // The first anchored version used `[^;\n]*?`, which stops at a newline - so it caught
      //     import { readFileSync } from "node:fs";
      // and MISSED
      //     import {
      //       readFileSync,
      //     } from "node:fs";
      // which is the form biome produces for any multi-symbol import and the form most files in this
      // package actually use. A scanner that catches the tidy case and misses the common one is §16
      // again with a smaller blast radius.
      //
      // `[^;]*?` spans newlines and stops at the statement terminator, so an `import` keyword cannot
      // reach past its own statement to borrow a `from` belonging to the next one.
      const specifiers = [
        ...f.imports.matchAll(/^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm),
        ...f.imports.matchAll(/^[ \t]*import\s*["']([^"']+)["']/gm),
      ].map((m) => m[1] ?? "");
      for (const s of specifiers) {
        expect(s.startsWith("./") || s.startsWith("../"), `${f.path} imports "${s}"`).toBe(true);
        expect(s.endsWith(".js"), `${f.path} imports "${s}" without a .js extension`).toBe(true);
      }
    }
  });

  it("touches no I/O-capable global", () => {
    const banned = [
      "fetch",
      "XMLHttpRequest",
      "WebSocket",
      "navigator",
      "window",
      "document",
      "localStorage",
      "TextEncoder",
      "Buffer",
      "process",
      "require",
      "globalThis",
      "crypto",
    ];
    for (const f of FILES) {
      for (const g of banned) {
        const hit = new RegExp(`\\b${g}\\b`).test(f.body);
        expect(hit, `${f.path} references the I/O-capable global "${g}"`).toBe(false);
      }
    }
  });

  it("reads no clock and generates no randomness", () => {
    // The gap a lib:ES2022 tsconfig cannot close. Time arrives as an argument or not at all.
    const banned = ["Date.now", "new Date", "Math.random", "performance.now", "setTimeout"];
    for (const f of FILES) {
      for (const g of banned) {
        expect(f.body.includes(g), `${f.path} uses "${g}"`).toBe(false);
      }
    }
  });

  it("is synchronous throughout", () => {
    // An async reducer cannot be exhaustively tested and cannot be called from a synchronous shell.
    for (const f of FILES) {
      for (const g of ["async ", "await ", "Promise"]) {
        expect(f.body.includes(g), `${f.path} uses "${g.trim()}"`).toBe(false);
      }
    }
  });

  it("keeps every threshold in policy.ts", () => {
    // Anti-drift, enforced. A taint level written down in the engine or the checker is a second
    // encoding of the policy, and second encodings drift - always in the loosening direction.
    const levels = ["CLEAN", "USER_CONTROLLED", "TOOL_DERIVED", "UNTRUSTED_EXTERNAL"];
    for (const f of FILES) {
      if (f.path.endsWith("policy.ts") || f.path.endsWith("types.ts")) continue;
      if (f.path.endsWith("taint.ts") || f.path.endsWith("check.ts")) continue;
      for (const l of levels) {
        expect(f.body.includes(l), `${f.path} hard-codes the taint level "${l}"`).toBe(false);
      }
    }
  });
});
