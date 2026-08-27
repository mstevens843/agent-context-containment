#!/usr/bin/env node
// Delete the fix. See whether anything notices.
//
// THIS IS THE METHOD THAT CAUGHT DEFECT §15, made standing. The guard's "re-decide when it loses a
// receipt race" branch was graded PROVEN. Deleting the whole branch left 74 of 74 tests passing - the
// tests were sequential and the branch only runs in an interleaving no shipped store could produce.
// Nothing in this repository noticed: not the corpus checks, not the mutants, not the discrimination
// rule, not a prose guard written the same hour.
//
// What noticed was somebody deleting the code and re-running the suite. So that is now a command.
//
//   pnpm audit:mutations
//
// For each entry: patch the source, rebuild the package, run the named tests, and require them to
// FAIL. A mutation that survives is a claim with no test behind it. The file is restored either way,
// including on a crash - a half-applied mutation left in the tree would be far worse than the
// finding it was chasing.
//
// WHY THIS IS A SCRIPT AND NOT A TEST. Each entry needs a rebuild, so it costs seconds rather than
// milliseconds and cannot live in vitest. It runs in the release audit. `docs/claims.json` names the
// mutation each PROVEN claim relies on, and `claims.test.ts` fails if a PROVEN claim names one that
// does not exist here - so the two cannot drift apart silently.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;

/**
 * One deleted fix, and the tests that must miss it.
 *
 * `find` must match EXACTLY ONCE. An entry that matches zero times is a mutation that silently did
 * nothing and then "passed"; one that matches twice is a mutation nobody understands the scope of.
 * Both are refused before anything is patched.
 */
