# Release checklist

**Nothing here has been published, and this file is not permission to publish it.** It is the gate a
release has to pass, written down while the reasoning is fresh. `PUBLISHING.md` covers packaging;
this covers correctness.

## Two commands

```bash
pnpm release:report --markdown   # the whole gate, then the whole report
pnpm audit:release               # and then: could any of those tests actually fail?
```

The second is not optional and is not a formality. In v0.9 the first passed completely while two
claims were graded PROVEN on evidence that did not support them, and the purity contract had been
scanning an empty list for months. A green gate reports that the tests pass. `audit:release` reports
whether they *can fail* - which is a different question, and the one that was never being asked.

**Neither command runs step 9 of `docs/ADVERSARIAL_AUDIT.md`**: an independent reader asked to refute.
Every finding in `docs/AUDIT_LOG.md` came from that step. It is a person, not a command.

It stops on the first failure, because a report generated from a tree that does not build is a set of
numbers about nothing.

## The gate

| check | command | expected |
|---|---|---|
| corpus integrity | `pnpm verify:corpus` | 7/7 against the frozen manifest |
| exact imports rebuild | `pnpm import:check` | 34/34 byte-identical from pinned upstream rows |
| capability manifests | `pnpm verify:manifests` | 0 contradictions in every table |
| **freeze** | `pnpm verify:freeze` | **exits 1.** Unavailable, not pending |
| lint | `pnpm lint` | clean |
| typecheck | `pnpm typecheck` | 9 tasks, `src` and `test` configs |
| build | `pnpm build` | 5 packages |
| test | `pnpm test` | all passing |
| per-package test types | `npx tsc -p tsconfig.test.json` in each | vitest does not typecheck |
| sync cross-host proof | `pnpm prove:crosshost` | adapter logic proven |
| async ledger proof | `pnpm prove:asyncledger` | logic proven; database **SKIPPED / NOT PROVEN** without `DATABASE_URL` |
| model judge | `pnpm judge:model` | prints `skipped`, exits 0 |
| **generated blocks match their generators** | `pnpm blocks:check` | four passes shipped a stale number before this existed |
| **claim registry** | `pnpm audit:claims` | every PROVEN claim names a test AND a negative control |
| **mutation audit** | `pnpm audit:mutations` | 8/8 — deleting any listed fix fails a test |
| **the prose guard can fail** | `pnpm audit:docs` | injects a false claim and requires it to be caught |
| examples | `examples/*.ts`, `examples/agents/all.ts` | all run |
| playground matrix | `npx tsx examples/playground.ts --matrix --role sink_identity` | runs |

## Claims that must stay honest

Each of these has a test, and each test exists because the claim is the kind that drifts upward.

| claim | how it is held |
|---|---|
| the pure core has no imports, clock, randomness or `Promise` | `contract.test.ts` fails the build |
| the v0 holdout's bytes match its manifest | `verify:corpus`, gated in CI before install |
| the ordering proof is **unavailable, not pending** | `verify:freeze` exits 1; `FREEZE.json` says `attempted_and_failed` |
| imported cases are upstream's bytes | `import:check` rebuilds them from committed source rows |
| exact vs hand-derived is enforced, not described | 4 `checkCorpus` codes, both directions |
| no report claims optimality | checked per rendered line, negation required |
| the model judge gates nothing | tree walk for readers of its output |
| a ledger claims `crossHostSafe` only after proving it | `proveCrossHost`, plus a store that fails it |
| a receipt admits one value, one slot, once | defect §11's regression tests |
| the engine knows no domain vocabulary | `policy.ts` scanned for `refund`, `deploy`, `invoice`, … |

## What must never be said

Checked by reading, not by a test — so it goes on the list:

- **"solves prompt injection"** — it constrains what a tool call may do with a value. Nothing more.
- **"the optimal policy"** — five profiles, two undominated. `docs/POLICY_CHOICE.md` argues the
  choice because the arithmetic cannot make it.
- **"the holdout is proven to predate the engine"** — it is not, and cannot be, in this repository.
- **"cross-host safe"** without naming the condition — the adapter's logic is proven; your topology
  is not, and nothing here can reach it.
