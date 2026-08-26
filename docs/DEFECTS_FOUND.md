# Defects the tests caught in this repository

Five, all found by the harness rather than by reading the code, all recorded rather than smoothed
over. They are the most useful thing in the project: a test suite that has never failed is a test
suite with no evidence behind it.

Three of the four are cases where something **produced the correct output for the wrong reason**,
which is the failure mode this project is built to detect. See
[RIGHT_ANSWER_WRONG_REASON.md](RIGHT_ANSWER_WRONG_REASON.md).

---

## 1. The engine substituted a reason instead of adding one

**Found by:** reason-level grading, on the first run of the holdout. Six cases failed at once.

The engine chose between a general reason and a specific one with a ternary:

```ts
// before
reason(egress ? "egress_with_tainted_input" : "taint_exceeds_ceiling", ...)
```

Six holdout cases named `taint_exceeds_ceiling` in `requiredReasons`. All six refusals were
**correct** — the engine blocked every one — and it reported only the more specific
`egress_with_tainted_input`, dropping the general fact.

**Why it mattered.** A verdict-only grader passes all six and reports a clean sweep. What it hides is
a real defect in the audit trail: any downstream consumer filtering on `taint_exceeds_ceiling` — a
dashboard, an alerting rule, a compliance query — would have seen nothing for six genuine ceiling
breaches.

**Fix.** Emit both, general fact first. Reasons are additive; there is no cost to stating two true
things, and a policy engine's reasons are its product.

---

## 2. The holdout's laundering case did not discriminate

**Found by:** the mutant discrimination check, which asserts every mutant is bitten by something.
`M4 model_launders` was bitten by nothing.

`tool-h-002` argues at length in its own note that a model summary of a hostile page must inherit
that page's taint, and it is the **only** holdout case aimed at laundering. It does not test it.
`payment`'s `sink_identity` ceiling is `USER_CONTROLLED`, so an engine that treats model output as
clean still rates the value `TOOL_DERIVED`, still exceeds the ceiling, and still refuses — **for a
reason the case never named**.

So the case looked like coverage and was not, and `M4` is invisible to the entire frozen holdout.

**Fix — and what was deliberately not done.** The holdout was **not edited**. Instead:

- The blind set is asserted as exactly `["M4 model_launders"]` in `holdout.test.ts`. Closing the gap
  later requires deliberately updating that record; it cannot quietly disappear.
- A discriminating case, `tool-t-001`, went into the **tuning** split. It sits exactly on the
  `read_only_tool` boundary where the `derivedFrom` edge changes the answer, with `tool-t-002` as its
  clean-ancestry control.
- The gap is stated in the README, `STATUS.md`, `EVALS.md` and `LIMITATIONS.md`.

Recording a coverage gap you cannot currently close is worth more than closing it by loosening the
thing that revealed it.

---

## 3. A mutant became accidentally correct

**Found by:** the same discrimination check, immediately after an unrelated change to `ceilingFor`.

`ceilingFor` was changed so that an **unrated steering role fails closed** — it falls back to the
stricter of the row default and `USER_CONTROLLED` rather than inheriting a permissive default.

`M1 effect_only` modelled its defect by *clearing* `roleCeilings` on `web_fetch` and
`read_only_tool`, relying on the old permissive fallback. After the change, clearing the ceilings
**tightened** them, so the mutant no longer contained the defect it was named for and stopped being
caught.

**Why it mattered.** A mutant that does not model its defect is worse than no mutant at all: the
suite reports it as discriminated, the count looks healthy, and nothing was tested. Silent
false confidence, produced by a change that was itself correct.

**Fix.** The mutant now states the loosened ceilings explicitly rather than relying on a fallback:

```ts
roleCeilings: { sink_identity: "UNTRUSTED_EXTERNAL", control: "UNTRUSTED_EXTERNAL" }
```

A mutant should contain its own defect in the open, not inherit it from the surrounding system.

---

## 4. The by-class reporter counted refusals instead of correct answers

**Found by:** reading the printed report against the corpus, after paired benign controls were added
to attack classes.

The by-class table counted refusals per class:

```ts
// before
const cb = isBenign ? rows.filter(r => !r.refused).length : rows.filter(r => r.refused).length;
```

That was right when every attack class held only attacks. It stopped being right once each class
carried its paired benign control — `webpage` holds `web-h-001` and the byte-identical `web-h-003` —
because a class with one attack and one benign case scored `1/2` when the engine had got **both**
right.

**Why it mattered.** It is not merely a display bug. A row that penalises an engine for correctly
allowing a benign case **rewards over-blocking**, which is the precise failure the benign column
exists to catch. The report was quietly arguing against its own thesis.

**Fix.** Count correct answers on both halves, and mark classes holding both with `(mixed)`:

```ts
const correct = (r) => (r.groundTruth === "attack" ? refused(r) : !refused(r));
```

Containment's by-class line moved from a scattered `1/2`, `2/3` to a clean `15/15` — not because
anything about the engine changed, but because the report had been measuring the wrong thing.


---

## 5. The formatter silently rewrote the frozen holdout

**Found by:** `shasum -c corpus/holdout/MANIFEST.sha256`, run as a last check before declaring v0.
Three of seven holdout files failed.

`biome.json` ignored `dist`, `node_modules`, `.turbo` and `.changeset` — not `corpus`. Biome formats
JSON as well as TypeScript, so a routine `biome check --fix --unsafe .` reformatted the whitespace in
`document.json`, `email.json` and `webpage.json`.

**What was and was not affected.** The content was intact: 16 cases, every id present, every
`content` string byte-for-byte the same, every `requiredReasons` array unchanged, no structural
problems, and the full suite passing. A JSON formatter cannot alter string values or structure. But
the **bytes** changed, and the manifest is a byte-level integrity check, so it correctly reported a
mismatch.

**Why it mattered anyway.** A freeze that ordinary tooling can rewrite is not a freeze. The mismatch
here was benign; the next one might not be, and the manifest is the only thing standing between "the
corpus was edited" and "nobody noticed". Worse, once a manifest has failed benignly a few times, the
habit becomes regenerating it without looking — which is exactly how a real edit gets waved through.

The uncomfortable part: this had already happened before the check was run. Had the manifest not
existed, or had it not been checked at the end, the claim "the holdout was never edited" would have
gone out in the status report and been **false as stated**, even though nothing meaningful had
changed.

**Fix.** `corpus` added to biome's ignore list, so the frozen set is out of the formatter's reach
entirely. Manifests regenerated over the verified-intact content. The precise claim is now: the
holdout's *content* has never been edited; its *bytes* were reformatted once by tooling, before that
tooling was excluded.

**Note for the freeze procedure.** When the corpus is eventually committed and tagged, the git object
becomes the real anchor and this class of drift stops being possible. Until then the manifest is the
only anchor there is, and it should be checked in CI rather than by hand — currently it is not.
