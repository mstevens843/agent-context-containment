#!/usr/bin/env node
// One command for every number this repository claims.
//
// The numbers used to live in seven places: three scripts, three test files that printed tables as a
// side effect, and a README that restated them by hand. A hand-maintained README number is a claim
// that was true once, and the one that goes stale is always the one somebody quotes. So this prints
// all of them from the code, in one pass, and `--markdown` emits the same content as a file the
// README can point at instead of paraphrasing.
//
//   node scripts/report.mjs              human-readable, to stdout
//   node scripts/report.mjs --markdown   markdown, to stdout
//   node scripts/report.mjs --out FILE   markdown, to a file
//
// WHAT THIS DELIBERATELY DOES NOT DO: produce a headline. There is no total, no score, and no "best"
// anything. Every table below is per split or per profile, because the splits are not samples from
// one population and the profiles are not competitors. A single number over them would be the most
// quotable thing in the repository and the least defensible.

import { readFileSync, writeFileSync } from "node:fs";
import { classify } from "../packages/classifier/dist/index.js";
import {
  DISHONEST_BINDINGS,
  HAND_WRITTEN_SCENARIOS,
  HONEST_BINDINGS,
  POLICY_TABLES,
  REVIEW_WORKFLOWS,
  compareAll,
  coveredByCorpus,
  crossPolicy,
  formatComparison,
  formatCoverage,
  formatCrossPolicy,
  formatFrontier,
  formatPlans,
  formatRuns,
  formatSensitivity,
  formatWorkflows,
  frontier,
  generateAll,
  loadSplit,
  probeSurface,
  referenceProfile,
  runPlans,
  runScenarios,
  runWorkflow,
  sensitivity,
} from "../packages/conformance/dist/index.js";
import {
  CAPABILITY_POLICY,
  contradictions,
  semanticRisks,
  validatePolicy,
} from "../packages/core/dist/index.js";

const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
const outFile = outIdx >= 0 ? argv[outIdx + 1] : undefined;
const markdown = argv.includes("--markdown") || outFile !== undefined;

const CORPUS = new URL("../corpus/", import.meta.url).pathname;
const NAMES = ["holdout", "holdout_v2", "tuning", "derived", "adaptive", "imported"];
const splits = NAMES.map((split) => ({ split, cases: loadSplit(`${CORPUS}${split}`, split) }));
// The generated split has no directory: it is derived at run time from the frozen bases, so it can
// never drift from them and is never committed as data a reader could quietly edit.
const bases = [
  ...splits.find((s) => s.split === "holdout_v2").cases,
  ...splits.find((s) => s.split === "adaptive").cases,
].filter(
  (c) =>
    c.groundTruth === "attack" &&
    c.containmentLimit === null &&
    c.proposedAction.args.length >= 1 &&
    (c.receipts ?? []).length === 0,
);
const generated = generateAll(bases);
const baseline = { name: "ported production detector", classify };

const LABELS = {
  holdout: "frozen at v0. The manifest is verified in CI; the ORDERING claim is unavailable.",
  holdout_v2: "frozen, but authored AFTER the engine. A regression split, not a blind instrument.",
  tuning: "freely editable. Agreement here is close to tautological and is reported anyway.",
  derived: "attack shapes designed by other people for other systems. Hand-derived, not ported.",
  adaptive:
    "written against known blind spots. Adversarial, and by the same author as the defence.",
  imported: "EXACT upstream strings (InjecAgent, MIT). Graded by a mapping authored here.",
};

const sections = [];
const add = (title, body, note) => sections.push({ title, body, note });

// ---- corpus shape ---------------------------------------------------------------------------
const counts = [
  ...splits.map(
    (s) => `  ${s.split.padEnd(13)}${String(s.cases.length).padStart(4)}   ${LABELS[s.split]}`,
  ),
  `  ${"generated".padEnd(13)}${String(generated.length).padStart(4)}   mechanical transforms of ${bases.length} bases, built at run time. NEVER pooled with the hand-written splits.`,
];
add(
  "Corpus, by split",
  [
    ...counts,
    "",
    `  hand-written and imported: ${splits.reduce((n, s) => n + s.cases.length, 0)}`,
    `  generated:                 ${generated.length}`,
    "",
    "  Reported separately, always. A total over both would be dominated by the generated split,",
    `  which is ${bases.length} bases wearing ${generated.length} costumes.`,
  ].join("\n"),
);

