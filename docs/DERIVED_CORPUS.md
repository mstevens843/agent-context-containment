# The derived subset

Six cases in `corpus/derived/`, hand-derived from published AgentDojo and InjecAgent material. Full
attribution in `corpus/derived/ATTRIBUTION.md`; this document is about what the split is *for*.

## The problem it addresses

Every other case in this corpus was written by the same person who wrote the policy engine. The
structural mitigations — a holdout frozen before the engine existed, branded split types,
reason-level grading, seven mutants — reduce self-deception. **They do not eliminate it, and no
mechanism internal to a single author can.** If I unconsciously wrote attacks my design already
handled, nothing in the repository would notice.

The derived split is the only material here that was not designed by me. AgentDojo's suites and
InjecAgent's attack categories were built by other people, for other systems, with no knowledge of
this capability table.

## What it proves

**That the containment decision does not depend on this corpus's authorship.** The attack shapes were
designed elsewhere, and each lands on the reason the shape implies, without any rule having been
written with it in view. `ad-d-001` — an inbox message supplying a transfer destination — is refused
for the same reason as our own email cases, and nothing about the table was adjusted to make that so.

## What it does not prove

- **It is not a benchmark run.** No number here is comparable to a published AgentDojo or InjecAgent
  score. Quoting one beside theirs would be misleading.
- **It is not upstream's difficulty.** AgentDojo is a dynamic environment driving an agent through a
  tool-call loop; InjecAgent pairs 17 user tools with 62 attacker tools across two-stage attacks.
  Restating an attack as a single static `(sources, content, proposedAction)` triple loses much of
  what made the original hard — the multi-step loop, the adaptive attacker, the agent's own reasoning.
- **It is not independent authorship.** The shapes are theirs; the wording, the provenance labels and
  the expected decisions are mine. Weaker than a genuine external contribution, and not the same
  thing.
- **n = 6**, against their 629 and 1,054.

## Why hand-derived rather than ported

Neither benchmark reduces to this schema without a translation step that is *my judgement* about what
each case meant. Doing that silently and calling the result an import would be worse than not doing
it. Every case says `HAND-DERIVED` in its `modifications` field and a test asserts that string is
present, so the label cannot quietly fall off.

## The honest claim

> These independently-designed attack shapes are refused for the reason the shape implies, and
> refusing them required no rule written with them in view.

That is narrow. It is also the only claim in the repository that is not circular, which is why six
cases are worth documenting at this length.

## Reported separately

`corpus/derived/` is its own split with its own manifest. Its results appear as their own row in the
comparison table and are never pooled with the holdout's — the splits are not samples from one
population, and one headline number over all four would claim more than any of them supports.
