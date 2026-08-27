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
} from "@agent-context-containment/core";

/**
 * Files that live in a split directory but are not cases.
 *
 * This is an explicit list rather than a heuristic on purpose. A rule like "skip anything that does
 * not parse as an array" would also skip a genuinely malformed case file, which is exactly the
 * failure this loader exists to make loud. Adding a name here has to be a deliberate act.
 */
const SIDECARS: ReadonlySet<string> = new Set([
  "FREEZE.json", // the holdout's freeze claim and its failed-attempt record
  "MANIFEST.sha256", // byte hashes, not JSON at all
  "MAPPING.json", // the grading audit for corpus/imported - see packages/conformance/src/mapping.ts
  "MAPPING_DS.json", // the same, for InjecAgent's data-stealing half (v0.8)
]);

/** Read every case in one split directory. Throws if the corpus is invalid: a bad corpus grades nothing. */
export function loadSplit(dir: string, split: Split): CorpusCase[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !SIDECARS.has(f));
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
