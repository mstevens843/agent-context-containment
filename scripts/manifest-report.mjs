#!/usr/bin/env node
import {
  DISHONEST_BINDINGS,
  HONEST_BINDINGS,
  POLICY_TABLES,
} from "../packages/conformance/dist/index.js";
// Validate every capability manifest in this repository, and diff each profile against the shipped
// table. See packages/core/src/manifest.ts for what validation can and cannot establish.
//
//   node scripts/manifest-report.mjs
import {
  CAPABILITY_POLICY,
  contradictions,
  diffPolicies,
  formatManifestFindings,
  formatPolicyDiff,
  formatToolRisks,
  semanticRisks,
  validatePolicy,
} from "../packages/core/dist/index.js";

const rule = "=".repeat(100);
console.log(rule);
console.log("capability manifests - structural validation, and what it cannot reach");
console.log(rule);

let bad = 0;
for (const [name, table] of POLICY_TABLES) {
  const findings = validatePolicy(table);
  const c = contradictions(findings).length;
  console.log(`\n  ${name}  -  ${c} contradiction(s), ${findings.length - c} suspicion(s)`);
  if (findings.length > 0)
    console.log(
      formatManifestFindings(findings)
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n"),
    );
  bad += c;
}

console.log("");
console.log(rule);
console.log("what each profile changes about the shipped table");
console.log(rule);
for (const [name, table] of POLICY_TABLES) {
  if (name === "reference") continue;
  console.log(`\n  ${name}`);
  console.log(
    formatPolicyDiff(diffPolicies(CAPABILITY_POLICY, table))
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n"),
  );
}
// ---- the semantic half -------------------------------------------------------------------------
console.log("");
console.log(rule);
console.log("tool bindings - advisory naming heuristics, on honest and dishonest examples");
console.log(rule);
for (const [label, b] of [
  ["HONEST bindings (10, five domains)", HONEST_BINDINGS],
  ["DISHONEST bindings (5, the lazy mistakes)", DISHONEST_BINDINGS],
]) {
  console.log(`\n  ${label}`);
  console.log(
    formatToolRisks(semanticRisks(b, CAPABILITY_POLICY), b.length)
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n"),
  );
}

console.log("");
console.log(rule);
console.log("  A manifest with no contradictions is CONSISTENT, not TRUE. On the imported");
console.log("  data-stealing split, declaring the send tool as read-only lets 32 of 32 attacks");
console.log("  through - and nothing in this report can see it, because nothing inside such a");
console.log("  declaration contradicts anything else inside it. See docs/CAPABILITY_MANIFESTS.md.");
console.log(rule);
process.exit(bad === 0 ? 0 : 1);
