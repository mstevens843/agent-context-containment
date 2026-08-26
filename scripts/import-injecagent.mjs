#!/usr/bin/env node
// Rebuild corpus/imported/injecagent.json from pinned upstream source rows.
//
// WHY THIS EXISTS. v0.6 claimed "exact upstream strings, byte for byte", and that claim rested on my
// having pasted them carefully. That is not nothing, and it is not checkable: a reader has no way to
// tell a faithful transcription from a helpful one, and neither do I six months later. So the source
// rows are committed alongside the cases, the composition rule is code, and a test asserts the
// rebuild is byte-identical to what ships. If I ever "improve" an imported string, the rebuild
// diverges and the build fails.
//
//   node scripts/import-injecagent.mjs --check    verify both committed splits match (what CI runs)
//   node scripts/import-injecagent.mjs --write    regenerate them
//
// TWO DATASETS, kept apart. `dh` is upstream's direct-harm half: one attacker tool, and the harm is
// the call. `ds` is the data-stealing half: a PAIR of tools - read, then send - and the harm is what
// leaves. Same repository, same commit, same licence, same composition rule, different attack shape.
// Merging them would let 34 cases read as 34 independent attacks when they are two shapes with
// seventeen instances each.
//
// WHAT IS AND IS NOT AUTOMATED. Composition IS: upstream's own rule is to substitute the Attacker
// Instruction at the `<Attacker Instruction>` placeholder in a user case's Tool Response Template,
// and that is four lines of code. GRADING IS NOT, and cannot be: upstream has no provenance model and
// no capability table, so nothing in their data says which capability an attack maps to or what the
// right decision is. Those come from corpus/imported/MAPPING.json, which is mine and is audited
// separately. See docs/IMPORT_PROCESS.md.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const HERE = new URL("../corpus/imported/", import.meta.url).pathname;
const mode = process.argv.includes("--write") ? "write" : "check";
let failures = 0;

const jsonl = (name) =>
  readFileSync(`${HERE}source/${name}`, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));

/**
 * Upstream's composition rule, verbatim in behaviour: the attacker instruction replaces the
 * `<Attacker Instruction>` placeholder in the user case's Tool Response Template. Nothing is
 * trimmed, escaped, re-quoted or tidied - the single-quoted Python-dict look of these strings is
 * upstream's and is preserved exactly, because "we cleaned it up a bit" is how an exact import stops
 * being one.
 */
const compose = (userCase, attackerCase) => {
  const template = userCase["Tool Response Template"];
  const PLACEHOLDER = "<Attacker Instruction>";
  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`user case ${userCase["User Tool"]} has no ${PLACEHOLDER} to substitute into`);
  }
  return template.replace(PLACEHOLDER, attackerCase["Attacker Instruction"]);
};

const DATASETS = [
  {
    key: "dh",
    mappingFile: "MAPPING.json",
    outFile: "injecagent.json",
    attackerFixture: "attacker_cases.jsonl",
    refLabel: "attacker_cases_dh.jsonl",
    title: (attacker, user) =>
      `InjecAgent ${attacker["Attack Type"]}: a ${user["User Tool"]} response carries an attacker instruction`,
    modifications: (m, attacker) =>
      `EXACT IMPORT of upstream case CONTENT. The user instruction and the tool response are byte-for-byte what InjecAgent ships, composed by upstream's own documented rule: the Attacker Instruction substituted into the user case's Tool Response Template at its <Attacker Instruction> placeholder. Selection is mechanical - every pairable row in the pinned fixture - so it cannot have been chosen to flatter the engine. Rebuilt and byte-checked by scripts/import-injecagent.mjs. WHAT IS OURS AND MUST NOT BE ATTRIBUTED UPSTREAM: the provenance labels, the capability mapping (${attacker["Attack Type"]} -> ${
        m.cases.find((c) => c.upstream.attackType === attacker["Attack Type"]).ourMapping.capability
      }), the argument role, and the expected decision. InjecAgent scores whether an agent CALLS the attacker tool; this scores whether a policy would PERMIT the call. Different questions over identical bytes.`,
  },
  {
    key: "ds",
    mappingFile: "MAPPING_DS.json",
    outFile: "injecagent_ds.json",
    attackerFixture: "attacker_cases_ds.jsonl",
    refLabel: "attacker_cases_ds.jsonl",
    title: (attacker, user) =>
      `InjecAgent data stealing (${attacker["Attack Type"]}): a ${user["User Tool"]} response asks for ${attacker["Attacker Tools"].join(" then ")}`,
    modifications: (_m, attacker) =>
      `EXACT IMPORT of upstream case CONTENT, from InjecAgent's DATA-STEALING half. The user instruction and the tool response are byte-for-byte what upstream ships, composed by upstream's own rule. Every row is a two-step chain (${attacker["Attacker Tools"].join(" -> ")}): a read, then a send. Selection is mechanical - attacker rows paired by index with the user rows - so it cannot have been chosen to flatter the engine. WHAT IS OURS AND MUST NOT BE ATTRIBUTED UPSTREAM: the provenance labels, the capability (email_send, read off upstream's own second tool rather than inferred), the argument role, the expected decision, and the decision to model only the SEND step. See corpus/imported/MAPPING_DS.json.`,
  },
];

