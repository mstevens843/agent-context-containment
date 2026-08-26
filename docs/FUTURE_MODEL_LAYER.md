# Future: a model layer

**Nothing in this document is implemented.** It is a plan, recorded so the shape of the next step is
legible, and marked clearly so nobody mistakes it for a capability of this library.

## The gap

`@agent-containment/classifier` is thirteen regexes. That is a fair baseline and an honest one, and
it is not a frontier detector. The comparison in the README therefore flatters containment, which
LIMITATIONS.md says in those words.

The interesting version is not "add a better classifier". Containment and detection are not rivals -
detection is a useful *annotation* on content that containment has already decided may not reach a
capability. The question worth answering is what a small model buys in the position where an API call
cannot go.

## The plan, if it were built

**Task.** Classify the *provenance risk tier* of a span of retrieved content - not "is this an
injection", which is the framing that loses, but "does this span read as authored by the corpus owner
or by a third party". That is a judgement about origin, which is what the policy actually keys on,
and it is the label that is expensive to derive at ingestion. LIMITATIONS.md names label derivation
as the hard part that this repo measures not at all; this is the piece that would attack it.

**Data.** The corpus here is 20 cases and nowhere near enough. The honest source is real retrieval
traffic with per-chunk origin labels, which the retrieval package already carries.

**Why a small local model rather than an API call.** Latency and cost in an ingestion hot path where
every chunk needs a label. That is a real serving argument rather than a keyword grab, and it is the
only version of a model layer that belongs in this library.

**How it would be evaluated.** The same 2x2, the same held-out discipline, the same refusal to print
a percentage below n=20 - and reported as a *label-derivation* number, separate from the containment
number, because they measure different things.

## What would make this dishonest

Bolting an embedding model onto a deterministic policy engine to claim retrieval and model-layer
experience. There is no honest place for one in `decide()`, and a reviewer can see that in a minute.
If this gets built, it gets built as label derivation at ingestion or not at all.
