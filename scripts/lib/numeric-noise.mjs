// Which numbers in a release document are CLAIMS, and which cannot go stale.
//
// Extracted from scripts/verify-numbers.mjs so it can be tested without running the script, which
// shells out to `pnpm test` and therefore cannot be imported from inside vitest. That constraint is
// the same one that let `hand-typed-numbers-agree` sit PROVEN for a release cycle while being
// defended by a test structurally incapable of observing it (DEFECTS_FOUND.md §19), so the lesson is
// applied here rather than restated: the part that can be unit-tested is a unit.

/**
 * Shapes that carry a number but cannot drift.
 *
 * Each entry earned its place by appearing in a real run and being judged noise, and the reason is
 * recorded so this is a record rather than a convenience. A silent addition here shrinks the
 * reported surface without shrinking the risk, which is the failure mode this whole file guards.
 */
export const NOT_A_CLAIM = [
  [/\bv?\d+\.\d+(?:\.\d+)?\b/g, "version strings: v1.0, 0.9.2"],
  [/§\s*\d+/g, "defect section references"],
  // A LIST OF SECTIONS IS STILL A LIST OF SECTION REFERENCES. This matched only the FIRST number,
  // so "sections 19 and 40" exempted the 19 and reported the 40 as an unregistered numeric claim -
  // and the fix a reader would reach for is to delete the reference, which loses a cross-link to
  // satisfy a checker. Ranges and conjunctions are the ordinary way to cite two sections.
  [
    /\bsections?\s+\d+(?:\s*(?:,|and|to|through|[-\u2013\u2014])\s*\d+)*/gi,
    "'section 15', 'sections 15 to 19', 'sections 19 and 40'",
  ],
  [/\b(?:19|20)\d{2}\b/g, "years"],
  [/\bnode-version:\s*\d+/g, "CI toolchain pin"],
  [/\$\d+/g, "SQL placeholders"],
  [/\bdefect\s+#?\d+/gi, "defect references"],
  [/\b[MPALDX]\d+\b/g, "mutation ids"],
  [/\b[A-Za-z_][\w-]*\d+\w*\b/g, "identifiers carrying a digit: acct-1, v0, SHA256, r-1"],
  [/^\s*\d+\.\s/g, "ordered-list markers and numbered headings"],
  // A LEADING TABLE CELL THAT IS JUST AN INTEGER IS A ROW LABEL, and a row label is an index: it
  // identifies the row, it is cited as "row 14", and it cannot go stale. Exactly the category above,
  // in table form. Added when a new limitation row moved the ratchet by one - and added as a RULE
  // rather than by raising the ceiling, because "row 12" is not a claim about anything and counting
  // it as unchecked prose overstates the unchecked surface.
  //
  // Deliberately anchored and narrow: only a cell that is ENTIRELY an integer, only at the start of
  // the line. `| 21 of 30 direct-harm |` is not a row label and is not exempted, which is what the
  // "a real claim next to a noise shape is still reported" test in numbers.test.ts pins.
  [/^\|\s*\d+\s*\|/g, "table row labels"],
  [/\b\d+\s*(?:ms|s|kb|mb|gb|bit|bits|byte|bytes)\b/gi, "units, not counts of things proven"],
  [
    /\b(?:left|passed|reported|showed|survived|returned|said|says|stated|was|were|had)\s+(?:\w+\s+){0,2}\d+\s*(?:of|\/)\s*\d+/gi,
    "past-tense narrative: 'deleting the branch left 74/74 passing' records what a run DID and stays true forever",
  ],
  [
    /\b(?:until|before|at|in)\s+v?\d+(?:\.\d+)*[^.]{0,40}?\b\d+\b/gi,
    "version-anchored history: 'graded PROVEN until v1.0, when 461 tests passed'",
  ],
];

/** A line with every uncheckable shape and inline code removed. */
export const stripUncheckable = (line) => {
  let out = line.replace(/`[^`]*`/g, " ");
  for (const [re] of NOT_A_CLAIM) out = out.replace(new RegExp(re.source, re.flags), " ");
  return out;
};

/**
 * The numeric claims a line makes: an "N of M" pair at any size, or a bare two-digit-plus count.
 *
 * Single digits alone are excluded deliberately. "the 5 packages" drifts, but so does every prose
 * sentence containing a small number, and a checker whose output is mostly noise gets ignored -
 * which is how a stale number survives in the first place.
 */
export const numericClaims = (line) => {
  const stripped = stripUncheckable(line);
  return [
    ...[...stripped.matchAll(/\b(\d+)\s*(?:of|\/)\s*(\d+)\b/g)].map((m) => m[0]),
    ...[...stripped.matchAll(/\b(\d{2,})\b/g)].map((m) => m[0]),
  ];
};

/**
 * Walk a document's lines, skipping fenced code and generated blocks.
 *
 * Generated blocks are skipped because `blocks:check` regenerates each from its generator and exits
 * 1 on any difference - a stronger guarantee than this offers. Reporting them as unchecked would
 * name the best-protected numbers in the repository as the least protected.
 */
export const scanDocument = (text) => {
  const out = [];
  let inFence = false;
  let inGenerated = false;
  text.split("\n").forEach((line, i) => {
    if (/<!-- GENERATED:[a-z0-9-]+ -->/.test(line)) {
      inGenerated = true;
      return;
    }
    if (/<!-- \/GENERATED -->/.test(line)) {
      inGenerated = false;
      return;
    }
    if (inGenerated) return;
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const claims = numericClaims(line);
    if (claims.length > 0) out.push({ line: i + 1, text: line.trim(), claims });
  });
  return out;
};
