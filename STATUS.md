# Status — v0.4

## Version history

| | what it established |
|---|---|
| **v0** | The frozen corpus and the instrument. 16 holdout cases, a `MANIFEST.sha256` over them, and a CI job that gates everything else on their integrity. (The cases *were* written before the engine; that ordering was never committed, so it is not provable — see below.) |
| **v0.1** | Coverage of what was already advertised. Direct tests for `declassify`/`check`/`taint` (702 previously untested lines), receipts wired end to end, the attested-tool-output rule from the original brief, `NEEDS_REVIEW` and `DENY` coverage, the wallet example, and test files typechecked for the first time. |
| **v0.2** | Breadth, and evidence that is not self-authored. A derived split from AgentDojo/InjecAgent shapes, `holdout_v2` closing v0's laundering gap additively, a full RAG pipeline demo, a per-split classifier comparison, a CLI playground, and two new mutants. |
| **v0.3** | Closing the things a sharp reviewer would call a toy. The prepare/broadcast policy defect fixed surgically, receipt replay/expiry/value/source binding, correlated-parameter tuple checks, an adaptive evasion split, strict freeze tooling, and the first utility measurement. |
| **v0.4** | Turning paper guarantees into infrastructure. A stateful ledger package that makes omitting replay state a **compile error**, a declarative tuple policy model across six capabilities, 648 mechanically generated laundering variants, task-level utility, more non-author-designed cases, and a freeze-recording helper. |

The v0 holdout has not been edited in any of these passes, and its manifest has not been regenerated.

---

# Detail — v0.4

**v0.4 turns delegated risks into executable infrastructure.** v0.3 closed the logic; several
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

## v0.3 -> v0.4

| | v0 | v0.1 | v0.2 | v0.3 | v0.4 |
|---|---|---|---|---|---|
| tests | 39 | 113 | 126 | 165 | **200** |
| hand-authored corpus | 24 | 35 | 51 | 59 | **65** |
| corpus splits | 2 | 2 | 4 | 5 | **6** |
| non-author-designed shapes | 0 | 0 | 6 | 6 | **9** |
| mutants | 6 | 7 | 9 | 9 | 9 |
| examples | 3 | 4 | 6 | 8 | 8 |
| packages | 4 | 4 | 4 | 4 | **5** |
| generated variants | 0 | 0 | 0 | 0 | **648** |
| decisions produced by corpus | 3 of 4 | 4/4 | 4/4 | 4/4 | 4/4 |

Corpus by split: `holdout` 16 (frozen, unchanged) · `holdout_v2` 6 · `tuning` 23 · `derived` 9 ·
`adaptive` 8 · `generated` 648 (mechanical, reported separately and never pooled).

**The v0 holdout headline did not move across either pass** — 9/9 attacks, 6/6 benign, exact decision
agreement 7/15. Neither pass added capability to the engine; both added ways of checking it.

The number that is new, and the one worth quoting, is measured across all four splits:

```
SILENT ATTACKS - no injection wording for any text detector to find
  split         n    containment    classifier
  holdout       6    6/6            0/6
  holdout_v2    4    4/4            0/4
  tuning        9    9/9            0/9
  derived       4    4/4            0/4
                23   23/23          0/23
```

The classifier also over-blocks 3 of 6 benign holdout cases, because they quote attack strings. Both
halves of the failure mode, in every split where the row exists. Never pooled into one figure — see
`docs/EVALS.md` for why the splits are not samples from one population.

## Inventory

| | |
|---|---|
| Packages | **4** — `core`, `classifier`, `conformance`, `retrieval` |
| Source LOC (TypeScript) | core **2454** · conformance ~700 · classifier 181 · retrieval 134 |
| Test LOC | **577** |
| Example LOC | **143** |
| Total TypeScript | **3,835** |
| Docs + README | **1,140 lines** across 9 files |
| Corpus cases | **35** — holdout 16 (frozen), tuning 19 |
| Tests | **113** — core 84 · conformance 16 · classifier 8 · retrieval 5 |
| Examples | **4**, all runnable |
| Mutants | **7** broken engines + 1 reference |

## Commands run

```bash
pnpm install
pnpm lint                                     # biome check .   (54 files)
pnpm typecheck                                # turbo run typecheck
pnpm build                                    # turbo run build
pnpm test                                     # turbo run test
npx biome check --fix --unsafe .
npx tsx examples/web-research-agent.ts
npx tsx examples/email-assistant.ts
npx tsx examples/rag-assistant.ts
```

## Checks

| check | result | note |
|---|---|---|
| lint — biome 1.9.4, 54 files | **PASS** | |
| typecheck — 7 turbo tasks | **PASS** | |
| build — 4 packages, ESM + CJS + d.ts | **PASS** | |
| test — 39 across 4 packages | **PASS** | |
| examples ×3 | **PASS** | |
| contract test — pure core has no imports, no I/O globals, no clock, no randomness, nothing async, no hard-coded thresholds | **PASS** | |
| policy invariants — 10 table properties | **PASS** | caught two real defects, see DEFECTS_FOUND.md |
| mutant discrimination — every mutant bitten, none blanket-fails | **PASS** | |
| paired-control property — byte-identical content, opposite answers | **PASS** | |
| **git freeze of the holdout** | **SKIPPED** | repo is not a git repo; freeze procedure deliberately deferred |
| **derived AgentDojo / InjecAgent subset** | **SKIPPED** | not built; corpus is 100% author-written |
| corpus manifest verification | **PASS** | `pnpm verify:corpus`, 7/7, gated in CI before install |
| exact decision agreement (holdout) | **7/15, recorded** | 8 frozen cases name `DENY` where the engine correctly returns `NEEDS_DECLASSIFICATION`. Engine right, frozen expectations wrong. Asserted as an exact list rather than fixed |

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
| **Formatter and linter excluded** | `corpus` is in `biome.json`'s ignore list; `pnpm lint` checks 43 files and touches none of the corpus. |
| **Git-object freeze** | **STILL PENDING.** `FREEZE.json` has `frozenAtCommit: null`. |

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
## Derived corpus subset — not built

The plan was "mostly original plus a labelled subset derived from AgentDojo and InjecAgent" (both
MIT, verified). The schema carries the attribution fields (`source.kind = "derived"`, upstream ref,
licence, non-empty `modifications`) and nothing uses them yet.

**Consequence: the corpus is 100% author-written and therefore fully self-selected.** The structural
mitigations — held-out split, branded case ids, reason-level grading, mutant discrimination — reduce
self-deception. They do not remove it, and no mechanism internal to a single author can.

## Known-open

See `docs/LIMITATIONS.md`. In short: no commit anchor on the freeze; no derived subset; the `M4`
laundering gap stands for a future holdout v2; receipt replay is undefended; correlated parameter
tuples are unchecked; n=24 with no adaptive attacker and no end-to-end utility score.
