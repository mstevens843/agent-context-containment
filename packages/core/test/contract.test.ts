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

/** Strip comments and string literals so a word in prose does not fail the build. */
const code = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

const FILES = sources(SRC).map((p) => ({ path: p, body: code(readFileSync(p, "utf8")) }));

describe("the pure core stays pure", () => {
  it("imports nothing at all", () => {
    // Zero dependencies, and no Node builtins either. The package must run identically in Node,
    // a browser, Deno, Bun, React Native and a Worker.
    for (const f of FILES) {
      const specifiers = [...f.body.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
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