// NOTE ON QUOTING. Every `find` and `replace` below is a template literal even where nothing is
// interpolated, and `biome.json` turns off `noUnusedTemplateLiteral` for this file alone. These are
// not strings, they are EXACT SOURCE FIXTURES: a formatter that re-quoted them could change escaping
// or whitespace, the `find` would stop matching, and the guard above would report it as a zero-match
// entry. That is recoverable. What is not is a `find` that still matches after a subtle rewrite while
// meaning something slightly different.
const MUTATIONS = [
  {
    id: "guard-redecide",
    claim: "the guard re-decides when it loses a receipt race",
    package: "ledger",
    file: "packages/ledger/src/index.ts",
    find: `      if (lost.length === 0) return verdict;`,
    replace: `      if (lost.length >= 0) return verdict;`,
    tests: "packages/ledger",
    why: "defect §15: this survived in v0.9 and the claim was graded PROVEN anyway",
  },
  {
    id: "slot-binding",
    claim: "a label-only receipt matches nothing where the label identifies more than one argument",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `    } else if (!a.labelIsUnambiguous) {`,
    replace: `    } else if (false) {`,
    tests: "packages/core/test/argidentity.test.ts",
    why: "defect §11's class fix. Removing it restores the bug that admitted an argument nobody approved",
  },
  {
    id: "spend-reports-winner",
    claim: "spend says whether THIS call recorded it",
    package: "ledger",
    file: "packages/ledger/src/durable.ts",
    find: `    spend: (record) => (store.insertIfAbsent(record) === "inserted" ? "recorded" : "already_spent"),`,
    replace: `    spend: (record) => {
      store.insertIfAbsent(record);
      return "recorded";
    },`,
    tests: "packages/ledger",
    why: "defect §10: the store serialised correctly and the answer died at the interface",
  },
  {
    id: "receipt-value-binding",
    claim: "a receipt admits the value being used, not merely a value",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `      a.arg.value !== undefined &&
      r.admitted !== undefined &&
      String(r.admitted) !== a.arg.value
    ) {`,
    replace: `      false
    ) {`,
    tests: "packages/core",
    why: "the second, independent defence that made §11 only bite when `value` was omitted",
  },
  {
    id: "fail-closed-ceiling",
    claim: "an unrated steering role tightens rather than inheriting a permissive default",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `  if (!STEERING_ROLES.has(role)) return row.defaultCeiling;`,
    replace: `  if (true) return row.defaultCeiling;`,
    tests: "packages/core",
    why: "the rule that makes forgetting to rate a role safe. Mutant M1 was once rescued by it",
  },
  {
    id: "tuple-gate",
    claim: "two values admitted separately still need the combination ratified",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `    if (rolesCovered.size > 1) {`,
    replace: `    if (rolesCovered.size > 99) {`,
    tests: "packages/core",
    why: "an allowlisted destination plus an in-policy amount are two correct answers to two questions nobody asked together",
  },
  {
    id: "manifest-contradictions",
    claim: "validatePolicy rejects a manifest that contradicts itself",
    package: "core",
    file: "packages/core/src/manifest.ts",
    find: `  const known = new Set<string>(ALL_CAPABILITIES);`,
    replace: `  const known = new Set<string>(ALL_CAPABILITIES);
  if (Object.keys(policy).length >= 0) return out;`,
    tests: "packages/core/test/manifest.test.ts",
    why: "a validator that returns nothing passes every table, including the broken ones",
  },
  {
    id: "core-purity",
    claim: "the pure core has no non-relative imports",
    package: "core",
    // MUTATE THE SUBJECT, NOT THE TEST. The first version of this entry skipped the contract test
    // and expected a failure - which is incoherent, because a skipped test passes. It reported as
    // SURVIVED, correctly, and the finding was about my entry rather than about the code. Recorded
    // because "the check I wrote to catch unearned claims made an unearned claim" is exactly the
    // shape this whole script exists for.
    file: "packages/core/src/policy.ts",
    find: `import {`,
    replace: `import { readFileSync } from "node:fs";
void readFileSync;
import {`,
    tests: "packages/core/test/contract.test.ts",
    why: "the contract that keeps decide() replayable and auditable. An import here is the first step to a clock, a network call, or a decision that cannot be re-derived from a log",
  },

  // ---- v1.0.1: the three defects an outside reader found in one function -----------------------
  // All three were in `resolveTaint`/`ceilingFor` and none of them was reachable by any gate in
  // this repository, because no test and no corpus case ever declared a SOURCE with two parents.
  // See DEFECTS_FOUND.md sections 23 to 25.
  {
    id: "dag-path-scoped",
    claim:
      "a provenance DAG is resolved by path, so a node reached twice is not mistaken for a cycle",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `    stack.pop();
    onPath.delete(frame.id);
    settled = { taint: frame.taint, provenance: frame.provenance };
    memo.set(frame.id, settled);`,
    replace: `    stack.pop();
    settled = { taint: frame.taint, provenance: frame.provenance };`,
    tests: "packages/core/test/provenancedag.test.ts",
    why: "defect §23. Removing BOTH the unwind and the memo restores the exact shipped bug: one seen-set accumulating across siblings, so an all-SYSTEM diamond resolved to the top of the lattice. It failed closed, so this mutation cannot leak - it makes the engine refuse ordinary clean work, which is how a control gets switched off",
  },
  {
    id: "decide-is-total",
    claim: "decide() answers every input, including a malformed one, and never throws",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `function structuralFault(input: DecisionInput): string | undefined {`,
    replace: `function structuralFault(input: DecisionInput): string | undefined {
  if (input !== input || true) return undefined;`,
    tests: "packages/core/test/total.test.ts",
    why: "defect §24. The engine claimed in a source comment that it never throws, and nine of sixteen malformed shapes threw. The claim mattered: a caller whose policy engine crashes writes a try/catch, and that catch block is the bypass",
  },
  {
    id: "unknown-role-fails-closed",
    claim:
      "an unrecognised parameter role admits clean input only, rather than collecting the row's loosest ceiling",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `  if (!KNOWN_ROLES.has(role)) return "CLEAN";`,
    replace: `  if (!KNOWN_ROLES.has(role) && KNOWN_ROLES.size < 0) return "CLEAN";`,
    tests: "packages/core/test/total.test.ts",
    why: "defect §25, and the only one of the three that could ALLOW something. ceilingFor asked whether a role was in the STEERING set; a misspelling is not, so it fell through to defaultCeiling and a WEB-derived recipient on email_send became an ALLOW purely by mislabelling the argument",
  },
];

const run = (cmd, opts = {}) => {
  try {
    return {
      ok: true,
      out: execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: "pipe", ...opts }),
    };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

