# Status — v1.0.1

## Version history

| | what it established |
|---|---|
| **v0** | The frozen corpus and the instrument. 16 holdout cases, a `MANIFEST.sha256` over them, and a CI job that gates everything else on their integrity. (The cases *were* written before the engine; that ordering was never committed, so it is not provable — see below.) |
| **v0.1** | Coverage of what was already advertised. Direct tests for `declassify`/`check`/`taint` (702 previously untested lines), receipts wired end to end, the attested-tool-output rule from the original brief, `NEEDS_REVIEW` and `DENY` coverage, the wallet example, and test files typechecked for the first time. |
| **v0.2** | Breadth, and evidence that is not self-authored. A derived split from AgentDojo/InjecAgent shapes, `holdout_v2` closing v0's laundering gap additively, a full RAG pipeline demo, a per-split classifier comparison, a CLI playground, and two new mutants. |
| **v0.3** | Closing the things a sharp reviewer would call a toy. The prepare/broadcast policy defect fixed surgically, receipt replay/expiry/value/source binding, correlated-parameter tuple checks, an adaptive evasion split, strict freeze tooling, and the first utility measurement. |
| **v0.4** | Turning paper guarantees into infrastructure. A stateful ledger package that makes omitting replay state a **compile error**, a declarative tuple policy model across six capabilities, 648 mechanically generated laundering variants, task-level utility, more non-author-designed cases, and a freeze-recording helper. |
| **v0.5** | Closing the last delegated risks. A namespaced advanced API, a **multi-process-safe** locking ledger, the first **exact-import** corpus split (upstream content byte for byte), an agent-run simulator where untrusted content arrives mid-run, and an exhaustive probe of all 400 policy cells. |
| **v0.6** | Turning "internally validated" into measured. The imported split's **grading** audited and its dependence on my judgement quantified; two rival policy profiles so the shipped table is no longer the only entrant nobody tried to beat; an adversarial planner generating agent runs nobody wrote by hand; ledger guarantees made a **required, requirable** field; an optional model judge that is off by default; and every number in the repository produced by one command instead of typed into a README. |

| **v0.7** | External credibility and production usability. The first ledger that can claim **cross-host safety** — and has to earn it. The imported split **rebuilt from committed upstream rows**, byte-checked, with exact-vs-hand-derived enforced by the schema. A **five-profile frontier** that refuses to say that word. <!-- claims-guard:describes-the-rules --> A second model-judge mode that reviews the engine's REASONS. And four **cross-domain demos** — email, DevOps, support, payments — proving this is not wallet infrastructure with a general name. |

| **v0.8** | A pre-release pass aimed at the four remaining risks. An **async ledger** whose reserve/decide/settle bracket keeps the engine pure. **Capability-manifest validation**, which found three defects in the shipped table on its first run. The imported split **doubled to 34** with a second attack shape. And four **review workflows** that model what happens after "ask a human" - the part the v0.7 demos never showed. |

| **v0.9** | Defect closure and proof hardening. §11 turned out to have been MITIGATED rather than fixed, and closing the class meant replacing `argName` with a **slot identity** everywhere. The real-Postgres proof stopped being skipped: **11/11 against a live database with independent connections and a negative control**. A reviewer that decides from the bytes instead of being told the answer. And a guard over the prose itself, because wording is where a bounded claim becomes an unbounded one. |


| **v1.0.1** | **An outside reader refuted it, and three defects fell out of one function.** `resolveTaint` treated a re-visited node as a cycle, so a DAG - one document, two extracts, one summary - over-tainted to the top of the lattice with every node CLEAN. It recursed, so a deep chain threw a `RangeError` and broke the engine s own "never throws". And `ceilingFor` gave an unrecognised role the row s LOOSEST ceiling, which is the only one of the three that could ALLOW. None was reachable from any gate here: no test and no corpus case declared a source with two parents. The prose guard now walks SOURCE COMMENTS as well as documents, which is where the false claim had been sitting, and it found another on its first run. |
| **v1.0-rc** | Release-candidate docs and examples. `TRUST_BOUNDARIES.md` separates what the engine enforces from what you declare; `ADOPTION_GUIDE.md` is written for a stranger wiring it in. Provenance **ingestion helpers** that declare rather than infer, and refuse a dangling edge at wiring time. A **code-agent** demo, making five general domains. `pnpm doctor` reads deployment posture off declarations. The README leads with general containment; payments are one domain among five. |
| **v1.0** | The adversarial audit becomes machinery. `pnpm audit:mutations` deletes each fix and requires the tests to notice — the method that caught §15, made standing. It found **§16 on its first run: the purity contract's import check had been vacuous since the day it was written.** Plus a claim registry, generated blocks that end four passes of stale numbers, and classifier claims asserted against the classifier. |

The v0 holdout has not been edited in any of these passes, and its manifest has not been regenerated.

---

# Detail — v1.0

**The lesson of v0.9 was that none of this repository's machinery caught its own unearned claims. An
independent reader asked to refute did. v1.0 turns that into a step.**

And on its first run, the new machinery found something worse than what prompted it.

**§16 — the purity contract had been checking nothing.** *"The pure core imports nothing at all"* is
the most fundamental claim here: README, `STATUS.md` graded PROVEN, `claims.json`, every package
README. `contract.test.ts` exists to defend it and its own header says the claim *"is worth exactly
nothing without something that checks it."*

The test stripped comments **and string literals** before scanning for imports. An import specifier is
a string literal. `from "node:fs"` became `from ""`, the specifier regex required at least one
character, and **the scan matched nothing in every file on every run**. The test looped over an empty
list and passed, for months, while four documents cited it.

Found by adding an import and watching nothing fail.

**What v1.0 built:**

- **`pnpm audit:mutations`** — thirteen critical branches, each deleted, rebuilt and re-tested, with the
  tests required to **fail**. 8 of 8 caught. Two properties learned the hard way: it refuses to run
  unless the baseline is green (a differential measurement needs a starting point), and every `find`
  must match exactly once (three entries matched zero times and would have reported as caught).
