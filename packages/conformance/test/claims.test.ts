// The words the generated reports and the docs are not allowed to say.
//
// Every claim in this project has drifted upward at least once. `crossHostSafe` was earned by a proof
// aimed one layer away from it (§10). "Fixed" meant "mitigated" (§11). A label was called `overt`
// because it had been called that before (§9). Wording is where a bounded result becomes an
// unbounded one, and prose has no type system - so this file is the type system.
//
// The rule is per LINE and it is about ASSERTION, not vocabulary. A document may use a word while
// negating it; that is how a caveat is written. What it may not do is assert the thing.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");

/**
 * Markdown, as PARAGRAPHS rather than lines.
 *
 * The first version checked line by line and produced three false positives immediately, all the same
 * shape: prose wraps at 100 characters, so "...invites the reading that a validated manifest is a
 * true one. It is" ended a line and "a CONSISTENT one" began the next. A caveat lives in the same
 * paragraph as the claim it qualifies, never reliably on the same line, and a rule that flags the
 * disclaimer for containing the word it disclaims is the same mistake as banning "average" from a
 * report whose header promises no averages.
 */
const prose = (): { file: string; line: string; n: number }[] => {
  const out: { file: string; line: string; n: number }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      // `corpus` was skipped ENTIRELY, to avoid walking 700 JSON case files. That took the
      // attribution documents with it - and `corpus/imported/ATTRIBUTION.md` was carrying `6/6` and
      // `4/6` three versions after they became `17/17` and `9/17`. An unscanned document with stale
      // release numbers, invisible to every check in the repository.
      //
      // Found by asking which documents the walker actually reaches. Skip the noise, not the prose.
      if (["node_modules", ".git", "dist", ".turbo"].includes(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!name.endsWith(".md")) continue;
      // FENCED CODE IS NOT PROSE. A block holds quoted output, a command, or - as in
      // DEFECTS_FOUND.md §17 - the exact false sentences a guard failed to catch, recorded so the
      // failure is legible. A document about what a guard missed necessarily contains what it missed.
      //
      // `generated-blocks.mjs` skips fences for the same reason and set the precedent. The residual
      // risk is real and small: somebody could hide an assertion in a fence. Prose claims do not live
      // in code blocks, and the alternative - flagging every quoted example - makes the guard
      // unusable in exactly the documents that discuss it.
      let inFence = false;
      const lines = readFileSync(p, "utf8")
        .split("\n")
        .map((l) => {
          if (/^\s*```/.test(l)) {
            inFence = !inFence;
            return "";
          }
          return inFence ? "" : l;
        });
      let buf: string[] = [];
      let start = 1;
      const flush = (): void => {
        if (buf.length > 0) {
          out.push({ file: p.slice(REPO.length + 1), line: buf.join(" "), n: start });
          buf = [];
        }
      };
      // A LIST ITEM IS ITS OWN PARAGRAPH, and a table row is its own row. Markdown bullets are not
      // blank-line separated, so joining on blank lines alone merged unrelated items - which flagged
      // a PUBLISHING.md bullet about whether a VERSION NUMBER is honest under the rule about whether
      // a MANIFEST is honest, because a neighbouring bullet mentioned manifests. Cross-contamination
      // between adjacent bullets produces exactly the confident-wrong finding this file exists to
      // prevent.
      const startsItem = (l: string): boolean => /^\s*(?:[-*+]\s|\d+\.\s|\|)/.test(l);
      lines.forEach((line, i) => {
        if (line.trim() === "") {
          flush();
          start = i + 2;
          return;
        }
        if (startsItem(line)) flush();
        if (buf.length === 0) start = i + 1;
        buf.push(line);
      });
      flush();
    }
  };
  walk(REPO);
  return out;
};

/**
 * A negation, and it must appear NEAR the word it negates.
 *
 * The first version tested the whole paragraph against a token list that included a bare `\bno\b`.
 * That made this guard nearly useless: "no" appears in ordinary prose constantly, so "The reference
 * policy is optimal and no further tuning is required" was exempt from the optimality rule, and "The
 * freeze proof has been obtained, with no caveat" was exempt from the freeze rule. FOUR OF FIVE
 * injected false claims passed.
 *
 * Found by an adversarial audit OF THIS FILE - the §15 shape appearing inside the machinery built to
 * prevent §15 shapes, for the second time in one pass.
 *
 * Proximity is the fix. A real caveat sits beside the thing it qualifies; a stray "no" three
 * sentences away does not. The window survives a line wrap and does not reach across a paragraph.
 */
/**
 * An explicit, greppable opt-out for a paragraph that DESCRIBES a rule rather than making a claim.
 *
 * Documents that explain this guard trip it - "checking that no line calls Postgres proven without
 * naming the condition" contains the rule text verbatim, and "a frontier that refuses to say
 * optimal" contains the word. The alternative is widening the negation vocabulary until it exempts
 * everything, which is exactly how the first version became useless.
 *
 * So the exemption is a marker somebody has to type, that shows up in a diff, and that a test below
 * keeps rare. Adding one is a small deliberate act; adding a synonym to a regex is not.
 */
const EXEMPT = "<!-- claims-guard:describes-the-rules -->";

const NEGATION =
  /\bnot\b|\bnever\b|\bcannot\b|\bwithout\b|\bunless\b|\bnothing\b|\bfails?\b|\bnor\b|\brather than\b|\bunmeasured\b|\bunavailable\b|\bcan fail\b|\bno (?:policy|document|line|proof|claim|test|such)\b/i;
const WINDOW = 140;

/** Is every occurrence of `word` in `text` within `WINDOW` characters of a negation? */
const negatedNear = (text: string, word: RegExp): boolean => {
  const re = new RegExp(word.source, "gi");
  let m = re.exec(text);
  if (m === null) return true;
  while (m !== null) {
    const from = Math.max(0, m.index - WINDOW);
    const to = Math.min(text.length, m.index + m[0].length + WINDOW);
    if (!NEGATION.test(text.slice(from, to))) return false;
    m = re.exec(text);
  }
  return true;
};

describe("no document asserts more than the evidence supports", () => {
  const lines = prose();

  it("the exemption is used sparingly, and every use is a description of a rule", () => {
    // An escape hatch that gets used freely stops being an escape hatch and becomes the default.
    // A handful is a document explaining the guard; a dozen is the guard being routed around.
    const exempted = lines.filter((l) => l.line.includes(EXEMPT));
    expect(
      exempted.length,
      `${exempted.length} paragraphs are exempt from the claim guard - that is too many to be descriptions of the rules`,
    ).toBeLessThan(6);
    for (const e of exempted) {
      expect(
        /rule|guard|check|assert|says|describ/i.test(e.line),
        `${e.file}:${e.n} claims the exemption without describing a rule:\n    ${e.line.slice(0, 160)}`,
      ).toBe(true);
    }
  });

  it("there is prose to check", () => {
    // A guard over an empty set passes and protects nothing.
    expect(
      lines.length,
      "the walker found almost no markdown - it is checking nothing",
    ).toBeGreaterThan(200);
  });

  it("no line claims the freeze proof exists", () => {
    // The claim is UNAVAILABLE, not pending, and not obtained. A line may say the freeze failed or
    // that the proof is unavailable; it may not say there is one.
    for (const { file, line, n } of lines) {
      if (line.includes(EXEMPT)) continue;
      if (!/freeze/i.test(line)) continue;
      // `pending` is here because STATUS.md said "Git-object freeze: STILL PENDING" for four
      // versions and this rule walked straight past it - it only looked for PROOF words, and
      // "pending" is the opposite claim: not that a proof exists, but that one is coming. The
      // project's commitment is that the ordering claim is UNAVAILABLE, so "pending" is precisely
      // the word that must never appear about it.
      // `pending` IS CHECKED SEPARATELY, AND WITHOUT THE ESCAPE HATCH BELOW.
      //
      // A v1.0-rc adversarial run put "STILL PENDING" back into the STATUS row and this rule let it
      // through: the same row also says "Attempted and correctly rejected", and the escape clause
      // `/unavailable|attempted|failed|.../` matches ANYWHERE ON THE LINE. So the sentence that
      // makes the claim honest was also the sentence that excused the claim that makes it dishonest.
      // §18 added `pending` to the word list and this is the half that was still missing.
      //
      // There is no wording in which the freeze is pending. It is UNAVAILABLE. Only a negation
      // directly beside the word - "not pending" - is admissible, and nothing else on the line can
      // buy it. See DEFECTS_FOUND.md §21.
      if (/\bpending\b/i.test(line)) {
        expect(
          negatedNear(line, /\bpending\b/i),
          `${file}:${n} calls the freeze pending. It is UNAVAILABLE - a proof that will never be obtained, not one that is coming:\n    ${line.trim()}`,
        ).toBe(true);
      }
      if (!/\b(proven|proof|cashed|obtained|established)\b/i.test(line)) continue;
      expect(
        negatedNear(line, /\b(proven|proof|cashed|obtained|established)\b/i) ||
          /unavailable|attempted|failed|would|to cash/i.test(line),
        `${file}:${n} asserts a freeze proof exists:\n    ${line.trim()}`,
      ).toBe(true);
    }
  });

  it("no line describes a dispositioned branch as covered by ordinary tests", () => {
    // THE RULE A v1.0-rc ADVERSARIAL RUN NEEDED AND DID NOT FIND.
    //
    // `STATUS.md` was mutated to say "All branches including the unreachable ones are covered by
    // ordinary tests and proven closed" - and every gate passed. Nothing in this repository could
    // tell the difference between a branch CLOSED (a test exists and was watched to fail under its
    // mutation) and a branch DISPOSITIONED (unreachable, kept as defence in depth or recorded-dead,
    // with an invariant pinning it instead).
    //
    // That distinction is the entire content of the branch-risk table. Blurring it is how "we
    // reviewed it" becomes "it is tested", which is the §15 sentence one level up. So: a line that
    // talks about unreachable or dead branches may NOT also claim ordinary coverage for them.
    //
    // See DEFECTS_FOUND.md §21.
    const COVERAGE =
      /\b(covered by ordinary tests|proven closed|ordinary coverage|fully covered)\b/i;
    for (const { file, line, n } of lines) {
      if (line.includes(EXEMPT)) continue;
      if (!/\b(unreachable|recorded-dead|dead branch|inert)\b/i.test(line)) continue;
      if (!COVERAGE.test(line)) continue;
      expect(
        negatedNear(line, COVERAGE),
        `${file}:${n} describes an unreachable or dead branch as ordinarily covered. It is DISPOSITIONED - an invariant pins it, no ordinary test reaches it - and the difference is the whole point of the branch-risk table:\n    ${line.trim()}`,
      ).toBe(true);
    }
  });

  it("no line claims every branch is closed", () => {
    // The unbounded version of the same overstatement. The commitment is specific and countable:
    // zero unguarded branches remain, and two are dispositioned. "All branches are closed" is a
    // claim about branches nobody has swept, which is exactly how §15 happened.
    for (const { file, line, n } of lines) {
      if (line.includes(EXEMPT)) continue;
      if (!/\b(all|every)\s+branch(es)?\b/i.test(line)) continue;
      if (!/\b(closed|covered|proven|tested)\b/i.test(line)) continue;
      expect(
        /unguarded|the 30|swept|found unprotected|dispositioned/i.test(line),
        `${file}:${n} claims every branch is closed without saying which population it swept:\n    ${line.trim()}`,
      ).toBe(true);
    }
  });

  it("no line calls the real-Postgres path proven without naming the condition", () => {
    for (const { file, line, n } of lines) {
      if (line.includes(EXEMPT)) continue;
      if (!/postgres/i.test(line)) continue;
      if (!/\bproven\b/i.test(line)) continue;
      expect(
        /DATABASE_URL|when set|only when|once proven|after passing|skipped|adapter|negative control|independent connections/i.test(
          line,
        ),
        `${file}:${n} calls Postgres proven without saying under what condition:\n    ${line.trim()}`,
      ).toBe(true);
    }
  });

  it("no line claims manifest validation establishes semantic correctness", () => {
    for (const { file, line, n } of lines) {
      if (line.includes(EXEMPT)) continue;
      if (!/manifest/i.test(line)) continue;
      if (!/\b(honest|true|correct|semantic)\w*\b/i.test(line)) continue;
      expect(
        negatedNear(line, /\b(honest|true|correct|semantic)\w*\b/i) ||
          /consistent|advisory|CONSISTENT/i.test(line),
        `${file}:${n} implies a validated manifest is an honest one:\n    ${line.trim()}`,
      ).toBe(true);
    }
  });

  it("no line claims the review workflows establish human judgement", () => {
    for (const { file, line, n } of lines) {
      if (line.includes(EXEMPT)) continue;
      if (!/review(er|s)?\b/i.test(line)) continue;
      if (!/\b(judgement|judgment|human)\b/i.test(line)) continue;
      // `shows` was here and is far too ordinary a word: "show them the exact value" is an
      // instruction to an integrator, not a claim that anything is proven. A rule that fires on
      // ordinary English gets suppressed, and a suppressed rule protects nothing.
      if (!/\bprove[sd]?\b|\bproof\b|\bestablish\w*\b|\bdemonstrat\w*\b/i.test(line)) continue;
      expect(
        negatedNear(line, /\bprove[sd]?\b|\bproof\b|\bestablish\w*\b|\bdemonstrat\w*\b/i) ||
          /mechanic|rule set|separate|apart/i.test(line),
        `${file}:${n} claims the workflows prove judgement:\n    ${line.trim()}`,
      ).toBe(true);
    }
  });

  it("no line asserts the policy is optimal or containment complete", () => {
    for (const { file, line, n } of lines) {
      if (line.includes(EXEMPT)) continue;
      if (!/\boptimal\w*\b|\bcomplete\b|\bsilver bullet\b|\bsolves?\b/i.test(line)) continue;
      if (!/polic|containment|injection|profile/i.test(line)) continue;
      expect(
        negatedNear(line, /\boptimal\w*\b|\bcomplete\b|\bsilver bullet\b|\bsolves?\b/i),
        `${file}:${n} asserts optimality or completeness:\n    ${line.trim()}`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The same discipline, over SOURCE COMMENTS.
//
// Everything above walks `.md` files and this registry. That is where the guard was pointed, and it
// is why an absolute claim written in a `//` comment could sit in the engine for the whole life of
// the project while every gate stayed green: `decide()` said "it NEVER throws for any input
// including a malformed one" and nine of sixteen malformed shapes threw. The claim was load-bearing
// - the comment underneath it explains that a policy engine which throws is one whose caller writes
// a try/catch, and that catch block is the bypass - and it was outside the apparatus built to stop
// exactly this. See DEFECTS_FOUND.md sections 24 and 26.
//
// WHY THIS RULE CANNOT REUSE `negatedNear`. `never` and `cannot` are both members of NEGATION, so
// `negatedNear(text, /\bnever\b/)` returns TRUE for "NEVER throws for any input" - the claim would
// negation-exempt itself and the rule would fire on nothing. An absolute claim about behaviour is
// admissible only when the comment NAMES what would catch it being false, or names the condition it
// holds under. That is the escape-clause shape the Postgres rule already uses, not the proximity
// shape the freeze rule uses.
// ---------------------------------------------------------------------------------------------

/**
 * Source comments, as UNITS rather than lines.
 *
 * Consecutive comment lines merge into one unit and a blank or code line flushes, for the same
 * reason `prose()` works in paragraphs: a claim and its qualification wrap across lines, and a rule
 * that reads one line at a time flags the qualification for containing the word it qualifies.
 */
const comments = (): { file: string; line: string; n: number }[] => {
  const out: { file: string; line: string; n: number }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".git", "dist", ".turbo"].includes(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      // SHIPPED SOURCE ONLY. Test files describe what they assert, so they read as claims about
      // behaviour while actually being the evidence for it.
      if (!name.endsWith(".ts") || !p.includes(`${join("", "src", "")}`)) continue;
      const lines = readFileSync(p, "utf8").split("\n");
      let buf: string[] = [];
      let start = 0;
      const flush = (): void => {
        if (buf.length > 0)
          out.push({ file: p.slice(REPO.length + 1), line: buf.join(" "), n: start });
        buf = [];
      };
      lines.forEach((l, i) => {
        const m = l.match(/^\s*(?:\/\/|\*|\/\*\*?)\s?(.*)$/);
        if (m !== null && !/^\s*\*\//.test(l)) {
          if (buf.length === 0) start = i + 1;
          buf.push((m[1] ?? "").trim());
          return;
        }
        flush();
      });
      flush();
    }
  };
  walk(join(REPO, "packages"));
  return out;
};

/** The source-file form of the opt-out. Counted separately so it cannot spend a markdown slot. */
const EXEMPT_SRC = "claims-guard:describes-the-rules";

/**
 * The absolute claims a comment may not make without saying what backs them.
 *
 * Deliberately narrow. An earlier draft included a bare `/\bimpossible\b/` and it fired on "present
 * so the field is impossible to misread as a gate" - ordinary English, not a safety claim. That is
 * the recorded lesson about `shows` in the reviewer rule: a rule which produces noise gets
 * suppressed, and a suppressed rule protects nothing.
 */
const ABSOLUTE =
  /\bnever\s+(?:throws?|fails?|leaks?|allows?)\b|\bfor any input\b|\bcannot\s+(?:be\s+)?(?:bypassed|defeated|escaped|forged)\b|\balways\s+(?:safe|correct|refuses?)\b/i;

/**
 * What makes an absolute claim admissible: it names its evidence, or it names its condition.
 *
 * Naming a test is the strong form. Naming an exception ("never throws EXCEPT on the three
 * structural mistakes above") is the weak form and is still honest, because the reader can see the
 * boundary. What is inadmissible is the bare absolute with nothing behind it.
 */
const BACKED =
  /\.test\.ts|DEFECTS_FOUND|claims\.json|mutation|§\s*\d|section \d|asserted|pinned|\bexcept\b|\bother than\b|\bunless\b/i;

describe("no source comment asserts more than the evidence supports", () => {
  const units = comments();

  it("there are comments to check", () => {
    // The empty-set floor, and it is not decoration. The purity claim in section 19 passed for
    // months while checking an empty list; a walker that silently matches nothing is the same bug.
    expect(
      units.length,
      "the comment walker found almost nothing - it is checking an empty set",
    ).toBeGreaterThan(400);
  });

  it("the source exemption is used sparingly, and every use describes a rule", () => {
    const exempted = units.filter((u) => u.line.includes(EXEMPT_SRC));
    expect(
      exempted.length,
      `${exempted.length} source comments are exempt from the claim guard`,
    ).toBeLessThan(4);
    for (const e of exempted) {
      expect(
        /rule|guard|check|assert|says|describ/i.test(e.line),
        `${e.file}:${e.n} claims the exemption without describing a rule`,
      ).toBe(true);
    }
  });

  it("no comment makes an absolute claim about behaviour without naming what backs it", () => {
    for (const { file, line, n } of units) {
      if (line.includes(EXEMPT_SRC)) continue;
      if (!ABSOLUTE.test(line)) continue;
      expect(
        BACKED.test(line),
        `${file}:${n} asserts an absolute property with nothing behind it. Name the test that would fail, the condition it holds under, or the DEFECTS_FOUND section:\n    ${line.slice(0, 200)}`,
      ).toBe(true);
    }
  });
});
