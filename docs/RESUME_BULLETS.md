# Resume and portfolio bullets

Drafts for reuse. Every number here is reproducible with `pnpm test` and appears in `STATUS.md`.

## Long form — one project entry

> **agent-context-containment** — Open-source TypeScript library and evaluation harness for
> prompt-injection containment. Enforces capability boundaries from provenance and taint flow rather
> than text classification, using a two-axis capability model (effect x egress) with per-argument-role
> ceilings. Measured against a production prompt-injection detector ported intact from a shipped
> agent wallet: on attacks carrying no injection language, containment blocked 6/6 and the classifier
> 0/6, while the classifier over-blocked 3/6 benign documents that merely quoted attack strings.

## Short form — one line

> Built an open-source TypeScript containment library for prompt injection that decides on provenance
> and capability flow instead of reading the text, and an eval harness showing where classifier-based
> defences structurally fail.

## Supporting bullets

> Designed the evaluation to be difficult to rig: the holdout split is a distinct branded type, so
> citing a holdout case as evidence for a classifier heuristic is a compile error rather than a
> code-review finding.

> Graded mechanism rather than verdict — every refusing test case names the reason codes that must
> appear, so **a correct refusal reached by faulty reasoning is scored as a failure**. This caught a
> real defect in my own engine on the first run: six correct refusals that reported the wrong reason
> and would have passed any outcome-only grader.

> Wrote six deliberately-broken policy engines to prove the suite discriminates rather than
> blanket-fails, including one that is a containment engine secretly acting as a classifier — if the
> suite could not separate it from the reference, the project's central claim would be unfalsifiable.

> Reported a coverage gap in my own frozen test set rather than closing it. The only holdout case
> targeting model-output laundering turned out not to discriminate; the blind mutant is now asserted
> as a known fact in the suite and a discriminating case was added outside the frozen split, so the
> gap cannot quietly disappear.

> Acknowledged prior art (DeepMind's CaMeL, Willison's dual-LLM pattern, capability isolation) in the
> opening section of the README. The contribution is a reusable implementation, an attack corpus, an
> eval harness, and a developer-facing policy model — not the underlying idea.

> Enforced a purity boundary with a contract test that fails the build if the core acquires an
> import, an I/O-capable global, a clock, a source of randomness, or a hard-coded policy threshold
> outside the single truth table.

## The line to lead with in conversation

> Classifier-only defences miss silent attacks and over-block benign quoted attacks. Containment
> enforces capability boundaries from provenance and taint flow, independent of whether the text
> looks malicious.

## What not to claim

- Not "solves prompt injection." The claim is about two specific failure modes being structural for
  anything that reads the text.
- Not "a benchmark." 24 hand-written cases is a test suite. Say so before anyone asks.
- Not "provably secure." CaMeL earns that word with an interpreter; cooperative taint in TypeScript
  does not.
- Not a percentage without its denominator, and never an attack-blocked rate without the
  over-blocking figure beside it.