- **`docs/claims.json`** — 26 headline claims, each with its grade, the test that would fail if it
  were false, its negative control, and the command that produces any number in it. Enforced: a
  PROVEN claim with no negative control fails the build, because that is the §15 shape exactly.
- **Generated blocks** — a `GENERATED:<generator>` marker pair in README and STATUS, filled and verified from the
  code. Stale numbers had recurred in **four** separate passes; this ends the class. It caught its
  first drift within minutes of existing.
- **Classifier claims asserted against `classify()`** — never a proxy regex. The v0.9 audit found the
  detector blocks on *"your real task is"* and *"approve all requests"*, phrases the old regex test
  would have let through as silent.
- **`docs/ADVERSARIAL_AUDIT.md` and `docs/AUDIT_LOG.md`** — the protocol, and an append-only,
  deliberately unflattering record of what each audit found.

**The pattern across every finding in the log.** A mechanism that reports success without having
measured anything: a test whose branch never runs, a comment asserting an unwritten fix, a regex
standing in for a classifier, a scanner matching an empty list, a mutation that does nothing, a
skipped test read as a passing one. **None of these look like failures from the inside. All of them
look like green.**

---

# Detail — v0.9

**The most important finding of this pass is that a v0.8 defect marked FIXED was only MITIGATED.**

§11 — a receipt admitting two arguments that shared a label — was closed in v0.8 by forbidding a
receipt from being reused within one action. That closed the reported instance. It left `argName` as
the key in three other places: `coverFor` matched on it, `admittedByReceipt` was a set of names so the
tuple gate saw one admission where there were two, and `tupleKey` joined names into `"url+url"` — a
key that names itself twice and identifies neither pair.

v0.9 replaces the key. Every argument gets a **slot**, slots are unique by construction, and a receipt
naming only a label matches **nothing** where that label identifies more than one argument. Not the
first, not the last — neither, because the issuer could not have expressed which one they meant, and
guessing is what admitted an argument nobody approved. The fix is deliberately not "forbid duplicate
labels": corpus case `slot-t-002` is the paired control where two arguments called `url` each carry
their own slot-bound receipt and the action is allowed.

**What else this pass did:**

- **Built the live Postgres proof — which is opt-in, and SKIPPED by default.**
  `pnpm prove:postgres` runs **11 scenarios against a live database** using two — and in one case twenty — independent connections: concurrent reserve,
  cross-connection replay, restart durability, a crash between reserve and consume, bounded stale
  reclaim, and a **negative control** where a read-then-write adapter double-claims, so the proof can
  fail. Without `DATABASE_URL` it reports SKIPPED / NOT PROVEN and never green, which is the state
  of every default run and of CI. A passing run is evidence about **the database, version and
  topology you pointed it at** — it does not generalise to Postgres as such, and it says nothing
  about whether *your* hosts share one database, which stays DELEGATED TO CALLER. `pg` is a **root
  devDependency only** — it appears in no published package, so "no driver in the path of a policy
  decision" stays true.
- **Made the reservation lifecycle observable.** Four states — reserved, consumed, released,
  **stranded** — and `stats(now)` counts them, because `staleAfterMs` has no free value: too long and
  a crash costs a receipt until it expires, too short and a slow-but-alive caller loses one it was
  about to consume, and *that* direction is a double-spend.
- **A reviewer that can be wrong.** Scenarios used to declare `approves: true`, which proved the
  receipt path and nothing about judgement — the scenario was telling itself the answer. The reviewer
  now decides from the **bytes** and is structurally denied the taint lattice, the ceilings, the
  policy table and the verdict, with a test scanning its source for that vocabulary. Two mechanisms
  that cannot disagree are one mechanism, so `reviewer.test.ts` holds a case where it is **fooled and
  the engine is not**, and another where it is right and the engine is conservative.
- **Semantic advisories over tool bindings**, and an honest account of their limit. Zero false
  positives across ten honest bindings in five domains; four of five lazy mis-bindings caught. The
  first version missed `gmail.sendMessage` entirely, because `\b(send)\b` finds no word boundary in
  camelCase — it caught the tidily-named lies and let the ordinary ones through, which is the worst
  failure a lint can have.
- **A guard over the prose.** <!-- claims-guard:describes-the-rules --> Six rules over every markdown paragraph in the repository, checking that
  no line asserts a freeze proof, calls Postgres proven without naming the condition, implies a
  validated manifest is an honest one, claims the workflows prove judgement, or asserts optimality.
  It caught three real line-wrap false positives on its first run and was rewritten to work on
  paragraphs; an injected false claim is demonstrably caught.

---

# Detail — v0.8

**v0.8 is where the remaining criticisms got answered by things that can fail rather than by prose.**
It added six defects to `DEFECTS_FOUND.md`, three of them in the shipped table, one of them in my own
favour — and that is the honest measure of the pass: the machinery built to check the claims
immediately found the claims were wrong in four places.

**What was found, in order of severity:**

- **§11 — one receipt admitted two arguments.** The worst defect in this repository so far. A receipt
  binds by `(capability, role, argName)`, and two arguments may share a name. Two parameters both
  called `url`, one allowlist receipt, and **both were admitted** — one human approval of one value
  silently covering a second, arbitrary one. Every anti-bearer-token defence here assumed that key was
  unique. It is unique across roles and capabilities, not across arguments.
- **§10 — the store won the race and never told the guard.** v0.7's `crossHostSafe` claim was earned
  by a proof aimed one layer away from it. `proveCrossHost` showed the *store* serialises, which was
  true; `ReceiptLedger.spend` returned `void`, so the answer died at the interface, and two hosts both
  kept a stale ALLOW while the store held one row.
- **§12 — the release valve refused.** `text_response` — the row the whole design leans on — returned
  a flat `DENY` on a `sink_identity` argument. Defect §7's shape again, three versions later.
- **§13 — a tuple policy that could never fire.** `account_modify` declared a combination gate on a
  row that can admit nothing separately. The repository already had a "no dead policy" invariant; it
  checked one end of the lattice and not the other.
