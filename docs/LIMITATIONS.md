# Limitations

Read this before quoting any number from this repository.

## Open at v0 — the short list

Every one of these is a known gap, not a discovered surprise. Detail follows below.

| # | Gap | Status |
|---|---|---|
| 1 | **The ordering proof is unavailable, not pending.** A freeze was attempted and correctly rejected: the recorded commit already contained the engine. No holdout-only pre-engine commit exists in this history — corpus and engine were first committed together. `frozenAtCommit` is back to `null` and will stay there. | **Closed as unavailable** |
| 2 | **The corpus is still mostly author-written.** 62 cases are EXACT IMPORTS of upstream content (`corpus/imported/`, InjecAgent, MIT) and 9 are hand-derived shapes; the rest are mine. Even the imports are graded by my capability mapping and my expected decisions — v0.6 makes that mapping machine-readable (`corpus/imported/MAPPING.json`), derives it from upstream's attack-type label rather than case by case, and measures its influence: **6/6 robust** to peer capability choices. The 6-case derived split is still the only material not designed by the policy author, and 6 is small. No mechanism internal to one author closes this. | Reduced, now measured |
| 3 | **v0's laundering gap is closed by a new split, not by v0.** `holdout_v2` bites `M4` (4 cases) and `M8 one_hop_only` (1). v0 remains blind to both, plus `M7`, and that blindness is asserted as an exact list. Closing it *in v0* would have meant editing a frozen instrument. | Closed additively |
| 4 | **Replay defence is hard to omit, not impossible.** The guard types `now` and `spentReceipts` as `never`; `advanced.decide` makes a deliberate bypass visible in a diff. Neither prevents one. `lockingFileLedger` is multi-process safe on a local filesystem; **v0.7 adds `durableLedger` + `postgresSpendStore`, the first adapter that can claim `crossHostSafe`** — and it only carries the claim after passing `proveCrossHost()`, five interleavings a read-then-write store fails. What no test here reaches: whether *your* hosts share *one* database. | Closed for the recommended path; cross-host now available and earned |
| 5 | **Tuple checks cover seven declared combinations across six capabilities.** Every unlisted combination is still unchecked, and enumerating them all is the rules engine this design refuses to become. An invariant forbids declaring a combination that could never fire. | Broadened, still bounded |
| 6 | **The derived split is hand-derived, not ported.** Nine cases restating published AgentDojo/InjecAgent attack shapes in this schema. Not a benchmark run, not upstream's difficulty, not independent authorship. See `DERIVED_CORPUS.md`. | By design, labelled |
| 7 | **holdout_v2 has no ordering property.** v1 was authored before the engine existed; v2 was authored after, by someone who had read it. It is a regression split with a frozen manifest, not a blind instrument, and must not be described as one. | By design, labelled |
| 8 | ~~**`transaction_prepare` refuses a steering argument outright.**~~ **FIXED in v0.3** via `draftOnly`: a draft capability escalates to `NEEDS_REVIEW` instead of refusing. Two individually-correct rules had composed into a flat `DENY` on a no-effect capability with no route out, defeating the prepare/broadcast split in practice. The flag is unsettable on anything with an effect or egress, asserted by two invariants, and a 360-cell frozen grid proves no acting capability moved. See `DEFECTS_FOUND.md` §7. | **Closed** |
| 9 | **The manifest is a weak anchor even though CI checks it.** The `corpus-integrity` job runs before install and gates everything, but a manifest proves only that files match a digest recorded at *some* point — and anyone who can edit the corpus can edit the manifest in the same change. Only the git-object freeze buys ordering. | Mitigated, not closed |
| 10 | **Still not an adaptive attacker.** Five strategies now (laundering variants, the cell probe, and three searches): 648 laundering variants, an exhaustive probe of all 400 policy cells, and THREE seeded property searches run by `pnpm adversary` — one over provenance graphs, checked against an independently written taint walk and an independently derived ceiling, one over malformed requests, checked against an independently written validity oracle, and one over receipt shapes, checked against a binding oracle written separately from `coverFor`. They are the first things here that iterate against the engine rather than replaying a list, and they are not decorative: reintroducing §23 produces 1,386 findings, §25 produces 2,564, §24 produces 3,376, and §32 was found by the malformed search on its first run. It is still NOT an adaptive attacker — it does not learn, it does not read the engine to choose its next move, it generates no ledger state and no multi-step runs (row 14), and the shape vocabulary is mine. "Told nothing about what to look for" would be too strong: the shape list contains `diamond` and `stacked_diamond`, written after §23 was known. The searches were handed the failing SHAPE, not the failing CASE. | Reduced further, not closed |
| 11 | **Agent runs are simulated, with declared reactions.** 5 multi-step scenarios where untrusted content arrives mid-run and changes later steps; 0 stalled, 10 safe steps preserved after a refusal. No model means no surprising plans, so CaMeL's 77-versus-84 still has no equivalent. | Improved again, still not the real thing |
| 13 | **A wrong capability declaration voids the guarantee, and now there is a number for it.** Containment enforces flow *given* the declaration; nothing detects that an exfiltration tool was filed as `read_only_tool`. Re-running the imported split under deliberately understated declarations lets **21 of 30** direct-harm and **32 of 32** data-stealing attacks straight through. Not a containment failure — it is out of contract — but it is the single highest-leverage thing to audit in a real deployment, and it is now priced rather than described. `node scripts/mapping-report.mjs`. | Structural, quantified |
| 12 | **Small hand-authored corpus.** n=68 across five hand-written splits; 9 of those are derived. The 648 generated variants do not change that — they are mechanical transforms of 8 bases. | Structural |
| 14 | **No search exercises a ledger, and the receipt search is one process with a `Set`.** `pnpm adversary` now runs a third search over receipt shapes — valid, wrong capability, wrong role, wrong name, wrong slot, wrong value, wrong source, wrong rule, expired, spent, duplicate label, duplicate path, and one id reused across two arguments — against a binding oracle written separately from `coverFor`. Each of those branches was deleted and the search counted the resulting findings; the figures and the seed live in `DEFECTS_FOUND.md` section 34, which is their one home rather than a number repeated into a table nothing recomputes. Two of them were previously defended by nothing and by one unnamed file respectively (section 33). **It runs on six of the ten capability rows.** The four excluded - `text_response`, `transaction_prepare`, `account_modify`, `wallet_sign` - lift by nothing, so no receipt can admit anything there and generating one would test a path the policy says does not exist. Confirming rows are NOT excluded: `payment` and `transaction_broadcast` are searched, and they are the rows where a receipt matters most. This sentence said "four of the ten" and named payment and transaction_broadcast among the missing, which stopped being true when confirming rows were brought in; `receiptSearchScope` had computed the real answer since it was written and nothing called it. `pnpm adversary` now prints the computed scope, so the two cannot drift again - see section 37. **What else remains out of scope:** `spentReceipts` is a `Set` this process builds, not a database, so nothing here exercises a ledger adapter; there are no multi-step agent runs, so a replay ACROSS actions is only modelled by pre-seeding that set; and cross-host replay and the async reserve/settle protocol are covered by `prove:crosshost`, `prove:asyncledger` and `prove:postgres`, not by any search. The search also shares the lattice and the capability table's data with the engine, exactly as the other two do. | Reduced, not closed |


