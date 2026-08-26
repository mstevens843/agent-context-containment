# Limitations

Read this before quoting any number from this repository.

## Open at v0 — the short list

Every one of these is a known gap, not a discovered surprise. Detail follows below.

| # | Gap | Status |
|---|---|---|
| 1 | **The frozen holdout has no commit anchor.** `FREEZE.json` records `frozenAtCommit: null`. The holdout was authored before the engine existed, but the repo has never been committed, so nothing can verify it. | Deferred by decision |
| 2 | **No derived corpus subset.** AgentDojo and InjecAgent (both MIT) were verified and the schema carries the attribution fields, but nothing is derived. The corpus is 100% author-written and therefore fully self-selected. | Not built |
| 3 | **The `M4` laundering gap stands.** The only holdout case aimed at model-output laundering does not discriminate; the blind mutant is asserted as a known fact rather than fixed. | Open for holdout v2 |
| 4 | **Receipt replay is undefended.** A `Declassification` has no nonce, no single-use ledger and no expiry, so nothing stops one being reused across a retry loop. | Open |
| 5 | **Correlated parameter tuples are unchecked.** Receipts are per value; a recipient and an amount each individually admissible can be an attack as a pair. | Open |
| 6 | **The corpus manifest is not checked in CI.** `MANIFEST.sha256` is the only anchor the frozen holdout has until it is committed, and it is currently verified by hand. It has already caught one silent rewrite by the formatter. | Open |
| 7 | **Small corpus, no adaptive attacker, no end-to-end utility score.** n=24 total. Nobody iterated against the final policy. There is no equivalent of CaMeL's honest "77% with security vs 84% undefended". | Structural to v0 |


## The taint is cooperative, not enforced

CaMeL gets its guarantee from a custom interpreter that sees every operation. This library is a
cooperative TypeScript wrapper. `map(f)` hands `f` the raw value, and `f` can capture it. A developer
can call `unsafeUnwrap`, read the payload, and re-wrap it as clean. **There is no membrane in
JavaScript**, and anywhere `Tainted` is not threaded, there is no taint at all.

This is why the library has two mechanisms. The boundary check in `decide()` re-derives taint from
declared input provenance and catches values laundered through a plain string. Neither mechanism is
sufficient alone. Together they make the mistake hard to make *by accident*, at a call site, during a
refactor. They do not make it impossible, and this library should never be described as information-
flow control.

## Model output laundering is the biggest hole, and it is on the integrator

Summarise a hostile page and the summary is a fresh string produced by a component you trust. If you
label it `CLEAN`, containment is gone end to end - every attacker needs only to get their string
paraphrased once.

The rule is that **model output inherits the join of every label in its context window**. The library
expresses this with `Source.derivedFrom` and follows the edges. It cannot enforce it, because it does
not see the model call. If your integration forgets those edges, this library will confidently
approve the attack. `M4 model_launders` in the mutant set is exactly this failure.

There is also no escaping for a natural-language sink. Encoding stops syntax attacks; it does nothing
about a well-formed sentence that says "wire $5,000 to this account".

## The laundering gap in the frozen holdout

`tool-h-002` is the only holdout case aimed at model-output laundering, and **it does not
discriminate.** `payment`'s `sink_identity` ceiling is `USER_CONTROLLED`, so an engine that treats
model output as clean still rates the value `TOOL_DERIVED`, still exceeds the ceiling, and still
refuses - for a reason the case never named. Mutant `M4 model_launders` is therefore invisible to the
entire frozen holdout.

The holdout was **not edited**. The blind set is asserted as exactly `["M4 model_launders"]` in
`holdout.test.ts`, so closing the gap later requires deliberately updating that record, and a
discriminating case (`tool-t-001`, sitting on the `read_only_tool` boundary where the `derivedFrom`
edge changes the answer) went into tuning with a clean-ancestry control beside it.

Consequence for anyone reading the holdout number: **laundering is covered by tuning only.** The
frozen split tests it in name and not in fact.

## Known weaknesses in each declassification rule

Every rule is finite by construction. None is safe unconditionally.

**`allowlist_member` - the domain is the bug, not the rule.** Membership is checked correctly and the
*matched member* is returned rather than the input, which defeats the normalise-one-side family. It
says nothing about whether the list is sensible. An allowlist containing `all-staff@` or `treasury@`
is sound by this rule and catastrophic in practice, because the attacker simply picks the worst
member. There is no linter for high-fan-out members.

**`numeric_envelope` - accumulation is invisible.** The bound must be clean, and that is enforced by
requiring it as an argument rather than reading it from content. What is not enforced is aggregation:
four hundred payments of 9.99 under a cap of 10 pass every individual check. The engine is pure and
stateless, so a per-call bound is meaningless against a loop unless the caller threads a running
budget. Nothing in the API forces them to.

**`clean_selection` - the choice is attacker-made even when the element is not.** Returns a clean
element, so it feels like a singleton. It is `log2(n)` bits: the attacker chose *which*. Rated
`finite` rather than `singleton` for that reason, and it should not be widened to multiple
capabilities on the assumption that a clean element is a clean decision.

