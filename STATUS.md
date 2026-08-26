# Status — v0

Frozen as v0 after a documentation pass. No further feature work.

## Inventory

| | |
|---|---|
| Packages | **4** — `core`, `classifier`, `conformance`, `retrieval` |
| Source LOC (TypeScript) | **3,115** — core 2,211 · conformance 589 · classifier 181 · retrieval 134 |
| Test LOC | **577** |
| Example LOC | **143** |
| Total TypeScript | **3,835** |
| Docs + README | **1,140 lines** across 9 files |
| Corpus cases | **24** — holdout 16 (10 attack / 6 benign), tuning 8 (4 attack / 4 benign) |
| Tests | **39** — core 15 · conformance 11 · classifier 8 · retrieval 5 |
| Examples | **3**, all runnable |
| Mutants | **6** broken engines + 1 reference |

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

## Freeze not cashed

`corpus/holdout/FREEZE.json` records `frozenAtCommit: null`.

The holdout **was** authored before `packages/core/src/policy.ts` existed — the build order was
sequenced that way deliberately — but the repository has never been committed, so there is no object
to point at. Until `git cat-file -e <sha>:packages/core/src/policy.ts` exits non-zero, "the holdout
predates the engine" is a claim like any other rather than a checkable fact.

No `git init` or `git commit` has been run. The freeze procedure is written up in `docs/EVALS.md` and
is deferred by decision.

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
