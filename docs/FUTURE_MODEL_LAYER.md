# Future: a model layer

**Nothing in this document is implemented.** It is a plan, recorded so the shape of the next step is
legible, and marked so nobody mistakes it for a capability of this library.

## Why the trainable path was not built in v0.2

The obvious move — swap the regex baseline for a fine-tuned classifier and re-run — would not change
any conclusion here, and would cost real time. The measured result across all four splits is:

```
SILENT ATTACKS - no injection wording for any text detector to find
  split         n    containment    classifier
  holdout       6    6/6            0/6
  holdout_v2    4    4/4            0/4
  tuning        9    9/9            0/9
  derived       4    4/4            0/4
```

**23 of 23 versus 0 of 23.** Those cases contain no injection language at all: a false statement of
fact, a URL carrying data in a query string, an instruction split across two chunks, a well-formed
CRM record whose email field a prospect typed. A better classifier does not find what is not there,
so a fine-tune would move the *overt* rows and leave the row the argument rests on untouched.

Stated the other way: the honest claim is about a **failure mode**, and a stronger detector fails the
same way. Spending a week to demonstrate that again would be theatre.

Where a fine-tune *would* move a number is the over-blocking column — the classifier flags 3 of 6
benign holdout cases because they quote attack strings, and a trained model would plausibly do better
there. That is worth knowing and it strengthens the baseline rather than the thesis, which is the
right direction for a claim to be pressured from.

## The experiment worth running

Not "a better injection classifier". The interesting question is the one `LIMITATIONS.md` names as the
biggest untested gap:

> Provenance labels are handed to the policy for free. Deriving them at ingestion is the hard part,
> and it is where real deployments fail.

**Task.** Given a span of retrieved or extracted content, predict its *provenance class* — not "is
this an injection", which is the framing that loses, but "does this read as authored by the corpus
owner or by a third party". That is a judgement about origin, which is what the policy actually keys
on, and it is the label that is expensive to derive.

**Why a small local model rather than an API call.** Every chunk needs a label at ingestion, so this
sits in a hot path where a per-chunk network call is not affordable. That is a real serving argument
rather than a keyword grab, and it is the only version of a model layer that belongs near this
library.

**Data.** The corpus here is 51 cases and nowhere near enough. The honest source is real retrieval
traffic with per-chunk origin labels, which `@agent-containment/retrieval` already carries through
indexing.

**How it would be evaluated.** The same 2x2, the same held-out discipline, the same refusal to print a
percentage below n=20 — and reported as a **label-derivation** number, kept separate from the
containment number, because they measure different things and pooling them would repeat the mistake
this project spent a whole pass avoiding.

**Where it would live.** Not in `packages/core`. The core is pure, synchronous and zero-dependency,
and `test/contract.test.ts` fails the build if it acquires an import. A model layer belongs in a
sibling package that is allowed dependencies and `async`, exactly as the attestation verifier does.

## What would make this dishonest

Bolting an embedding model onto a deterministic policy engine to claim retrieval and model-layer
experience. There is no honest place for one inside `decide()`, and a reviewer sees that immediately.
If this gets built, it gets built as label derivation at ingestion, or not at all.
