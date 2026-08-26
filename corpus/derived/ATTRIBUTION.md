# Derived subset — attribution and honesty statement

## What these cases are

**Hand-derived, not ported.** Every case in this split was written from the *publicly published
description* of an attack pattern in the benchmark named on it. None is a byte-for-byte import of
upstream case content, and none should be cited as one.

Stated plainly because the distinction is easy to blur and the blur would be self-serving: a repo
that says "derived from AgentDojo" invites a reader to assume upstream's cases were run against this
engine. They were not. What was borrowed is the *shape of the attack* — who plants the content, where
it surfaces, and what the injected goal is — restated in this corpus's schema.

## Why not port the real cases

AgentDojo is a dynamic environment: its cases are Python task suites with tool implementations,
injection points, and a runtime that drives an agent through a tool-call loop. InjecAgent is
structured around 17 user tools and 62 attacker tools. Neither reduces to a static
`(sources, content, proposedAction)` triple without a translation step that would be *my* judgement
about what the case meant. Doing that silently and calling the result an import would be worse than
not doing it.

## Upstream

| | AgentDojo | InjecAgent |
|---|---|---|
| repo | https://github.com/ethz-spylab/agentdojo | https://github.com/uiuc-kang-lab/InjecAgent |
| head at derivation | `089ed468cf3ed0322acc66b0211f26d9d90dbf60` | `f19c9f2c79a41046eb13c03c51a24c567a8ffa07` |
| licence | MIT | MIT |
| scale | 97 user tasks, 629 security cases | 1,054 cases, 17 user tools, 62 attacker tools |
| structure borrowed | suites: `workspace`, `slack`, `travel`, `banking` | categories: **Direct Harm**, **Data Stealing** (two-stage) |
| citation | Debenedetti et al., *AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents* | Zhan et al., *InjecAgent: Benchmarking Indirect Prompt Injections in Tool-Integrated LLM Agents* |

Both are MIT, so derivation with attribution is permitted. This file plus the per-case
`source.modifications` field is the attribution.

## What this subset proves

That the containment decision does not depend on this corpus's own authorship. These attack shapes
were designed by other people, for other systems, without any knowledge of this policy engine — which
is the one property the rest of the corpus cannot have, since the same person wrote the attacks and
the defence.

## What it does not prove

- **Not a benchmark run.** No number here is comparable to a published AgentDojo or InjecAgent score,
  and presenting one alongside theirs would be misleading.
- **Not upstream's difficulty.** Restating an attack in a static triple can lose exactly the thing
  that made it hard — the multi-step tool loop, the adaptive attacker, the agent's own reasoning.
- **Not independent authorship.** The shapes are theirs; the wording, the provenance labels, and the
  expected decisions are mine. That is weaker than a real external contribution and it is not the
  same thing.
- **n is tiny.** Six cases against their 629 and 1,054.

The honest claim is narrow: *these independently-designed attack shapes are refused for the reason
the shape implies, and refusing them required no rule written with them in view.*