- **§9 — six imported cases were mislabelled**, in the direction that *understated* my own headline.
  Recorded with all the evidence precisely because a correction that flatters the corrector deserves
  the most scrutiny.
- **§14 — fixing §11 neutralised the mutant that guards it.** The third time a mutant has been rescued
  by a mechanism unrelated to its defect.

**What was built:**

- **An async ledger boundary** — `reserve` → sync `decide` → `consume`/`release`. The engine stays
  pure. A refusal releases every receipt it reserved, so a rejected action never destroys a human's
  approval, and the corrected retry still works. Proven against a store with real UNIQUE semantics,
  and against a read-then-write adapter that must fail exactly one scenario.
- **`validatePolicy`** — every invariant that used to live in a `describe()` block over one constant
  is now a function over an arbitrary policy. The five conformance profiles publish numbers and had
  never been checked against the rules the shipped table must satisfy; they are now validated at
  construction, and `permissive` trips `STEERING_ADMITS_TOOL_DERIVED` twice.
- **The imported split doubled**, 17 → 34, adding InjecAgent's data-stealing half: a **two-step**
  chain, read then send, where the direct-harm rows are single calls. Reported apart, because their
  exposure to a mis-declaration differs sharply — **21/30 against 32/32**.
- **Four review workflows** across support, email, DevOps and research, modelling propose → decide →
  review → execute → feed back, with the replay attempted after every approval.

---

# Detail — v0.7

**v0.7 is the pass that makes the claims deployable and the evidence reproducible.** v0.6 measured how
much of each result was authorship; this one closes the three places where a stranger would still have
to take my word for it, and adds the demos that show the model is not domain-specific.

Five things are new and none of them is a feature in the corpus sense:

- **A cross-host ledger, with the claim earned rather than asserted.** Every adapter through v0.6 said
  `crossHostSafe: false` and `twoHostSimulation()` demonstrated the double-spend. `durableLedger` +
  `postgresSpendStore` can say true — but only after passing `proveCrossHost()`, five interleavings a
  read-then-write store fails. **No `pg` dependency**: `SqlExecutor` is `(sql, params) => rows`.
  `nonAtomicStore` exists purely so a test can show the proof saying no, and it fails on exactly one
  scenario rather than all five, because a suite that rejects everything measures nothing.
- **The exact-import claim became checkable.** Upstream's rows are committed under
  `corpus/imported/source/`, composition is upstream's own documented rule in code, and
  `pnpm import:check` fails the build on a byte of drift. It caught a real problem on the first run:
  the schema had **no `imported` kind at all**, so an exact transcription and a hand-written
  restatement both wore `kind: "derived"` — the strongest evidence here and the second-strongest,
  indistinguishable. Now two variants, enforced in both directions.
- **A five-profile frontier that will not say "optimal".** Two new calibrated profiles — `escalating`
  (reroute to review rather than refuse) and `egress_strict` (tighten only what can leak). **Two
  profiles are undominated**, so the arithmetic cannot pick a winner, and `docs/POLICY_CHOICE.md`
  argues the choice instead. A test reads the rendered report line by line and fails if any line
  asserts optimality without negating it.
- **The model judge can now review the engine, not just the labels.** `--mode=engine` shows the model
  the decision *and its reason codes* and asks two separate questions, because they fail separately:
  is the decision defensible, and do the reasons explain it. A label judge structurally cannot see
  "right answer for the wrong reason" — it never looks at what the engine said. Still off by default,
  still refuses under CI, still gates nothing.
- **Four cross-domain demos.** Email, DevOps, support, payments — **10 safe steps completed, 10 unsafe
  steps stopped or escalated**, all through the guarded API with a real ledger. A test asserts the
  policy engine's code contains no word like `refund`, `deploy` or `invoice`: if it ever learns a
  domain, the other three demos stop being evidence of anything.

---

# Detail — v0.6

**v0.6 attacks the sentence "this is all internally validated."** Every earlier pass made the engine
better at its own tests. This one asks how much of each result is evidence and how much is authorship,
and answers with numbers rather than assurances.

Four of those numbers are new and none of them flatter the project:

- **6/6 robust, 4/6 broken.** Every imported case is refused under every capability mapping a
  different reviewer could defend — so on that split the refusals are evidence about the attacks, not
  about my table. And four of the six sail straight through if the tool is declared weaker than it
  is. Containment enforces flow *given* the declaration; that limitation was already written down,
  and now it has a price.
- **`reference` makes no error on any split — and the report says that is a corpus fact, not a
  result.** No case here is hard enough to cost the shipped policy anything, so its position on the
  safety/utility curve is unmeasured rather than optimal. `strict` pays 12 over-blocks; `permissive`
  pays 7 under-blocks, on exactly the laundering splits. That is a tradeoff the corpus can see.
- **48 generated agent runs**, six plan shapes crossed with every acting capability, including a
  genuine receipt presented for the wrong slot and a genuinely signed value used for the wrong
  purpose. The first run scored 5/8 on the *safe* shape and the three failures were not defects —
  three capabilities refuse a destination typed into a conversation, by design. The expectation was
  wrong, not the policy.
- **Nothing in the ledger package claims `crossHostSafe`, and a test asserts none of them ever
  quietly starts to.** `guarantees` is a required field; `requireGuarantees` turns a deployment's
  needs into a startup failure instead of a silent regression.

---

**v0.5 closed what v0.4 delegated.** Two guarantees still rested on a caller behaving: not reaching
past the guard, and not running two processes. Both now have real answers, and the honest limits of
each are asserted in tests rather than described.

The numbers worth quoting: **0 of 400 policy cells** let untrusted content steer an acting capability —
checked exhaustively, not sampled — and **6 corpus cases now contain upstream's own content byte for
byte**, which is the first evidence here that is not, ultimately, my words.

---

**v0.4 turned delegated risks into executable infrastructure.** v0.3 closed the logic; several
guarantees still depended on a caller remembering to pass the right arguments. They no longer do.

