// Remove terminal colour codes before reading numbers out of a tool's output.
//
// WHY THIS IS ITS OWN FILE, SHARED BY TWO CALLERS. `scripts/generated-blocks.mjs` had a private copy
// of this and `scripts/verify-numbers.mjs` did not. That difference is the whole of defect section 43:
// one file could read a test summary in CI and the other could not, and the one that could not spent
// two releases reporting correct documents as stale.
//
// A private copy of a utility is a place for two files to disagree. There is one implementation now,
// and a test asserts both callers use it.
//
// THE FAILURE IT PREVENTS, precisely. Vitest disables colour when its output is piped - which is what
// happens on a developer's machine - and FORCES colour on when `CI=true`, so the log looks right in
// the GitHub Actions UI. The summary line a human sees as
//
//   Tests  348 passed (348)
//
// is really `ESC[2m      Tests ESC[22m ESC[1mESC[32m348 passedESC[39m...`, and a pattern like
// /Tests\s+(\d+) passed/ cannot cross those escapes. It matches locally and never in CI.
//
// That asymmetry is what made this so hard to find: every local run was green, every CI run was not,
// and the checker's own error message pointed at the documents.

/**
 * Strip ANSI escape sequences.
 *
 * Written as a character walk rather than one regex because the regex forms of this are famously
 * subtle, and this file exists precisely because a subtle parsing bug survived several passes. It
 * handles CSI sequences (`ESC[` ... final byte) and the two-character escapes; anything else is left
 * alone rather than guessed at.
 */
export const stripAnsi = (text) => {
  if (typeof text !== "string") return "";
  const ESC = "\u001B";
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ESC) {
      out += text[i];
      continue;
    }
    // CSI: ESC [ parameter-bytes intermediate-bytes final-byte
    if (text[i + 1] === "[") {
      let j = i + 2;
      while (j < text.length && text.charCodeAt(j) >= 0x20 && text.charCodeAt(j) <= 0x3f) j++;
      while (j < text.length && text.charCodeAt(j) >= 0x20 && text.charCodeAt(j) <= 0x2f) j++;
      // The final byte ends the sequence. If the string ran out, drop the rest: a truncated escape
      // is not text a caller wants to match against either.
      i = j;
      continue;
    }
    // OSC: ESC ] ... BEL or ESC \
    if (text[i + 1] === "]") {
      let j = i + 2;
      while (j < text.length && text[j] !== "\u0007") {
        if (text[j] === ESC && text[j + 1] === "\\") {
          j++;
          break;
        }
        j++;
      }
      i = j;
      continue;
    }
    // Any other two-character escape.
    i += 1;
  }
  return out;
};