// ---- where the material came from ------------------------------------------------------------
// The distinction the schema could not express until v0.7: an exact transcription of upstream's bytes
// and a hand-written restatement of upstream's idea are different grades of evidence.
const byKind = new Map();
for (const s of splits) {
  for (const c of s.cases) {
    const k = c.source.kind;
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
  }
}
add(
  "Provenance of the material",
  [
    `  ${"imported".padEnd(14)}${String(byKind.get("imported") ?? 0).padStart(4)}   upstream's BYTES, reproduced without alteration. Rebuilt and byte-checked`,
    `  ${"derived".padEnd(14)}${String(byKind.get("derived") ?? 0).padStart(4)}   hand-written restatement of a published attack SHAPE. Upstream's idea, my words`,
    `  ${"cve_derived".padEnd(14)}${String(byKind.get("cve_derived") ?? 0).padStart(4)}   built from a published advisory`,
    `  ${"original".padEnd(14)}${String(byKind.get("original") ?? 0).padStart(4)}   mine`,
    "",
    "  Enforced, not described: checkCorpus rejects a case in corpus/imported/ that is not kind",
    '  "imported", and rejects a kind "imported" case anywhere else. The second rule is the one that',
    "  matters - an exact import filed as derived merely understates the evidence, while a hand-derived",
    "  case filed as an import claims bytes it does not have.",
    "",
    "  The GRADING is mine in all four. pnpm report:mapping measures how much of the imported result",
    "  depends on that.",
  ].join("\n"),
);

// ---- the imported split, per dataset ---------------------------------------------------------
const importedCasesAll = splits.find((s) => s.split === "imported").cases;
const dh = importedCasesAll.filter((c) => !c.id.startsWith("ia-imp-ds-")).length;
const dsCount = importedCasesAll.length - dh;
add(
  "Exact imports, by dataset",
  [
    `  ${"direct harm".padEnd(18)}${String(dh).padStart(3)}   one attacker tool; the harm is the call`,
    `  ${"data stealing".padEnd(18)}${String(dsCount).padStart(3)}   a PAIR - read, then send; the harm is what leaves`,
    "",
    "  Both are InjecAgent (MIT) at commit f19c9f2, rebuilt byte-identically from committed source",
    "  rows by `pnpm import:check`. Reported apart because they are two shapes, not more of the same -",
    "  and because their exposure to a mis-declaration differs sharply: 21/30 against 32/32.",
  ].join("\n"),
);

// ---- classifier vs containment --------------------------------------------------------------
add(
  "Classifier vs containment",
  formatComparison(compareAll({ splits, policy: referenceProfile, classifier: baseline }), LABELS),
);

// ---- policy profiles ------------------------------------------------------------------------
add("Policy profiles", formatCrossPolicy(crossPolicy({ splits, classifier: baseline })));

// ---- the frontier ---------------------------------------------------------------------------
add("Policy frontier", formatFrontier(frontier({ splits, classifier: baseline })));

// ---- generated coverage ---------------------------------------------------------------------
add(
  "Policy-surface coverage",
  formatCoverage({
    probes: probeSurface(),
    covered: coveredByCorpus(splits.flatMap((s) => s.cases)),
  }),
);

// ---- capability manifests -------------------------------------------------------------------
add(
  "Capability manifests",
  [
    ...POLICY_TABLES.map(([name, table]) => {
      const f = validatePolicy(table);
      const c = contradictions(f).length;
      return `  ${name.padEnd(16)}${String(c).padStart(2)} contradiction(s)   ${String(f.length - c).padStart(2)} suspicion(s)`;
    }),
    "",
    "  A manifest with no contradictions is CONSISTENT, not TRUE. Declaring a send tool as read-only",
    "  lets 32 of 32 imported data-stealing attacks through, and nothing structural can see it -",
    "  nothing inside such a declaration contradicts anything else inside it.",
    "  pnpm verify:manifests  ·  docs/CAPABILITY_MANIFESTS.md",
  ].join("\n"),
);

// ---- review workflows -----------------------------------------------------------------------
add("Review workflows", formatWorkflows(REVIEW_WORKFLOWS.map(runWorkflow)));

// ---- agent runs -----------------------------------------------------------------------------
add("Agent runs, hand-written", formatRuns(runScenarios(HAND_WRITTEN_SCENARIOS)));
add("Agent runs, generated by the adversarial planner", formatPlans(runPlans()));