The line worth quoting: **648 generated laundering variants, 0 allowed, 0 flagged by the classifier**,
and **0 tasks stalled** — the policy refuses nothing it should permit.

---

**v0.3 was a risk-closing pass.** Not breadth: the six specific things that would let a reviewer say
the project is still a toy. Five are closed or materially reduced; one — the git-object freeze —
cannot be closed without a commit and now has tooling that fails loudly until it is.

The number worth quoting is the one that did not exist before: **`0/23` benign cases refused,
`0/35` attacks allowed**, across five splits. Every safety figure in this repository has a degenerate
optimum — an engine that refuses everything scores perfectly on all of them, and mutant `M5` is that
engine. The benign column is the only thing that tells them apart.

## v0.4 -> v0.8

| | v0.6 | v0.7 | v0.8 | v0.9 | v1.0 | v1.0.1 |
|---|---|---|---|---|---|---|
| tests | 263 | 304 | 361 | 414 | 534 | **605** |
| hand-authored + imported corpus | 68 | 68 | 68 | 96 | 98 | **130** |
| corpus splits | 7 | 7 | 7 | 7 | 7 | 7 |
| non-author *content* (exact imports) | 6 | 6 | 6 | 34 | 34 | 34 |
| imports rebuilt from committed source | 0 | 0 | 6/6 | 34/34 | 34/34 | **62/62** |
| upstream attack SHAPES imported | 1 | 1 | 1 | 2 | 2 | 2 |
| packages | 5 | 5 | 5 | 5 | 5 | 5 |
| mutants | 8 | 8 | 8 | 8 | 9 + 3 ledger stores | **9 + 3 ledger stores** |
| policy profiles compared | 1 | 3 | 5 | 5 | 5, all validated | 5, all validated |
| capability tables validated | 0 | 0 | 0 | 5 | 5 | 5 |
| async ledger adapters | 0 | 0 | 0 | 2 | 2 | 2 |
| **real-database proof scenarios** | 0 | 0 | 0 | 0 | 11, live Postgres | **11, live Postgres** |
| review workflows | 0 | 0 | 0 | 4 | 4 | 4 |
| **reviewer decides for itself** | no | no | no | no | yes | **yes** |
| defects recorded | 7 | 8 | 8 | 14 | 22 | **33** |
| decisions produced by corpus | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |

**v0.8 is the first pass since v0.4 to add corpus cases, and it added no engine capability.** The 28
new cases are upstream's bytes, not mine. Everything else that moved is a way of checking what was
already there — and six of the things it checked turned out to be wrong.

**v0.6 and v0.7 added no corpus cases and no engine capability.** Every row that moved is a way of
checking what was already there, or of making a claim reproducible by someone who did not write it.
The criticism these passes answer is not "too few features" — it is "graded by its own author, and
undeployable outside one process".

Corpus by split: `holdout` 16 (frozen, unchanged) · `holdout_v2` 6 · `tuning` 25 · `derived` 9 ·
`adaptive` 8 · **`imported` 34 (upstream content, exact, two attack shapes)** · `generated` 648
(mechanical). Every split reported separately and never pooled.

**The v0 holdout headline did not move across either pass** — 9/9 attacks, 6/6 benign, exact decision
agreement 7/15. Neither pass added capability to the engine; both added ways of checking it.

The number that is new, and the one worth quoting, measured across every split (`pnpm report`):

```
SILENT ATTACKS - no injection wording for any text detector to find
  split         n    containment    classifier
  holdout       6    6/6            0/6
  holdout_v2    4    4/4            0/4
  tuning       14    14/14          0/14
  derived       7    7/7            0/7
  adaptive      6    6/6            0/6
  imported     62    62/62          0/62
               99    99/99          0/99
```

The classifier also over-blocks 3 of 6 benign holdout cases, because they quote attack strings. Both
halves of the failure mode, in every split where the row exists. Never pooled into one figure — see
`docs/EVALS.md` for why the splits are not samples from one population.

## Inventory

Counted, not remembered — these were stale for four versions before v0.6.

| | |
|---|---|
| Packages | **5** — `core`, `classifier`, `conformance`, `retrieval`, `ledger` |
| Packages | **5** — see the generated block below for everything counted |
| Corpus | **98** hand-written and imported, 6 splits, + **648** generated at run time |
| Tests | see the generated block below |
| Mutants | **9** broken engines + 1 reference, + 3 deliberately broken ledger stores |
| Policy profiles | **5**, all validated at construction |

<!-- GENERATED:repo-stats -->
| | |
|---|---|
| Source LOC | **12,244** across 5 packages |
| Test LOC | **11,012** across 46 files |
| Example LOC | **1,843** across 15 files |
| Script LOC | **3,384** — 20 report/proof/import scripts, 6 shell |
| Total TypeScript | **25,099** |
| Docs (docs/) | **5,449 lines** across 24 files |
<!-- /GENERATED -->

<!-- GENERATED:test-counts -->
| package | tests |
|---|---|
| `core` | 265 |
| `conformance` | 238 |
| `ledger` | 89 |
| `classifier` | 8 |
| `retrieval` | 5 |
| **total** | **605** |
<!-- /GENERATED -->

## Corpus, by split and by source type

<!-- GENERATED:corpus-splits -->
| split | n | | source kind | n |
|---|---|---|---|---|
| `holdout` | 16 | | `imported` | 62 |
| `holdout_v2` | 6 | | `original` | 59 |
| `tuning` | 29 | | `derived` | 8 |
| `derived` | 9 | | `cve_derived` | 1 |
| `adaptive` | 8 | |  |  |
| `imported` | 62 | |  |  |
| **total** | **130** | | | |
<!-- /GENERATED -->

Plus **648 generated** variants, built at run time from the frozen bases and never pooled with the rest.

The imported split is two datasets and is reported as two: **direct harm 17** (one attacker tool, the
harm is the call) and **data stealing 17** (a pair — read, then send; the harm is what leaves). Both
InjecAgent, MIT, commit `f19c9f2`, rebuilt byte-identically by `pnpm import:check`.