// ---- refuse to run at all on an ambiguous entry ------------------------------------------------
let bad = 0;
for (const m of MUTATIONS) {
  const src = readFileSync(ROOT + m.file, "utf8");
  const n = src.split(m.find).length - 1;
  if (n !== 1) {
    console.error(
      `  ${m.id}: its \`find\` matches ${n} times in ${m.file}; it must match exactly once.`,
    );
    console.error("    Zero means the mutation silently does nothing and then reports as caught.");
    bad++;
  }
}
if (bad > 0) {
  console.error(
    "\n  Refusing to run. Fix the entries above before trusting any result from this script.",
  );
  process.exit(2);
}

// ---- refuse to run on a tree that is not already green ------------------------------------------
// Without this the script is unreadable: a pre-existing failure makes EVERY mutation look "caught",
// because the tests were already failing. It cost real confusion once - a concurrent editor had left
// a change in the tree, two genuinely-protected branches reported as SURVIVED, and the numbers were
// meaningless in both directions.
//
// A mutation audit is a differential measurement. It needs a known starting point or it measures
// nothing.
console.log("=".repeat(96));
console.log("mutation audit - delete each fix, and require the tests to notice");
console.log("=".repeat(96));
console.log("");
process.stdout.write("  baseline: building and running the suite... ");
const base = run("pnpm -s build");
const baseTests = base.ok ? run("npx vitest run") : { ok: false, out: base.out };
if (!baseTests.ok) {
  console.log("NOT GREEN");
  console.error("");
  console.error("  Refusing to run. Every mutation would report as caught, because the tests are");
  console.error("  already failing - and the result would be meaningless in both directions.");
  const failing = [...baseTests.out.matchAll(/[×x]\s+(.+?)\s+\d+ms/g)].slice(0, 8).map((m) => m[1]);
  for (const f of failing) console.error(`    failing: ${f}`);
  process.exit(2);
}
console.log("green");
console.log("");

const survivors = [];
for (const m of MUTATIONS) {
  const path = ROOT + m.file;
  const original = readFileSync(path, "utf8");
  process.stdout.write(`  ${m.id.padEnd(26)}`);
  try {
    writeFileSync(path, original.replace(m.find, m.replace));
    // A build failure counts as CAUGHT: the mutation was rejected by the compiler, which is a real
    // check even though it is not a test. Recorded distinctly so the distinction stays visible.
    const built = run(`pnpm -s --filter @agent-context-containment/${m.package} build`);
    if (!built.ok) {
      console.log("caught (build)   the compiler rejected it");
      continue;
    }
    const tested = run(`npx vitest run ${m.tests}`);
    if (tested.ok) {
      console.log("SURVIVED         no test noticed");
      survivors.push(m);
    } else {
      const failed = (tested.out.match(/Tests\s+(\d+) failed/) ?? [])[1] ?? "?";
      console.log(`caught (tests)   ${failed} test(s) failed`);
    }
  } finally {
    writeFileSync(path, original);
  }
}

// Always leave the tree as we found it, and prove it rather than assuming.
process.stdout.write("\n  restoring and rebuilding... ");
const rebuilt = run("pnpm -s build");
const verify = run("npx vitest run");
console.log(
  rebuilt.ok && verify.ok
    ? "tree is green"
    : "TREE IS NOT GREEN - investigate before trusting anything above",
);

console.log("");
console.log("=".repeat(96));
if (survivors.length === 0) {
  console.log(
    `  ${MUTATIONS.length}/${MUTATIONS.length} mutations caught. Every fix listed here has a test that can fail.`,
  );
  console.log("");
  console.log(
    "  This is a floor, not a ceiling. It says these specific branches are defended; it says",
  );
  console.log(
    "  nothing about branches nobody thought to list, which is how §15 happened in the first",
  );
  console.log("  place. Adding an entry is part of closing a defect, not an afterthought.");
} else {
  console.log(
    `  ${survivors.length} MUTATION(S) SURVIVED. Each is a claim with no test behind it:`,
  );
  for (const m of survivors) {
    console.log(`\n    ${m.id} - ${m.claim}`);
    console.log(`      ${m.file}`);
    console.log(`      why it matters: ${m.why}`);
  }
  console.log("");
  console.log("  This is the §15 shape. Write the test before re-grading the claim.");
}
console.log("=".repeat(96));
process.exit(survivors.length === 0 && rebuilt.ok && verify.ok ? 0 : 1);
