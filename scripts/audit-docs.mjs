#!/usr/bin/env node
// Documents, checked against the code that produces their numbers.
//
// Two different failures, and neither is caught by the other:
//
//   1. A TABLE goes stale. Fixed structurally by generated blocks - the number is owned by the
//      generator and a mismatch fails. Recurred FOUR times before this existed.
//   2. A SENTENCE overstates. A number in prose cannot live in a block without wrecking the writing,
//      so those are guarded by `claims.test.ts` (every numeric claim names its command) and by
//      `claims.test.ts`'s prose rules (no line asserts a freeze proof, optimality, and so on).
//
// This runs both, plus the one thing a guard can never establish about itself: that it can fail. It
// injects a false claim, confirms the guard catches it, and removes it. A guard nobody has seen fail
// is a guard nobody should trust - which is the whole of defect §15.
//
//   pnpm audit:docs

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const run = (cmd) => {
  try {
    return { ok: true, out: execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: "pipe" }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

console.log("=".repeat(96));
console.log("document audit - generated blocks, claim traceability, and a guard that can fail");
console.log("=".repeat(96));
console.log("");

let problems = 0;

process.stdout.write("  generated blocks match their generators    ");
const blocks = run("node scripts/generated-blocks.mjs --check");
console.log(blocks.ok ? "OK" : "STALE");
if (!blocks.ok) {
  problems++;
  console.log(
    blocks.out
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => `      ${l}`)
      .join("\n"),
  );
}

process.stdout.write("  claim registry rules                      ");
const registry = run("npx vitest run packages/conformance/test/claimregistry.test.ts");
console.log(registry.ok ? "OK" : "FAILED");
if (!registry.ok) problems++;

process.stdout.write("  no document overstates                    ");
const prose = run("npx vitest run packages/conformance/test/claims.test.ts");
console.log(prose.ok ? "OK" : "FAILED");
if (!prose.ok) problems++;

process.stdout.write("  classifier claims use classify()          ");
const clf = run("npx vitest run packages/conformance/test/classifierclaims.test.ts");
console.log(clf.ok ? "OK" : "FAILED");
if (!clf.ok) problems++;

// ---- the guard, guarded, ONE INJECTION PER RULE -------------------------------------------------
// The first version injected a single sentence and reported "the prose guard catches a false claim".
// It exercised ONE of five rules. An adversarial audit then showed that FOUR OF FIVE false claims
// sailed through - the negation test accepted a bare "no" anywhere in the paragraph, so "the policy
// is optimal and no further tuning is required" was exempt from the optimality rule.
//
// A control that covers one rule and reports on the guard is the §15 shape, inside the machinery
// built to prevent it. Every rule now gets its own injection, and a rule that cannot fire is named.
const INJECTIONS = [
  ["freeze", "The git-object freeze proof has been obtained, with no caveat."],
  ["optimality", "The reference policy is optimal and no further tuning is required."],
  ["manifest", "A validated manifest is an honest manifest, with no caveats needed."],
  ["postgres", "The Postgres async ledger is proven, with no conditions attached."],
  ["reviewer", "The review workflows prove human judgement, and no further evidence is needed."],
];

const readme = `${ROOT}README.md`;
const original = readFileSync(readme, "utf8");
const missed = [];
process.stdout.write("  every prose rule can actually fire       ");
try {
  for (const [name, sentence] of INJECTIONS) {
    writeFileSync(readme, `${original}\n\n${sentence}\n`);
    if (run("npx vitest run packages/conformance/test/claims.test.ts").ok) missed.push(name);
  }
} finally {
  writeFileSync(readme, original);
}
console.log(
  missed.length === 0 ? ` OK (${INJECTIONS.length}/${INJECTIONS.length})` : " INCOMPLETE",
);
if (missed.length > 0) {
  problems++;
  for (const name of missed) {
    console.log(`      the "${name}" rule did NOT fire on a false claim aimed straight at it`);
  }
  console.log(
    "      A guard with a rule that cannot fire is worse than no rule: it reports coverage.",
  );
}

console.log("");
console.log("=".repeat(96));
if (problems === 0) {
  console.log(
    "  Documents agree with the code that produces their numbers, and the guard can fail.",
  );
  console.log("");
  console.log(
    "  What this does NOT cover: a claim nobody put in docs/claims.json, and a number in a",
  );
  console.log(
    "  sentence that no generator produces. Both are still prose, and prose is checked by",
  );
  console.log("  people. See docs/ADVERSARIAL_AUDIT.md.");
} else {
  console.log(
    `  ${problems} problem(s). A stale number is not cosmetic - it is a claim nobody re-checked.`,
  );
}
console.log("=".repeat(96));
process.exit(problems === 0 ? 0 : 1);