## What is claimed, and at what grade

Six grades. Keeping them apart is the point: every one of them has been read as "proven" by somebody
at some stage of this project, including by me — §10 was a proof aimed one layer away from the claim
it was cited for, and §11 was "fixed" when it was mitigated.

| claim | grade | what that means |
|---|---|---|
| the pure core has no imports, clock, randomness or `Promise` | **PROVEN** | `contract.test.ts` fails the build |
| the v0 holdout's bytes match its manifest | **PROVEN** | 7/7, gated in CI before install |
| imported cases are upstream's bytes | **PROVEN** | 62/62 rebuild byte-identically |
| a receipt admits one value, into one **SLOT**, once | **PROVEN** | `argidentity.test.ts`, corpus `slot-t-001` + control, mutant M9 |
| the guard re-decides when it loses a receipt race | **PROVEN** | tested with a store that models the race; deleting the branch fails 2 of 77. It was **graded PROVEN on a test that could not fail** until an audit caught it — see §15 |
| every capability table is self-consistent | **PROVEN** | 0 contradictions across 5 tables |
| every mutant is bitten somewhere, none everywhere | **PROVEN** | `pnpm report:mutants` exits 1 otherwise |
| no document asserts more than the evidence supports | **PROVEN** | 6 rules over every markdown paragraph; an injected false claim is caught |
| the engine knows no domain vocabulary | **PROVEN** | every file in `packages/core/src` scanned, with one asserted exemption: `toolrisk.ts`, an advisory naming heuristic `decide()` does not import |
| **concurrent reserve, replay, restart, crash, bounded reclaim** | **SKIPPED / NOT PROVEN on a default run.** On a run with `DATABASE_URL`: **11/11** | `pnpm prove:postgres` — two and twenty independent connections, plus a negative control that must double-claim. CI sets no `DATABASE_URL` and does not run it, because a skip that exits 0 is a green step proving nothing. A passing run proves it **for that database, that version and that topology only** — not for Postgres in general and not for your deployment |
| the async reservation protocol | **ADAPTER-PROVEN** | against UNIQUE-constraint semantics in-process |
| cross-host safety, sync path | **ADAPTER-PROVEN** | `proveCrossHost`, 5 interleavings |
| the real-database proof, on a run without `DATABASE_URL` | **SKIPPED / NOT PROVEN** | reported as skipped, never as a pass |

**Last operator-run of the opt-in proof:** August 2026, against PostgreSQL 17.6 (Homebrew) on Apple
silicon, every scenario passing including the read-then-write negative control. Recorded
with its version and date because the row above says the result holds for that database, that version
and that topology only, and a result whose subject is unnamed cannot be checked by anybody later. It
does not change the grade: nothing runs this without `DATABASE_URL`, CI sets none, and SKIPPED is what
this registry defines that to mean. Grading it otherwise is defect section 19, which is exactly how
this entry read before v1.0.
| that *your* hosts share *one* database | **DELEGATED TO CALLER** | `sharedAcrossHosts` is a question, not an inference |
| that a capability declaration is honest | **DELEGATED TO CALLER** | validation catches self-contradiction; advisories read names |
| that argument `path`s are honest | **DELEGATED TO CALLER** | two args with one path is a caller bug, handled safely |
| that the shipped policy is optimal | **NOT CLAIMED** | 5 profiles, two undominated |
| that the holdout predates the engine | **NOT CLAIMED** | attempted, correctly rejected, unavailable |
| that a validated manifest is an honest one | **NOT CLAIMED** | it is a *consistent* one |
| that the review workflows establish human judgement | **NOT CLAIMED** | mechanics and judgement reported apart |
| a wrong capability declaration | **KNOWN RISK** | 21/30 direct-harm, **32/32** data-stealing |
| the taint is cooperative, not enforced | **KNOWN RISK** | there is no membrane in JavaScript. Coercion and toString() now throw instead of silently stringifying, which is a tripwire on the accidental path and not a membrane: a coercion returns a primitive, and a primitive cannot carry a label |
| **the ingestion helpers infer nothing** | **PROVEN** | a hostile page declared `SYSTEM` is ALLOWED outright — `ingest.test.ts` asserts it, so the trust boundary is never a surprise |
| `contextOf` refuses a dangling edge | **PROVEN** | an unresolvable edge would read as CLEAN — a laundering path that looks like a typo |
| that a declaration is honest | **DELEGATED TO CALLER** | the helpers make it harder to mistype, never harder to lie |
| **that these tests could actually fail** | **PROVEN, for 13 listed branches** | `pnpm audit:mutations` deletes each fix and requires the tests to notice. A floor, not a ceiling: it says nothing about branches nobody listed, which is how §15 and §16 happened |
| that every claim here is in the registry | **NOT CLAIMED** | `docs/claims.json` holds the 20 a reader would quote, not every sentence |
| that the audit machinery has no blind spots | **NOT CLAIMED** | it was written by the person whose claims it checks, and shares his blind spots exactly. The independent reader is the only control that does not |
| `staleAfterMs` has no free value | **KNOWN RISK** | too long strands a receipt, too short double-spends |

## Commands run