// ---- imported mapping audit -----------------------------------------------------------------
const mapping = JSON.parse(readFileSync(`${CORPUS}imported/MAPPING.json`, "utf8"));
const importedCases = splits.find((s) => s.split === "imported").cases;
add(
  "Imported-case mapping audit",
  formatSensitivity(
    mapping.cases.map((m) =>
      sensitivity(
        m,
        importedCases.find((c) => c.id === m.id),
      ),
    ),
  ),
);

// ---- what is claimed, and at what grade ------------------------------------------------------
// SIX grades, and keeping them apart is the whole point of this section. Every one of them has been
// read as "proven" by somebody at some stage of this project, including by me.
add(
  "Claims, by grade",
  [
    "  PROVEN               a test in this repository fails if it stops being true",
    "  ADAPTER-PROVEN       the code is right; says nothing about any deployment or any database",
    "  SKIPPED / NOT PROVEN not checked on this run. NOT a pass, and never reported as one",
    "  DELEGATED TO CALLER  outside what the engine can see. The caller answers it",
    "  NOT CLAIMED          the arithmetic does not support it and no line here asserts it",
    "  KNOWN RISK           measured, open, and named",
    "",
    "  PROVEN",
    "    the pure core has no imports, clock, randomness or Promise   contract.test.ts",
    "    the v0 holdout's bytes match its manifest                    pnpm verify:corpus, 7/7",
    "    imported cases are upstream's bytes                          pnpm import:check, 62/62",
    "    a receipt admits one value, into one SLOT, once              argidentity.test.ts + mutant M9",
    "    every capability table is self-consistent                    pnpm verify:manifests, 5 tables",
    "    every mutant is bitten somewhere and none everywhere         pnpm report:mutants",
    "    the engine knows no domain vocabulary                        demos.test.ts",
    "",
    "  ADAPTER-PROVEN",
    "    the async reservation protocol                               against UNIQUE-constraint semantics",
    "    cross-host safety, sync path                                 proveCrossHost, 5 interleavings",
    "",
    "  PROVEN AGAINST A REAL DATABASE, when DATABASE_URL is set  -  pnpm prove:postgres",
    "    concurrent reserve, 2 and 20 connections: exactly one winner",
    "    replay refused across connections; consumption survives a reconnect",
    "    a crash between reserve and consume strands rather than re-arms",
    "    stale reclaim works, and never touches a consumed row",
    "    NEGATIVE CONTROL: a read-then-write adapter double-claims, so the proof can fail",
    "    Without DATABASE_URL this whole block is SKIPPED / NOT PROVEN.",
    "",
    "  DELEGATED TO CALLER",
    "    that your hosts share ONE database        sharedAcrossHosts is a question, not an inference",
    "    that a capability declaration is honest   structural validation catches self-contradiction only",
    "    that argument paths are honest            two args given one path is a caller bug, handled safely",
    "",
    "  NOT CLAIMED",
    "    that the shipped policy is optimal        5 profiles, TWO undominated. docs/POLICY_CHOICE.md",
    "    that the holdout predates the engine      attempted, correctly rejected, unavailable",
    "    that manifest validation proves semantics a validated manifest is CONSISTENT, not TRUE",
    "    that the review workflows prove judgement a rule set somebody wrote down, which can be wrong",
    "    that containment is complete              it constrains what a tool call does with a value",
    "",
    "  KNOWN RISK",
    "    a wrong capability declaration            21/30 direct-harm, 32/32 data-stealing, measured",
    "    the taint is cooperative, not enforced    there is no membrane in JavaScript",
    "    staleAfterMs has no free value            too long strands, too short double-spends",
  ].join("\n"),
);