- **"validated manifest"** implying a true one — it implies a *consistent* one. Declaring a send tool
  as read-only lets 17 of 17 imported data-stealing attacks through.

## Release-candidate checklist

Run in this order. Each line is a command and an expected outcome, so a run that "looks fine" and a
run that passed are the same thing.

- [ ] `pnpm verify:corpus` — **7/7** against the frozen manifest
- [ ] `pnpm verify:freeze` — **exits 1.** The ordering proof is *unavailable*, not pending, and never
      will be obtainable in this history. **If it ever passes, something is wrong.**
- [ ] `pnpm import:check` — **34/34** rebuild byte-identically from pinned upstream rows
- [ ] `pnpm lint && pnpm typecheck && pnpm build && pnpm test`
- [ ] `npx tsc -p tsconfig.test.json` in each of the five packages — vitest does not typecheck
- [ ] every example: `examples/*.ts` and `examples/agents/all.ts` (five domains)
- [ ] `npx tsx examples/playground.ts --matrix --role sink_identity`
- [ ] `pnpm audit:release` — **and this is the one that is not a formality.** The gate reports that
      the tests pass; this reports whether they *can fail*. In v0.9 the gate was fully green while two
      claims were graded PROVEN on evidence that did not support them.
- [ ] `pnpm blocks:check` — every generated block matches its generator
- [ ] `pnpm report` and `pnpm report:markdown` — regenerate `docs/REPORT.md`
- [ ] `pnpm doctor` — read the deployment posture, especially the **high-blast-radius** rows
- [ ] `pnpm verify:manifests` — **contradictions must be zero.** Advisories are advisory: read each
      one and record the decision, rather than letting a clean-looking run stand in for a judgement
- [ ] `DATABASE_URL=… pnpm prove:postgres` **if you have a database** — 11/11 with a negative control.
      Without it, that block must read **SKIPPED / NOT PROVEN**, and must not be reported as a pass
- [ ] confirm every remaining risk is **labelled, not buried** — `pnpm report` prints them under
      `REMAINING RISKS`, graded KNOWN RISK / DELEGATED / NOT CLAIMED

## Before tagging

- [ ] `pnpm release:report --markdown` and read `docs/REPORT.md` end to end
- [ ] `STATUS.md` inventory **counted, not remembered** — it was stale for four versions
- [ ] every number in `README.md` traceable to generated output
- [ ] `docs/DEFECTS_FOUND.md` includes anything this pass found, including defects in your own favour
- [ ] `docs/LIMITATIONS.md` rows updated, including ones that got worse
- [ ] no API key anywhere in the tree (a test walks it; read the diff too)
- [ ] `PUBLISHING.md` packaging checklist

## Refutation conduct

Not a command — a property of how the adversarial pass was run. `pnpm audit:release` cannot see it.

- [ ] Every refuter confirmed the **absolute path** of the repository it audited before reporting.
      A v1.0 run had four agents audit the wrong repository entirely; only one of them noticed.
- [ ] **No two mutating refuters shared a working tree.** Concurrent mutation means each was reading
      the other's changes as its own result.
- [ ] Every mutation was **rebuilt** (`pnpm build`) before the suite was run, **reverted** after, and
      the suite confirmed green before the next one.
- [ ] Every new branch test was **watched to fail** under the mutation it was written for.

**If refutation was run concurrently in one tree, the result is not evidence and this release is not
green** — whatever the run reported. See docs/ADVERSARIAL_AUDIT.md.

## User actions before tagging v1.0

One item an automated run cannot decide.

- [ ] **Decide the freeze.** `pnpm verify:freeze` exits 1 and records `attempted_and_failed`, by
      design, because the git-object freeze artifact does not exist. Tag v1.0 with that state
      recorded as UNAVAILABLE, or create the artifact first — but do not weaken the check.

**Release debris: none.** `probe-tmp.mjs` was deleted at v1.0 finalization. The exemption that
carried it is gone too — `packages/conformance/test/hygiene.test.ts` now holds an **empty**
`KNOWN_DEBRIS`, and three tests keep it that way: any unreferenced root script fails the suite, an
exemption naming a file that no longer exists fails, and a non-empty list at release fails. All three
were watched to fail under their own mutations.