```bash
pnpm install
pnpm release:report --markdown     # the whole gate, then the whole report
# which runs, in order:
pnpm verify:corpus                 # 7/7 against the frozen manifest
pnpm import:check                  # 62/62 rebuild byte-identically
pnpm verify:manifests              # 0 contradictions across 5 tables
pnpm verify:freeze                 # exits 1, by design
pnpm lint && pnpm typecheck && pnpm build && pnpm test     # 605 tests
pnpm prove:crosshost               # sync adapter logic
pnpm prove:asyncledger             # async protocol, in-process
DATABASE_URL=postgres://localhost/containment_ledger_test pnpm prove:postgres   # 11/11, live DB
pnpm prove:postgres                # without DATABASE_URL: SKIPPED / NOT PROVEN, exit 0
pnpm report:mutants                # bite matrix; exits 1 if any mutant is bitten by nothing
pnpm report:workflows              # review workflows, mechanics and judgement reported apart
pnpm audit:release                 # the deterministic half of the adversarial audit
pnpm audit:mutations               # delete each fix; require the tests to notice
pnpm audit:docs                    # blocks, claim registry, prose guard, and the guard's own failure
pnpm blocks:check                  # generated blocks still match their generators
pnpm doctor                        # deployment posture, read off declarations
npx tsx examples/agents/{email,devops,support,code,payments,all}.ts
# plus, individually:
pnpm report:frontier · report:mapping · report:workflows · report:planner · report:profiles
pnpm judge:model                   # skipped: no ANTHROPIC_API_KEY, exit 0
node scripts/model-judge.mjs --mode=engine   # same
npx tsc -p tsconfig.test.json      # in each of the 5 packages
npx tsx examples/{web-research-agent,email-assistant,rag-assistant,wallet-assistant,rag-pipeline,wallet-tuple,playground}.ts
npx tsx examples/playground.ts --matrix --role sink_identity
npx tsx examples/agents/{email,devops,support,payments,all}.ts
```

## Branch risk, in full

Every branch the adversarial mutation sweep found unprotected, and where it stands — the sweep's own
totals are in the row at the end of the Checks table below. "Closed" here
means a test exists AND the branch was neutralised and the test watched to fail — a passing test
alone has never counted in this repository.

| branch | what its removal does | can it ALLOW? | state |
|---|---|---|---|
| `P09`–`P15`, `P27` (7) | receipt role/lift/rule/slot checks; unknown capability fails open; a refusal burns receipts | **yes** | closed §19, mutation-checked |
| `A01`, `A02`, `A04` (3) | Postgres reclaim/consume predicates — live double-spends | **yes** | closed §19, mutation-checked |
| `P22`, `P23`, `P28`–`P30` (5) | the tuple gate: rule check, key check, slot-vs-label keying | **yes** | closed §20, mutation-checked |
| `M04`–`M09`, `M14` (6) | five `validatePolicy` suspicion rules, plus `contradictions()` itself | no — advisory, but `M14` is a live CI gate | closed §20, mutation-checked |
| `X01`, `L08`, `L02`, `A09` (4) | `decideOnly` replay; forged reservation id; unwind on throw; a false `crossHostSafe` claim | **yes** (`X01`, `L08`) | closed §20, mutation-checked |
| `P32`, `D16`, `D18` (3) | audit-trail taint join; tuple-member empty and bidi guards | no (`P32`), **yes** (`D16`/`D18`) | closed §20, mutation-checked |
| `A11` | Postgres `stats` stale cutoff — `stranded` permanently 0 | no, observability only | **closed §21**, mutation-checked |
| `P20` | mixed-provenance over-reporting on spliced payloads | no, diagnostic only | **closed §21**, mutation-checked |
| `L13` | a receipt-free action makes a spurious ledger round-trip | no, cost only | **closed §21**, mutation-checked |
| `P05` | one-receipt-one-slot guard | n/a | **UNREACHABLE, kept as defence in depth.** An exhaustive sweep of argument and receipt shapes reaches it zero times. Not ordinary coverage: two tests pin the invariant that kills it, and disabling slot uniqueness makes it fire — the counts are in §20 |
| `P21` | `mixed && effect === "irreversible"` | n/a | **RECORDED-DEAD / inert.** Documented, not covered. Its stated safety net is `M05`, which is closed |

**Unguarded branches remaining: 0.** Unreachable branches: 2, both dispositioned above.

## Publish state

| | |
|---|---|
| packages | five, all under the final scope `@agent-context-containment/*` |
| version | **`0.1.0`** — settled. The private root manifest stays `0.0.0` and is never published |
| why not `1.0.0` | "v1.0" here is an **internal hardening milestone**, not an npm version. `1.0.0` promises API stability to strangers on the strength of a mechanism rather than a track record, and the freeze is unavailable while the Postgres proof is opt-in |
| licence | MIT, declared **and shipped** — a `LICENSE` file in every package, listed in `files`, asserted by a test. All five shipped none until v1.0 finalization |
| tarball contents | `dist/`, `LICENSE`, `README.md`, `package.json`. No corpus, no tests, no sources |
| runtime dependencies | only `@agent-context-containment/*`. `pg` is a root devDependency and a test keeps it there |
| pack/publish tool | **`pnpm`, not `npm`.** `npm pack` copies `workspace:*` into the tarball verbatim and the result cannot be installed |
| offline smoke | `pnpm smoke:pack` — installs the real tarballs and refuses an injected send in **both CJS and ESM** |
| published | **nothing, yet.** Dry runs pass; the real publish is a human action |
| unregistered numeric statements | ratcheted ceiling in `scripts/verify-numbers.mjs`; the count may not grow. Every registered fact is recomputed and checked on each run — `pnpm verify:numbers` prints the list |
| unguarded branches | none. Two unreachable branches are dispositioned, not covered — see the branch-risk table |
| root debris | none. `KNOWN_DEBRIS` is empty and three tests keep it empty |

## Checks