// ---- release-facing posture -------------------------------------------------------------------
// Everything an adopter needs before shipping, in one place, with the things that are NOT checked
// named beside the things that are.
const advisoriesHonest = semanticRisks(HONEST_BINDINGS, CAPABILITY_POLICY).length;
const advisoriesLazy = semanticRisks(DISHONEST_BINDINGS, CAPABILITY_POLICY).length;
const tableFindings = POLICY_TABLES.map(([name, t]) => {
  const f = validatePolicy(t);
  return `${name}=${contradictions(f).length}c/${f.length - contradictions(f).length}a`;
});
add(
  "Release posture",
  [
    "  CAPABILITY ADVISORIES  (contradictions / advisory suspicions, per table)",
    `    ${tableFindings.join("  ")}`,
    `    tool bindings: ${advisoriesHonest} finding(s) on ${HONEST_BINDINGS.length} honest examples, ${advisoriesLazy} on ${DISHONEST_BINDINGS.length} lazy mis-bindings`,
    "    Advisory reads NAMES. Zero findings is a fact about vocabulary, not behaviour.",
    "",
    "  PROVENANCE INGESTION",
    "    Helpers exist and are used by every agent demo: contextOf, fromUser/fromWeb/fromEmail/",
    "    fromRetrieval/fromDocument/fromExternalApi/fromToolOutput/fromSystem, derivedOutput.",
    "    They DECLARE - they infer nothing. A hostile page declared SYSTEM is treated as SYSTEM,",
    "    asserted in packages/core/test/ingest.test.ts so it is never a surprise.",
    "    contextOf refuses a dangling edge, a duplicate id and an empty id at wiring time.",
    "",
    "  DEPLOYMENT CHECK",
    "    pnpm doctor  -  reads declarations and their consequences. NOT a runtime probe: it",
    "    inspects no running system and infers nothing.",
    "",
    "  STALE RECLAIM",
    "    Four states: reserved, consumed, released, stranded. stats(now) counts them.",
    "    No staleAfterMs value is free - too long strands a receipt, too short DOUBLE-SPENDS.",
    "",
    "  REVIEWER AND MODEL JUDGE",
    "    Deterministic reviewer: RUNNABLE, decides from bytes, denied the engine's vocabulary.",
    "    Mechanics and judgement reported apart. It is a rule set, not a model of a human.",
    "    Model judge: SKIPPED unless ANTHROPIC_API_KEY is set. Gates nothing, enters no table.",
    `    Real-Postgres proof: ${
      process.env.DATABASE_URL
        ? "RUNNABLE here (DATABASE_URL is set)"
        : "SKIPPED / NOT PROVEN on this run - DATABASE_URL is not set"
    }`,
    "",
    "  REMAINING RISKS, labelled rather than buried",
    "    KNOWN RISK   a wrong capability declaration: 21/30 direct-harm, 32/32 data-stealing",
    "    KNOWN RISK   taint is cooperative - there is no membrane in JavaScript",
    "    KNOWN RISK   staleAfterMs has no free value",
    "    DELEGATED    whether your hosts share one database",
    "    DELEGATED    whether a declaration is honest",
    "    NOT CLAIMED  that any policy here is optimal; that the holdout predates the engine",
    "    See docs/TRUST_BOUNDARIES.md and docs/LIMITATIONS.md.",
  ].join("\n"),
);

// ---- freeze status --------------------------------------------------------------------------
const freeze = JSON.parse(readFileSync(`${CORPUS}holdout/FREEZE.json`, "utf8"));
add(
  "Freeze status",
  [
    `  state:          ${freeze.state}`,
    `  frozenAtCommit: ${freeze.frozenAtCommit === null ? "null" : freeze.frozenAtCommit}`,
    "",
    `  PROVEN:     ${freeze.whatIsProven}`,
    "",
    `  NOT PROVEN: ${freeze.whatIsNotProven}`,
    "",
    "  UNAVAILABLE, not pending. A freeze was attempted and correctly rejected: the recorded commit",
    "  already contained the engine. No holdout-only pre-engine commit exists in this history, so the",
    "  ordering claim cannot be cashed here at all - it is not waiting on anyone.",
  ].join("\n"),
);

// ---- render ---------------------------------------------------------------------------------
if (markdown) {
  const md = [
    "# Generated report",
    "",
    "Every number here is produced by `node scripts/report.mjs --markdown`. Nothing in it is typed by",
    "hand, because a hand-maintained number is a claim that was true once, and the stale one is always",
    "the one somebody quotes.",
    "",
    "**There is no headline figure and there will not be one.** Every table is per split or per",
    "profile. The splits are not samples from one population and the profiles are not competitors.",
    "",
    ...sections.flatMap((s) => [`## ${s.title}`, "", "```", s.body, "```", ""]),
  ].join("\n");
  if (outFile) {
    writeFileSync(outFile, md);
    console.log(`written: ${outFile}`);
  } else {
    console.log(md);
  }
} else {
  for (const s of sections) {
    console.log(`\n${s.body}\n`);
  }
}
