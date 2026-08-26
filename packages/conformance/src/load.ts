// Reading the corpus off disk.
//
// One file per case class, plain JSON, no parser dependency. The format is chosen so a researcher
// who is not using this library - or not using TypeScript - can consume it with `JSON.parse` or
// Python's `json.load` and nothing else.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type CorpusCase,
  type Split,
  checkCorpus,
  formatCorpusViolations,
} from "@agent-containment/core";

/** Read every case in one split directory. Throws if the corpus is invalid: a bad corpus grades nothing. */
export function loadSplit(dir: string, split: Split): CorpusCase[] {
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".json") && f !== "FREEZE.json" && f !== "MANIFEST.sha256",
  );
  const cases: CorpusCase[] = [];
  for (const f of files.sort()) {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!Array.isArray(parsed)) throw new Error(`${f} is not an array of cases`);
    cases.push(...(parsed as CorpusCase[]));
  }
  const wrong = cases.filter((c) => c.split !== split);
  if (wrong.length > 0) {
    throw new Error(`${dir} contains ${wrong.length} case(s) not marked "${split}"`);
  }
  const violations = checkCorpus(cases);
  if (violations.length > 0) {
    throw new Error(`corpus at ${dir} is invalid:\n${formatCorpusViolations(violations)}`);
  }
  return cases;
}