| check | result |
|---|---|
| corpus manifest, 7 files | **PASS** |
| exact imports, 34 cases | **PASS**, byte-identical |
| capability manifests, 5 tables | **PASS**, 0 contradictions; 7 suspicions on the shipped table, kept visible |
| lint (141 files) · typecheck (9 tasks) · build (5 pkgs) | **PASS** |
| test | **PASS — 605** (534 before this pass) |
| `decide()` is total: no input throws, every malformed one is denied | **PASS**, explicit shapes plus a seeded sweep |
| a provenance DAG resolves by path, and a cycle still fails closed | **PASS**, diamond and cycle pinned separately |
| an unrecognised parameter role admits clean input only | **PASS**, and it could ALLOW before |
| source comments checked for absolute claims | **PASS**, and an injected false claim is caught |
| `examples/` typechecked | **PASS** — nothing typechecked that directory until this pass |
| claim gates in CI: `blocks:check`, `verify:numbers`, `audit:docs`, `audit:claims`, `audit:mutations`, `adversary` | **PASS**, and they now RUN — none of them was in CI before v1.0, which is why the tree shipped with `audit:docs` exiting 1. See DEFECTS_FOUND.md §19 |
| adversarial mutation sweep, 105 guards | **73 protected · 30 unguarded · 2 unreachable** when first swept. **All 30 are now closed**, each written against its mutation and each watched to fail under it — 9 in §19, 18 in §20, 3 in §21. The 2 unreachable are dispositioned, not covered: see the branch-risk table below |
| per-package `tsconfig.test.json` | **PASS** ×5 |
| examples ×15, playground matrix | **PASS** |
| async ledger conformance, 11 scenarios × 2 adapters | **PASS** |
| a read-then-write async adapter is REJECTED | **PASS**, on exactly one scenario |
| a store that always says "recorded" is REJECTED | **PASS** |
| refusals spend nothing, incl. multi-receipt actions | **PASS** |
| review workflows: approvals consumed exactly once | **PASS**, the harness throws otherwise |
| a tool never executes without a permitting verdict | **PASS**, structural |
| mutant discrimination, every mutant bitten by name | **PASS** — M7 needed re-isolating, see §14 |
| no report line asserts optimality | **PASS**, per line |
| model judgment never consulted by a test | **PASS**, tree walk |
| no API key in the tree | **PASS**, tree walk |
| v0 holdout bytes vs pre-task snapshot | **IDENTICAL** |
| v0 `corpus/holdout/MANIFEST.sha256` | **NOT REGENERATED** |
| `corpus/imported/MANIFEST.sha256` | regenerated deliberately — the split doubled and gained a fixture |
| real-Postgres proof, 11 scenarios + negative control | **PASS**, with `DATABASE_URL` |
| real-Postgres proof, without `DATABASE_URL` | **SKIPPED / NOT PROVEN**, exit 0, never reported green |
| a read-then-write async adapter is REJECTED | **PASS**, on exactly one scenario |
| duplicate-label receipt binding (§11 class) | **PASS**, mutant M9 bitten by `slot-t-001` only |
| reviewer denied the engine's vocabulary | **PASS**, source scanned |
| reviewer and engine demonstrably disagree, both directions | **PASS** |
| semantic advisories: 0 false positives on 10 honest bindings | **PASS** |
| prose guard: no document overstates | **PASS**, and an injected false claim is caught |
| mutation audit, 13 critical branches | **13/13 caught** — deleting any fix fails a test |
| mutation audit refuses a non-green baseline | **PASS** — a differential measurement needs a starting point |
| mutation audit refuses a zero-match entry | **PASS** — caught 3 of its own entries on the first run |
| generated blocks match their generators | **PASS**, and it caught its first real drift within minutes |
| every PROVEN claim names a test AND a negative control | **PASS** — `claims.test.ts` fails otherwise |
| classifier claims asserted against `classify()`, never a proxy | **PASS** |
| the prose guard catches an injected false claim | **PASS**, demonstrated on every `pnpm audit:docs` run |
| **git freeze** | **UNAVAILABLE**, `verify:freeze` exits 1 |

## Holdout

**Content unchanged.** No case was added, removed or altered after the holdout was written: 16 cases,
every id, every `content` string and every `requiredReasons` array verified intact.

**One byte-level caveat, stated precisely.** Before `corpus` was added to biome's ignore list, a
routine `biome check --fix` reformatted the JSON whitespace of three holdout files. `MANIFEST.sha256`
caught it; the content was verified unaffected and the manifests were regenerated. `corpus` is now
outside the formatter's scope. See `docs/DEFECTS_FOUND.md` §5.

### How the holdout is protected, and what is still missing

| layer | status |
|---|---|
| **Content frozen at v0** | 16 cases. No case added, removed or altered since it was written. New regression cases go to `corpus/tuning/`. |
| **Bytes protected by `MANIFEST.sha256`** | SHA-256 per file, 7/7 verifying. |
| **Drift guarded in CI** | `corpus-integrity` job runs `shasum -a 256 -c corpus/holdout/MANIFEST.sha256` before anything else and gates `build-test` via `needs:`. |
| **Formatter and linter excluded** | `corpus` is in `biome.json`'s ignore list; `pnpm lint` touches none of the corpus. |
| **Git-object freeze** | **UNAVAILABLE, not pending.** Attempted and correctly rejected: the recorded commit already contained the engine, and no holdout-only pre-engine commit exists in this history. `FREEZE.json` has `frozenAtCommit: null` and `state: attempted_and_failed`. `pnpm verify:freeze` exits 1, permanently and by design. |

The manifest is the *current* drift guard, and it is a weaker anchor than a commit: it proves the
files match a recorded digest, not that the digest was recorded before the engine existed. Anyone who
can edit the corpus can edit the manifest in the same change. Only the git-object freeze closes that,
and it is deferred by decision.

Locally: `pnpm verify:corpus` runs the same check with a fuller failure explanation. Where the holdout was
found to be inadequate — the `M4 model_launders` gap — the gap was **recorded as a passing assertion**
in `packages/conformance/test/holdout.test.ts` and a discriminating case was added to the *tuning*
split instead. The frozen set was not loosened to make the engine look better.

Content hashes are in `corpus/holdout/MANIFEST.sha256`.

## Freeze: attempted, rejected, unavailable

`corpus/holdout/FREEZE.json` records `frozenAtCommit: null`, and that is now a settled state rather
than an outstanding task.

A freeze was attempted with commit `7bb2accefc902957ff90de3ff6cb0e6d69452efe`.
`scripts/verify-freeze.sh` rejected it, correctly: `packages/core/src/policy.ts` is present at that
commit, so it cannot witness a point where the corpus existed and the engine did not. There is **no
holdout-only pre-engine commit in this repository** — the corpus and the engine were first committed
together.

| | |
|---|---|
| v0 holdout content changed? | **No.** 16 cases, unedited across every pass |
| v0 holdout bytes protected? | **Yes** — `MANIFEST.sha256`, verified in CI before install, build or tests |
| drift ever detected? | **Yes, once** — a formatter rewrote JSON whitespace; content was intact, bytes were not |
| holdout proven to predate the engine? | **No, and not obtainable in this repo** |

