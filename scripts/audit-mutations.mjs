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
    tests: "packages/core/test/provenancedag.test.ts packages/conformance/test/adversary.test.ts",
    why: "defect §23. Named alongside the property search on purpose: the hand-written diamond tests pin the shape somebody thought of, and the search finds it in the hundreds without being told what to look for. Removing BOTH the unwind and the memo restores the exact shipped bug: one seen-set accumulating across siblings, so an all-SYSTEM diamond resolved to the top of the lattice. It failed closed, so this mutation cannot leak - it makes the engine refuse ordinary clean work, which is how a control gets switched off",
  },
  {
    id: "decide-is-total",
    claim: "decide() answers every input, including a malformed one, and never throws",
    package: "core",
    file: "packages/core/src/policy.ts",
    // NEUTRALISED AT THE CALL SITE, not inside the function. The original inserted an early
    // return at the top of `structuralFault`, and the §32 receipts loop added below it made
    // TypeScript widen `input.receipts` in the now-unreachable code - so the mutation stopped
    // COMPILING and the audit reported `caught (build)` while never running a single test,
    // under a summary line that says every fix here has a test that can fail. A mutation that
    // cannot compile proves nothing. See DEFECTS_FOUND.md §33.
    find: `  const fault = structuralFault(input);`,
    replace: `  const fault: string | undefined = undefined;
  void structuralFault;`,
    tests: "packages/core/test/total.test.ts packages/conformance/test/malformed.test.ts",
    why: "defect §24. The property search was cited for this and could not reach it - its generator only emits well-formed inputs - which is §31. `malformed.test.ts` reaches it, 3,376 findings at 8k iterations. The engine claimed in a source comment that it never throws, and nine of sixteen malformed shapes threw. The claim mattered: a caller whose policy engine crashes writes a try/catch, and that catch block is the bypass",
  },
  {
    id: "unknown-role-fails-closed",
    claim:
      "an unrecognised parameter role admits clean input only, rather than collecting the row's loosest ceiling",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `  if (!KNOWN_ROLES.has(role)) return "CLEAN";`,
    replace: `  if (!KNOWN_ROLES.has(role) && KNOWN_ROLES.size < 0) return "CLEAN";`,
    tests: "packages/core/test/total.test.ts packages/conformance/test/adversary.test.ts",
    why: "defect §25, now genuinely reached by the property search: the ceiling is derived by `oracleCeiling` rather than by importing `ceilingFor`, so a bug inside that function no longer moves both sides. 2,564 findings at 8k iterations, where the first version found zero. and the only one of the three that could ALLOW something. ceilingFor asked whether a role was in the STEERING set; a misspelling is not, so it fell through to defaultCeiling and a WEB-derived recipient on email_send became an ALLOW purely by mislabelling the argument",
  },
  {
    id: "coercion-is-a-tripwire",
    claim: "coercing a Tainted throws rather than silently producing the string [object Object]",
    package: "core",
    file: "packages/core/src/taint.ts",
    find: `    [Symbol.toPrimitive]: (hint: string): never => {`,
    replace: `    [Symbol.toPrimitive]: (hint: string): never => {
      if (hint !== "never-a-real-hint") return "[object Object]" as unknown as never;`,
    tests: "packages/core/test/taint.test.ts",
    why: "not a security fix, and recorded as one anyway. Interpolating a tainted value never leaked it - it produced [object Object] - so this closes the WRONG FAILURE rather than a hole: a developer got a plausible string and no signal, and found out much later. The tripwire does not make the label survive a coercion, because a coercion returns a primitive and a primitive cannot carry one",
  },
  {
    id: "receipt-elements-validated",
    claim: "a receipts array whose ELEMENTS are not objects is denied rather than dereferenced",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `      if (typeof receipt !== "object" || receipt === null) {`,
    replace: `      if (typeof receipt !== "object" || receipt === null ? false : false) {`,
    tests: "packages/conformance/test/malformed.test.ts",
    why: "defect §32, and the reason the malformed search was worth building. The structural gate added for §24 checked `sources` and `args` element by element and stopped at `Array.isArray` for receipts, so `receipts: [null]` reached `coverFor` and threw on `argPath`. A gate written to make the engine total that was itself not total, found on the first run of the search that could see it",
  },
  {
    id: "receipt-one-slot",
    claim: "one receipt admits at most one argument of an action",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `    if (usedReceipts.has(r.id)) {`,
    replace: `    if (usedReceipts.has(r.id) && false) {`,
    tests: "packages/conformance/test/receiptadversary.test.ts",
    why: "§20 filed this branch (P05) as UNREACHABLE and kept it as defence in depth, on the strength of a sweep that reached it zero times. It is reachable: a two-argument action carrying one receipt id reaches it directly, and deleting it produces 1232 findings in the receipt search. Until that search existed the branch was guarded by nothing - the whole suite stayed green without it. See §34",
  },
  {
    id: "slot-collision-suffixing",
    claim: "two arguments declaring the same explicit path get distinct slots",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: "    let unique = slot;\n    let n = 0;\n    while (used.has(unique)) unique = `${slot}#${++n}`;",
    replace:
      "    let unique = slot;\n    let n = 0;\n    while (used.has(unique) && false) unique = `${slot}#${++n}`;",
    tests: "packages/conformance/test/receiptadversary.test.ts",
    why: 'Rule 4 of `slotsOf` is what makes the slot model total: without it two arguments declaring path "p" collide, and one receipt covers both. The `duplicate_path` shape existed to watch this and could not - it issued ONE receipt, so the second argument went uncovered and the action was DENIED whether or not the suffixing ran, and deleting rule 4 produced zero findings. With a receipt per slot it produces 544 over_block findings. See §37',
  },
  // ---- the receipt-binding branches, each measured by deletion in section 37 --------------------
  //
  // WHY THEY ARE ENTRIES AND NOT A TABLE. Section 37 published findings counts for ten branches of
  // `coverFor`. Four already had entries; the other six were numbers taken once and never re-derived,
  // which is exactly the state the mis-declaration figures were in before section 30 and the robust
  // figures before section 38. A measurement nothing re-runs is a claim, not evidence.
  //
  // Each names `receiptadversary.test.ts`, which goes red on findings > 0. The counts are NOT
  // repeated in the `why` text: the audit proves the branch is watched, and section 37's table - with
  // its seed and iteration count - is the one place the magnitudes live.
  {
    id: "receipt-label-binding",
    claim: "a label-only receipt admits only the argument whose name it carries",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `    } else if (r.argName !== a.arg.name) {`,
    replace: `    } else if (false) {`,
    tests: "packages/conformance/test/receiptadversary.test.ts",
    why: "The fallback half of slot matching, and distinct from `slot-binding`, which guards the AMBIGUOUS-label branch above it. With this deleted a receipt naming any label admits any argument of the action. Section 36 found the `wrong_name` shape was a second copy of `wrong_slot` and reached this branch zero times; it now reaches it. See §36 and §37",
  },
  {
    id: "receipt-expiry",
    claim: "an expired receipt admits nothing",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `    if (now !== undefined && r.scope?.expiresAt != null && now > r.scope.expiresAt) {`,
    replace: `    if (now !== undefined && r.scope?.expiresAt != null && now > Number.MAX_SAFE_INTEGER) {`,
    tests: "packages/conformance/test/receiptadversary.test.ts",
    why: "A scope with an expiry that is never enforced is a scope. Section 34 named expiry as one of three branches a search reached for the first time, and it is the one whose figure was least reproducible - it was published with no seed and re-measured in §37",
  },
  {
    id: "receipt-role-binding",
    claim: "a receipt issued for one role does not admit an argument in another",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `    if (r.capability !== capability || r.role !== a.arg.role) {`,
    replace: `    if (r.capability !== capability) {`,
    tests: "packages/conformance/test/receiptadversary.test.ts",
    why: "HALF a condition, deliberately: the capability check stays and only the role check goes, so this cannot be satisfied by any test that merely notices a cross-capability receipt. Section 33 measured that this half was caught by `unguarded.test.ts` alone, which row 14 did not name",
  },
  {
    id: "receipt-source-binding",
    claim: "a receipt bound to a source does not admit an argument that source did not feed",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `    if (r.scope?.source != null && !a.arg.derivedFrom.includes(r.scope.source)) {`,
    replace: `    if (r.scope?.source != null && a.arg.derivedFrom.includes(r.scope.source)) {`,
    tests: "packages/conformance/test/receiptadversary.test.ts",
    why: "INVERTED rather than disabled, so the branch still runs and still costs a lookup - a mutation that deletes a condition can be caught by a coverage tool, and one that reverses it cannot. The source binding is what stops a receipt issued against a trusted feed admitting a value that arrived from somewhere else",
  },
  {
    id: "receipt-lift-level",
    claim: "a receipt admits nothing above the taint it lifts to",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `    if (!taintAtMost(a.taint, r.lifts)) {`,
    replace: `    if (!taintAtMost(a.taint, r.lifts) && false) {`,
    tests: "packages/conformance/test/receiptadversary.test.ts",
    why: "The lattice half of admission: a receipt that lifts to TOOL_DERIVED must not admit an UNTRUSTED_EXTERNAL value. Section 36 measured that NO shape covered this - one hand-written test carried the whole branch - and added `lifts_too_low` to reach it",
  },
  {
    id: "receipt-rule-liftable",
    claim: "a receipt admits nothing under a rule its capability row does not lift by",
    package: "core",
    file: "packages/core/src/policy.ts",
    find: `    if (!row.liftableBy.has(r.rule)) {`,
    replace: `    if (!row.liftableBy.has(r.rule) && false) {`,
    tests: "packages/conformance/test/receiptadversary.test.ts",
    why: "The row decides which rules can lift it at all, and this is where that decision is enforced. It is also the branch that made the receipt search vacuous on its first run - every generated receipt used a rule `web_fetch` does not accept, so nothing was ever admitted while the report read as broad coverage. See §34",
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