## The taint is cooperative, not enforced

CaMeL gets its guarantee from a custom interpreter that sees every operation. This library is a
cooperative TypeScript wrapper. `map(f)` hands `f` the raw value, and `f` can capture it. A developer
can call `unsafeUnwrap`, read the payload, and re-wrap it as clean. **There is no membrane in
JavaScript**, and anywhere `Tainted` is not threaded, there is no taint at all.

**What did change, and exactly how much.** Coercion is interceptable even though propagation is not:
`Symbol.toPrimitive` fires for a template literal, for `String(x)` and for `x + ""`, and `toString`
is overridden for the explicit call that ToPrimitive never sees. Those all used to produce the string
`[object Object]` silently. They now throw and name the sanctioned way out. `Object.prototype.toString.call`
still cannot be intercepted, and that gap remains open.
That is a TRIPWIRE, not a membrane - it catches the accidental interpolation, and it does nothing
about `map(f)`, about `unsafeUnwrap`, or about a value that was never wrapped. The result of a
coercion is a primitive, and no primitive can carry a label, so the propagation half of this
limitation is not merely open but unclosable in this language.

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

## The ordering proof is unavailable

`corpus/holdout/FREEZE.json` records `frozenAtCommit: null`, and it will stay that way.

A freeze was attempted. The commit recorded — `7bb2acce…` — already contained
`packages/core/src/policy.ts`, so `verify:freeze` rejected it: a commit where the engine exists
cannot witness a point where it did not. Checking the history showed why. **There is no
holdout-only pre-engine commit.** The corpus and the engine were first committed together, so there
is no object to point at.

**What is still true, and is what the project claims:**

- the 16 holdout cases have not changed;
- `MANIFEST.sha256` covers their bytes, and CI verifies it before anything else runs;
- that check has caught a real drift once, when a formatter rewrote JSON whitespace.

**What is not true, and appears nowhere:** that the holdout is *proven* to predate the engine.

**The lesson.** Authoring order leaves no trace; commit order does. The build was sequenced correctly
in the working tree and that sequencing was never captured, which is the same as not having done it —
a reviewer can check `git` and cannot check what order files appeared on a disk. To cash a freeze of
this kind, the holdout must be **committed** before the engine exists, not merely written first.

`verify:freeze` was not weakened to pass, and no commit that fails it has been recorded.

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