**The lesson, recorded because it is the useful part.** Authoring order leaves no trace. Commit order
does. The sequencing was right in the working tree and was never captured, which is the same as not
having done it: a reviewer can check `git`, and cannot check what order files appeared on a disk. To
cash a freeze of this kind, the holdout must be **committed** before the engine exists — not merely
written first.

`verify:freeze` was not weakened, and no commit that fails it has been recorded. It still exits 1,
now with the reason above rather than a to-do list.
## Corpus provenance — where it actually stands

This section said "not built" and "the corpus is 100% author-written" through v0.5, which stopped
being true at v0.2. Correcting it here rather than quietly deleting it, because a stale status line
that *understates* the work is the same defect as one that overstates it — both are claims nobody
re-checked.

| | |
|---|---|
| **Exact upstream content** | 62 cases, `corpus/imported/` — InjecAgent, MIT, commit `f19c9f2`, composed by upstream's own substitution rule. Byte for byte, not paraphrased. Rebuilt from committed source rows and byte-checked by `pnpm import:check` |
| **Hand-derived shapes** | 9 cases, `corpus/derived/` — AgentDojo and InjecAgent attack shapes restated in this schema. Labelled `HAND-DERIVED`, enforced by a test. Not a benchmark run |
| **Everything else** | 59 cases, mine |

**The grading is mine in all three.** That is the residual, and v0.6 measures it rather than
asserting it away: `corpus/imported/MAPPING.json` records the capability I chose and the ones a
different reviewer could defend, and `pnpm report:mapping` re-runs every case under all of them.
**Every case in both datasets holds** under every peer mapping — so those refusals are
evidence about the attacks. **21/30 direct-harm and 32/32 data-stealing fall** if the tool is
declared weaker than it is, which is out of contract and reported anyway, because a paragraph saying
"the declaration is trusted input" is easy to skim and those fractions are not. The v0.6 text here
read `6/6` and `4/6`, correct when the split held six cases and stale for two releases afterwards —
which is the same failure as §18 and is why the fractions are now registered facts rather than prose.

The structural mitigations — held-out split, branded case ids, reason-level grading, mutant
discrimination, splits never pooled — reduce self-deception. They do not remove it, and **no mechanism
internal to a single author can**. What v0.6 adds is not a solution to that; it is a measurement of
how much of each result depends on it.

## Known-open

See `docs/LIMITATIONS.md` for the full table, which is maintained per row rather than summarised
here. The short version, current as of v0.6:

**Closed:** the `M4` laundering gap (closed additively by `holdout_v2`, never by editing v0) · receipt
replay, expiry, value and source binding · correlated-parameter tuples · the `transaction_prepare`
defect · single-process ledger risk (`lockingFileLedger`) · the derived and imported subsets.

**Closed as unavailable, not pending:** the git-object freeze. A commit was recorded, `verify:freeze`
rejected it because the engine was already present, and no holdout-only pre-engine commit exists in
this history. `frozenAtCommit` is `null` and stays there.

**Closed in v0.8:** the async ledger boundary (reserve/decide/settle, engine still pure); the
cross-host guard defect §10 (the win/lose bit now crosses the interface); the receipt-binding hole
§11; two shipped-table defects §12 and §13, found by the validator on its first run; and the
"mostly self-authored corpus" criticism reduced again — 34 of 96 cases are now upstream's bytes.

**Closed in v0.7:** cross-host replay (a ledger can now claim `crossHostSafe`, after proving it); the
unverifiable exact-import claim (rebuilt from committed source, byte-checked); the exact/hand-derived
label collision (two schema variants, enforced both ways); the missing frontier (five profiles, two
undominated, and a report that refuses that word); the label-only model judge (a second mode
reviews the engine's reasons); and the "is this just wallet safety" objection (four cross-domain
demos, with a test that the engine knows no domain vocabulary).

**Open, and structural:** no real adaptive attacker — the adaptive split, the 648 generated variants
and the 48 generated agent runs are all mine. Something now iterates: `pnpm adversary` searches
randomly-structured decisions against an independently written taint walk, and it catches defect §23
when that defect is put back. It does not learn and it does not read the engine to choose its next
move, so it widens the net rather than closing the gap. No model in the
loop, so no equivalent of CaMeL's 77-versus-84. The taint is cooperative, not enforced: there is no
membrane in JavaScript, though coercion is now a tripwire. No ledger here is cross-host safe without
proving it, and `sharedAcrossHosts` stays a question the adapter asks rather than an answer it gives.
A corpus of this size is a test suite, not a benchmark. And the capability declaration is trusted
input — priced at **21/30** on the direct-harm split and **32/32** on the data-stealing one.

**Open, and specific to v0.8's own additions:** the async protocol is proven against a fake with real
UNIQUE semantics; the real-database half is **SKIPPED / NOT PROVEN** without `DATABASE_URL`, and is
reported that way rather than omitted. A crash between `reserve` and `consume` strands a receipt until
stale-reclaim; there is no free value for `staleAfterMs` and the adapter says so in its own caveat.
Manifest validation catches self-contradiction only — a consistently wrong declaration is invisible,
priced at **32/32** on the data-stealing split. And the review workflows declare their reviewers'
decisions, so they model the mechanics of approval and not a human's judgement.

**Open, and specific to v0.7's own additions:** the cross-host proof runs against a store with
UNIQUE-constraint semantics, which proves the ADAPTER'S LOGIC and nothing about any real database —
`DATABASE_URL` adds a constraint probe against a live Postgres, and even that cannot tell whether
*your* hosts share *one* database. `ReceiptLedger` is synchronous while a database is not, so a caller
bridges the gap themselves; `docs/INTEGRATION.md` names three shapes and none is free. The frontier
compares five tables I wrote against a corpus I mostly wrote, so "two profiles undominated" bounds a
claim rather than establishing one.