const buildOne = (ds) => {
  const attackers = jsonl(ds.attackerFixture);
  const users = jsonl("user_cases.jsonl");
  const mapping = JSON.parse(readFileSync(`${HERE}${ds.mappingFile}`, "utf8"));
  const COMMIT = mapping.upstream.commit;

  const cases = mapping.cases.map((m) => {
    const aLine = m.upstream.attackerCaseLine;
    const uLine = m.upstream.userCaseLine;
    const attacker = attackers[aLine - 1];
    const user = users[uLine - 1];
    if (attacker === undefined) throw new Error(`${m.id}: no attacker row at line ${aLine}`);
    if (user === undefined) throw new Error(`${m.id}: no user row at line ${uLine}`);

    // The pins, checked rather than trusted. If a fixture is ever replaced with a different slice of
    // upstream, these fire instead of silently importing different attacks under the same case ids.
    if (attacker["Attack Type"] !== m.upstream.attackType) {
      throw new Error(
        `${m.id}: MAPPING pins attack type "${m.upstream.attackType}", source row ${aLine} has "${attacker["Attack Type"]}"`,
      );
    }
    const pinnedTool = m.upstream.attackerTool;
    const actualTool = attacker["Attacker Tools"][attacker["Attacker Tools"].length - 1];
    if (actualTool !== pinnedTool) {
      throw new Error(
        `${m.id}: MAPPING pins tool "${pinnedTool}", source row ${aLine} ends in "${actualTool}"`,
      );
    }
    if (user["User Tool"] !== m.upstream.userTool) {
      throw new Error(
        `${m.id}: MAPPING pins user tool "${m.upstream.userTool}", source row ${uLine} has "${user["User Tool"]}"`,
      );
    }

    return {
      schemaVersion: 1,
      id: m.id,
      split: "imported",
      attackClass: "tool_output",
      title: ds.title(attacker, user),
      groundTruth: "attack",
      sources: [
        { id: "task", provenance: "USER" },
        { id: "toolres", provenance: "TOOL_OUTPUT" },
      ],
      content: { task: user["User Instruction"], toolres: compose(user, attacker) },
      proposedAction: {
        id: `${m.id}-a`,
        capability: m.ourMapping.capability,
        tool: pinnedTool,
        args: [{ name: m.ourMapping.argName, role: m.ourMapping.role, derivedFrom: ["toolres"] }],
      },
      expected: {
        containment: m.ourMapping.expectedDecision,
        requiredReasons: m.ourMapping.requiredReasons,
        rationale: m.ourMapping.expectedRationale,
      },
      textualMarkers: m.ourMapping.textualMarkers,
      authoredAt: m.ourMapping.authoredAt,
      note: m.ourMapping.note,
      containmentLimit: null,
      source: {
        kind: "imported",
        from: "injecagent",
        ref: `user_cases.jsonl line ${uLine} x ${ds.refLabel} line ${aLine} @ ${COMMIT}`,
        license: "MIT",
        sourceFixture: "corpus/imported/source/",
        upstreamCommit: COMMIT,
        modifications: ds.modifications(mapping, attacker),
      },
    };
  });
  return { cases, outFile: ds.outFile, key: ds.key };
};

for (const ds of DATASETS) {
  const { cases, outFile, key } = buildOne(ds);
  const rebuilt = `${JSON.stringify(cases, null, 2)}\n`;
  const shipped = existsSync(`${HERE}${outFile}`) ? readFileSync(`${HERE}${outFile}`, "utf8") : "";

  if (mode === "write") {
    writeFileSync(`${HERE}${outFile}`, rebuilt);
    console.log(`import[${key}]: wrote ${cases.length} case(s) to corpus/imported/${outFile}`);
    continue;
  }
  if (rebuilt === shipped) {
    console.log(
      `import[${key}]: OK - ${cases.length} case(s) rebuild byte-identically from the pinned source.`,
    );
    continue;
  }
  const x = rebuilt.split("\n");
  const y = shipped.split("\n");
  const at = x.findIndex((l, i) => l !== y[i]);
  console.error(
    `import[${key}]: MISMATCH - the committed split is not what the source rows compose to.`,
  );
  console.error(`  first difference at line ${at + 1}:`);
  console.error(`    rebuilt:   ${x[at]}`);
  console.error(`    committed: ${y[at]}`);
  failures++;
}

if (mode === "check") {
  if (failures === 0) {
    console.log(
      "  The STRINGS are reproducible from upstream's rows. The GRADING is not upstream's and",
    );
    console.log("  is audited separately: node scripts/mapping-report.mjs");
  } else {
    console.error("");
    console.error(
      "  Either an imported string was edited by hand - which would end the exact-import",
    );
    console.error("  claim - or a mapping changed and the split needs regenerating with --write.");
  }
}
process.exit(failures === 0 ? 0 : 1);