**`echo_of_clean` - the only rule with a real singleton codomain,** and the only one it would be
defensible to admit for every capability at once. It uses `Object.is`, so `-0` and `NaN` behave
correctly, but it compares whatever the caller passes: if the "clean" side was itself laundered, the
rule cheerfully admits it. It cannot verify its own basis.

**`user_confirmed_value` - the library sees a string, not pixels.** It rejects bidi overrides,
zero-width characters, newlines and untrimmed padding, because those are attacks it *can* see. It
cannot verify that your dialog rendered what it told us it rendered: truncation, CSS, notification
previews and screen-reader output are all outside it. It also cannot tell an out-of-band confirmation
from one parsed out of a transcript - if your host accepts `User: yes, I confirm` from the
conversation, injected content can forge a confirmation and this rule will honour it.

**Receipts are process-local and unverified.** A `Declassification` is a plain object with an
incrementing id. There is no signature, no nonce, no single-use ledger, and no expiry - the package
has zero dependencies and must stay synchronous, which rules out WebCrypto, and a hand-rolled hash
would be trivially collidable by an attacker who chooses the content on both sides. `unwrap` checks
capability and lift and returns the receipt's `admitted` value, which closes check-versus-use
divergence, but nothing stops a receipt being reused across a retry loop. **Replay is not defended.**

**Correlated parameters are not checked.** Receipts are per value. A recipient admitted by an
allowlist and an amount admitted by an envelope are each individually sound; the *pair* can be the
attack. An action-level check over the whole argument tuple is a separate obligation this library
does not discharge.

**There is no source-allowlist rule at all** - deliberately, see DECLASSIFICATION.md. If you want
one, you will be tempted to add it, and it is the rule most likely to quietly reintroduce everything
this library prevents.

## The holdout advantage is partly structural by construction

Containment never reads the untrusted text, so novel phrasing cannot degrade it. A flat
tuning-to-holdout line for containment is **a prediction of the architecture, not a discovery**. The
holdout is a valid instrument for measuring the *classifier*; for containment it mostly checks that
nothing accidentally text-dependent crept in.

The cases were also chosen because they are cases where text-reading loses. That is a fair
demonstration of a failure mode and it is not a fair estimate of relative performance in general.

## The freeze is not yet cashed

`corpus/holdout/FREEZE.json` records `frozenAtCommit: null`. The holdout *was* authored before the
engine existed, and that ordering is only worth something once it is a git fact anyone can check. See
[EVALS.md](EVALS.md). Until then it is a claim like any other.

## The sample is tiny

n=16 holdout, n=4 tuning. Per-class counts are 1 to 3. The reporter refuses to print a percentage
below n=20 for this reason. **This is a test suite, not a benchmark.** Any sentence beginning "on our
benchmark" is a sentence to delete.

## No adaptive attacker

The corpus is fixed and was written without iterating against the final policy. Someone who reads
`packages/core/src/policy.ts` can almost certainly find a capability whose ceiling is too permissive
for their threat, or an argument role that was rated wrong. A static corpus establishes that these
specific attacks fail. It bounds nothing.

## The baseline is a heuristic, and the bias runs toward containment

It is a good-faith baseline - a production detector, ported intact, not written to lose - and it is
still thirteen regexes. A model-based detector would close much of the gap reported here. Anyone
reading the headline should mentally halve it.

## Provenance labels are handed over for free

Every corpus case arrives with its `Provenance` already correct. In a real deployment, deriving those
labels at ingestion - through an HTML parser, a PDF extractor, a tool-response envelope - **is the
hard part, and it is where deployments actually fail**. This suite measures the policy, not the
instrumentation. A perfect score here is entirely consistent with a system that is trivially broken
in production because its labels are wrong.

## Containment governs capability, never truth

An injected chunk that merely makes the answer wrong crosses no capability boundary and is not
something this library can help with. `rag-h-003` is exactly that case and is counted as out of
scope rather than hidden. A corpus with none of these would be rigged.

## No clock and no state, so no rate or budget enforcement

The engine is pure. Four hundred payments of 9.99 under a limit of 10 pass every individual check.
Aggregate limits need caller-threaded counters, and single-use receipts need a caller-threaded
ledger. A caller who passes a fresh ledger each time silently gets unlimited use.

## The confirmation-UI attack

`admitUserConfirmedValue` sees `presented`, not pixels. It rejects bidi overrides, zero-width
characters, newlines and untrimmed padding, because those are attacks it *can* see. It cannot verify
that your dialog rendered what it said it did - truncation, CSS, notification previews and
screen-reader output are all outside it. Confirmation fatigue is worse than any of these and is a
product problem, not a library one: the fortieth dialog of a session is not a security control.

## Type-level checks are defeated by one `as`

The brands are compile-time only. A caller with `as unknown as` defeats them entirely. They buy the
same thing branded ids buy anywhere: you cannot make the mistake by accident.

## The most likely real failure is availability

This library will not, in practice, be bypassed. It will be **removed**, because it over-blocked
something and a developer got tired. Per-role ceilings, free structural declassification, the
permissive `text_response` row and the permissive `read_only_tool` row exist for that reason and
should be read as security features rather than conveniences.
