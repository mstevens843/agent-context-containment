// The exact-import claim, made checkable.
//
// "Upstream's strings, byte for byte" was true in v0.6 and it was not AUDITABLE: it rested on my
// having pasted carefully, and a reader has no way to tell a faithful transcription from a helpful
// one. Neither would I, six months later. So the upstream rows are committed under
// `corpus/imported/source/`, the composition rule is code, and these tests fail the build if the
// shipped cases stop being what those rows compose to.
//
// The other half is the distinction the schema could not previously express. Until v0.7 an exact
// import and a hand-written restatement of an upstream *idea* both carried `kind: "derived"` - the
// strongest evidence in this repository and the second-strongest, wearing the same label. That is now
// two variants, enforced in both directions, because the dangerous direction is a hand-derived case
// filed as an import: it would claim bytes it does not have.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSplit } from "@agent-context-containment/conformance";
import { type CorpusCase, checkCorpus } from "@agent-context-containment/core";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");
const CORPUS = join(REPO, "corpus");
const imported = loadSplit(join(CORPUS, "imported"), "imported");
const derived = loadSplit(join(CORPUS, "derived"), "derived");

const jsonl = (name: string): Record<string, unknown>[] =>
  readFileSync(join(CORPUS, "imported", "source", name), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("imported benchmark import", () => {
  it("every imported case rebuilds byte-identically from the committed source rows", () => {
    // The load-bearing test, and it is a subprocess on purpose: it runs the same command a reader
    // would, so passing here means the documented command actually works.
    const out = execFileSync("node", [join(REPO, "scripts", "import-injecagent.mjs"), "--check"], {
      encoding: "utf8",
    });
    expect(out).toContain("rebuild byte-identically");
  });

  it("the imported strings appear verbatim in the upstream rows", () => {
    // Checked independently of the importer, so a bug in the composition rule cannot make both the
    // rebuild and this test agree on the wrong answer.
    // BOTH fixtures. The data-stealing half is a separate file, and a test that read only one would
    // silently stop checking half the split the day it was added.
    const attackers = [...jsonl("attacker_cases.jsonl"), ...jsonl("attacker_cases_ds.jsonl")];
    const users = jsonl("user_cases.jsonl");
    for (const c of imported) {
      const instruction = attackers
        .map((a) => String(a["Attacker Instruction"]))
        .find((i) => c.content.toolres?.includes(i));
      expect(
        instruction,
        `${c.id}: its tool response contains no attacker instruction from the pinned fixture - the strings are not upstream's`,
      ).toBeDefined();
      const task = users
        .map((u) => String(u["User Instruction"]))
        .find((i) => i === c.content.task);
      expect(
        task,
        `${c.id}: its task text is not any upstream user instruction, verbatim`,
      ).toBeDefined();
    }
  });

  it("nothing was tidied: the imported bytes keep upstream's own formatting", () => {
    // Upstream's tool responses are single-quoted Python-dict repr, not JSON. If a case ever shows up
    // with double quotes and clean spacing, somebody "fixed" it and the exact-import claim is over.
    for (const c of imported) {
      const res = c.content.toolres ?? "";
      expect(
        res.startsWith("{'"),
        `${c.id}: the tool response no longer looks like upstream's Python repr - it has been reformatted`,
      ).toBe(true);
    }
  });

  it("the fixture is pinned to a commit, and every case names it", () => {
    const mapping = JSON.parse(readFileSync(join(CORPUS, "imported", "MAPPING.json"), "utf8")) as {
      upstream: { commit: string };
    };
    expect(mapping.upstream.commit, "the upstream commit is not a 40-char sha").toMatch(
      /^[0-9a-f]{40}$/,
    );
    for (const c of imported) {
      expect(c.source.kind).toBe("imported");
      if (c.source.kind !== "imported") continue;
      expect(
        c.source.upstreamCommit,
        `${c.id}: pinned to a different commit than MAPPING.json`,
      ).toBe(mapping.upstream.commit);
      expect(c.source.sourceFixture, `${c.id}: names no source fixture`).toContain("source/");
    }
  });

  it("exact imports and hand-derived cases are different kinds, enforced both ways", () => {
    for (const c of imported) {
      expect(c.source.kind, `${c.id} is an exact import and must say so`).toBe("imported");
    }
    for (const c of derived) {
      // The split holds two legitimate kinds - `derived` for restated attack shapes and
      // `cve_derived` for one case built from a published advisory - and exactly one illegitimate
      // one. Nothing here reproduces upstream bytes, so nothing here may claim to.
      expect(
        c.source.kind === "derived" || c.source.kind === "cve_derived",
        `${c.id} is filed as "${c.source.kind}"; the derived split holds derived and cve_derived only`,
      ).toBe(true);
      expect(
        c.source.kind,
        `${c.id} is hand-written and must not claim to be an exact import`,
      ).not.toBe("imported");
      if (c.source.kind !== "derived") continue;
      expect(
        c.source.modifications,
        `${c.id}: a hand-derived case must carry the HAND-DERIVED label`,
      ).toContain("HAND-DERIVED");
    }
  });

  it("checkCorpus rejects a hand-derived case dressed as an import", () => {
    // The direction that would actually mislead a reader. Asserted against the checker rather than
    // by inspection, so the rule holds for cases nobody has written yet.
    const liar = {
      ...(derived[0] as CorpusCase),
      source: {
        kind: "imported",
        from: "agentdojo",
        ref: "made up",
        license: "MIT",
        sourceFixture: "corpus/derived/source/",
        upstreamCommit: "0".repeat(40),
        modifications: "these are OURS",
      },
    } as CorpusCase;
    const codes = checkCorpus([liar]).map((v) => v.code);
    expect(codes, "a derived case claiming exact-import provenance was accepted").toContain(
      "IMPORT_KIND_MISMATCH",
    );
  });

  it("checkCorpus rejects an import that hides which fields are the author's", () => {
    const c = imported[0] as CorpusCase;
    if (c.source.kind !== "imported") throw new Error("fixture changed");
    const quiet = {
      ...c,
      source: { ...c.source, modifications: "imported from upstream" },
    } as CorpusCase;
    const codes = checkCorpus([quiet]).map((v) => v.code);
    expect(codes).toContain("IMPORT_WITHOUT_GRADING_DISCLOSURE");
  });

  it("the grading fields live in MAPPING.json, not in the imported strings", () => {
    // The separation this whole split depends on: upstream supplied no provenance model, no
    // capability table and no decisions. If any of those could be read out of the fixture, the line
    // between imported and authored would be blurred.
    const attackers = jsonl("attacker_cases.jsonl");
    const raw = JSON.stringify(attackers);
    for (const word of [
      "sink_identity",
      "TOOL_OUTPUT",
      "NEEDS_DECLASSIFICATION",
      "account_modify",
    ]) {
      expect(
        raw.includes(word),
        `the upstream fixture contains "${word}" - grading vocabulary must not come from upstream`,
      ).toBe(false);
    }
  });
});
