# Why `reference` is the shipped policy

Short version: **it is not proven best, and this document exists because "0 over-block, 0 under-block"
reads like it is.**

`pnpm report:frontier` plots five profiles. Two of them are undominated on this corpus. `reference` is
one; `escalating` is the other. Choosing between them is a judgement about deployments, not a result,
and the reasoning is written down here so a reader can disagree with it specifically.

## What the numbers actually say

```
profile        over-block   under-block   escalations
strict         10           0             2
egress_strict  4            0             0
reference      0            0             1
escalating     0            0             5
permissive     0            7             1
```

| profile | verdict |
|---|---|
| `strict` | dominated by `egress_strict`, `reference`, `escalating` |
| `egress_strict` | dominated by `reference`, `escalating` |
| `reference` | **not dominated on this corpus** |
| `escalating` | **not dominated on this corpus** |
| `permissive` | dominated by `reference`, `escalating` |

"Not dominated" is a bounded statement: no *other profile here* beats it on one axis without losing on
the other. It is not "no such policy exists". Five tables were tried; the space of tables is enormous.

## Three reasons this is weaker evidence than it looks

**1. The corpus cannot separate them.** `reference` and `escalating` both score 0/0. They differ only
in the escalation column, which is not part of the dominance arithmetic — deliberately, because the
price of an escalation depends on whether a human is standing there, which is a fact about an
organisation and not about a policy. Scoring it would bake one org chart into the comparison.

**2. Undominated may mean "unmeasured".** A profile can be undominated because nothing in 68 cases is
hard enough to separate it from its neighbours. The cross-policy report says this about `reference` in
its own output, computed rather than written down, so the caveat disappears on its own the day a case
finally costs it something.

**3. The corpus was written by the person who wrote the policy.** Not all of it — 6 cases are exact
upstream imports and 9 are hand-derived — but most of it. That is the residual `docs/LIMITATIONS.md`
row 2 describes, and no amount of profile comparison touches it: comparing five of my tables against
my corpus measures internal consistency, not correctness.

## So why `reference`

Three reasons, in order of how much weight they carry.

**It escalates once, not five times.** Both undominated profiles complete the same work. `escalating`
sends five benign cases to a human to get there. That is defensible where an ops team already exists
and is a bad default: a review queue nobody staffs becomes a queue nobody reads, and a control
everyone learns to click through is worse than no control, because it looks like one.

**Its ceilings are per role, not per capability.** The over-block column is where `strict` and
`egress_strict` pay — 10 and 4 refused benign cases — and both pay it for the same reason: they tighten
a whole row, so a *payload* is treated like a *destination*. Untrusted text in the body of an email is
the ordinary case and the product; untrusted text choosing the recipient is the attack. `reference`
separates those, which is the mechanism that keeps the library usable at all.

**It fails toward review on drafts, not toward refusal.** `draftOnly` means a capability that produces
an artifact for a human to inspect escalates rather than refuses. That was defect §7 and fixing it was
what made the prepare/broadcast split work in practice.

## When you should not ship `reference`

Stated plainly, because a policy document that only argues for its own default is marketing:

- **An agent holding production credentials with no human in the loop.** `strict` costs 10 benign
  refusals across this corpus, and if a mistake costs a wire transfer that is a bargain. `reference`
  is calibrated for an assistant, not for an unattended operator.
- **A data-loss threat model.** `egress_strict` tightens only rows that can leak and leaves rows that
  merely change alone — 4 over-blocks instead of `strict`'s 10 for the same 0 under-blocks on the
  egress axis. If exfiltration is what keeps you up, that is a better shape than `strict`.
- **An ops team already reviewing.** Then `escalating`'s five escalations are five cheap minutes and
  it dominates `reference` on the axis you actually care about, which the arithmetic here cannot see.
- **Anything where you can measure your own traffic.** The right answer is to run
  `pnpm report:frontier` against *your* cases. Five profiles and a corpus of 68 is a starting point,
  not a recommendation for your deployment.

## What would change this document

A corpus that separates `reference` from `escalating` — cases where deferring to a human and
completing outright are genuinely different outcomes. None exist here, which is why both are
undominated and why the choice above is argued rather than computed.
