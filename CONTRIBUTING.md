# Contributing

This repository argues that a claim is worth exactly as much as the thing that would fail if it
stopped being true. Most of the machinery here exists to hold that line against its own author, so a
contributor meets more gates than the size of the codebase suggests. Every one of them was built
after something was green while false. This document says what each gate is, and which defect it is
standing on.

Read `docs/DEFECTS_FOUND.md` before you argue with a check. It is the list of times this project was
wrong, written by the person who was wrong, and nearly every gate below has a section number in it.

## The rule that matters most

**Do not weaken a check to make it pass.** Not the manifest, not a ceiling, not a threshold, not a
mutation entry, not the ratchet in `scripts/verify-numbers.mjs`. CI says this itself when the claim
gates fail:

```
A release claim is no longer supported by the evidence it names.
This job exists because every mechanism in it was once green while a claim was false.
Do NOT weaken the check to make it pass - fix the claim, or regrade it in docs/claims.json.
```

Regrading is a legitimate move and it is the *first* one to consider. `docs/claims.json` has grades
for exactly this: `SKIPPED` for something not checked on a default run, `DELEGATED` for something the
caller answers, `KNOWN-RISK` for something measured and open, `NOT-CLAIMED` for something the
arithmetic does not support. Downgrading a claim in a reviewable diff is honest. Loosening the check
that grades it is how §15, §17, §18 and §19 all happened.

If a check is wrong - genuinely wrong, not inconvenient - say so in the PR and change it in its own
commit, separately from whatever it was blocking. A gate relaxed inside a feature diff is
indistinguishable from a bug fix six months later. That is the argument the header of
`packages/core/src/policy.ts` makes about the policy table, and it applies to the gates too.

## Setup

- Node: the version in `.node-version`. CI runs Node 22.
- pnpm: the version pinned in `packageManager`. `corepack enable` is the least surprising way to get
  it.
- `pnpm install --frozen-lockfile` - the same command CI runs. A lockfile that needs updating is a
  change to review, not a side effect of your install.

`.npmrc` sets `ignore-scripts`, so a dependency's install hooks do not run on your machine. If
something looks unbuilt, run `pnpm build`; do not turn the setting off.

`pnpm doctor` prints the declared posture - capability tables, ledger guarantees, what depends on a
deployment. It is a reasonable first command for orientation. It inspects nothing at runtime and
infers nothing.

## The local loop

```bash
pnpm lint        # biome check
pnpm typecheck
pnpm build       # several scripts read from dist/, so build before running them
pnpm test
```

Then, before you open the PR, the gates:

```bash
pnpm blocks:check
pnpm verify:numbers
pnpm audit:docs
pnpm audit:claims
pnpm audit:mutations     # rebuilds packages; minutes, not seconds
```

`pnpm audit:release` runs the deterministic half of `docs/ADVERSARIAL_AUDIT.md` and is a superset of
those. The half it cannot run is a reader asked to refute the claims, and that half is where the
findings in `docs/AUDIT_LOG.md` actually came from.

## The three CI jobs, and what a red X means

**`corpus-integrity` - the frozen holdout still matches its manifest.** It runs first, before install
and before any toolchain, so it fails in seconds and names its own failure. If it is red, the corpus
drifted. Nothing about your build is broken.

**`build-test` - lint, typecheck, build, test.** The ordinary one.

**`claim-gates` - docs, numbers, blocks, registry, mutations.** Everything in this job was built to
stop the project overstating itself, and until v1.0 none of it ran in CI. The repository shipped with
`audit:docs` exiting 1 and a README test count out of date while every checkmark was green. That is
§19. `packages/conformance/test/claimregistry.test.ts` now asserts that this job still names each
gate, so deleting a step fails the suite instead of quietly reducing coverage.

`prove:postgres` runs in CI in its own `postgres-proof` job, against a real `postgres` service
container. It was absent for several releases, and the reason was sound as far as it went: with no
`DATABASE_URL` the script reports SKIPPED / NOT PROVEN and **exits 0**, so an unconditioned step is a
green tick that reached no database. The answer to that is a real database, not silence. The job
greps its own output for the PROVEN line, because a misconfigured service container would otherwise
turn it green the same way.

A local `pnpm test` still does not run it — it needs a database — so a default local run reports
SKIPPED / NOT PROVEN, and that is the honest result for that run.

## The frozen holdout

`corpus/holdout/` is byte-frozen. `MANIFEST.sha256` covers its bytes and CI checks it before anything
else runs.

**Never regenerate the manifest to make the check pass.** That single move turns a working integrity
check into decoration. When it fails, find out what wrote to the file. This is not hypothetical here:
before `corpus` was added to biome's ignore list, a routine `biome check --fix` rewrote the JSON
whitespace of holdout files. The content was unaffected, the bytes were not, and the manifest is what
caught it (§5).

Only the holdout is gated. `corpus/tuning/` is expected to change - it is where a new regression case
goes when the holdout is found wanting - so its manifest is informational. If you have a case the
holdout should have contained, it goes in tuning, and the fact that the holdout missed it goes in the
PR description.

Be clear-eyed about what the manifest buys. It proves the files match a digest recorded at some
point. It does not prove the digest predates the engine, and anyone who can edit the corpus can edit
the manifest in the same change. Only a git-object freeze would carry ordering, and see below.

## A new test must be watched to FAIL first

A passing test has never counted here on its own. `scripts/audit-mutations.mjs` exists because of one
specific event: the guard's "re-decide when it loses a receipt race" branch was graded PROVEN, the
whole branch was deleted, and the entire suite still passed. The tests were sequential and the branch
only runs in an interleaving no shipped store could produce. Nothing in the repository noticed - not
the corpus checks, not the mutants, not the prose guard written the same hour. What noticed was
somebody deleting the code and re-running the suite, so that is now a command (§15).

So: break the thing your test defends, run the test, watch it fail, then fix it and watch it pass. If
it passes both times, you have written a test that cannot observe the property it names.

When your change closes a defect, add the mutation entry in the same PR. The script patches the
source, rebuilds, runs the named tests and requires them to fail; the `find` string must match
exactly once, because a zero-match entry is a mutation that silently did nothing and then "passed".
The audit says this in its own summary: the count it prints is a floor, not a ceiling. It says these
specific branches are defended and nothing about branches nobody thought to list, which is how §15
happened.

## Claims

Any headline sentence a reader would quote belongs in `docs/claims.json`, and the registry has rules
about itself that `pnpm audit:claims` enforces:

- A `PROVEN` or `ADAPTER-PROVEN` claim names a test that exists.
- A `PROVEN` claim also names a **negative control** - something deliberately broken that the test
  rejects. A mutation entry, a fake, a resolvable path, or a package script. Not prose. The rule used
  to check only that the control string was long enough, and a reviewer replaced the purity claim's
  control with nonsense of sufficient length and watched every gate report a pass (§19).
- A claim citing a mutation must cite one `scripts/audit-mutations.mjs` actually defines, so the
  registry and the harness cannot drift apart.
- A numeric claim names the command that produces the number, and that command must be a real
  package script.

If your change makes an existing claim false, change the claim. Do not soften the test.

## Numbers

Do not hand-type a number into a release-facing document. `scripts/verify-numbers.mjs` computes a
registered set of facts and fails when a document states a different value for one of them. It was
written after five load-bearing numbers were edited to wrong values and `pnpm audit:docs` passed all
five (§18).

Three acceptable ways to state a number:

1. Put it in a generated block, if it is a table.
2. Register the fact in `FACTS` in `scripts/verify-numbers.mjs`, if it is inside a sentence.
3. Rewrite the sentence so it does not carry a number.

The release-facing document list is in that script, along with a ratchet: the count of unregistered
numeric statements may shrink but not grow. Raising the ceiling is a last resort and it should be a
line in a diff somebody argues about, not a quiet edit. Note also what the script cannot do - it
knows the facts listed in it, and a number nobody registered is still unchecked prose.

Stale numbers have recurred in several separate passes of this project, and each time the fix was to
retype the number, which is the same act that produced the error.

## Generated blocks

```
<!-- GENERATED:some-generator -->
...owned by the generator, do not touch...
<!-- /GENERATED -->
```

Never hand-edit between the markers. `pnpm blocks:write` regenerates, `pnpm blocks:check` verifies,
and CI runs the check. Blocks are for tables; the claim registry is for sentences. Both exist because
neither covers the other.

**Order matters after `pnpm lint:fix`.** Some blocks count lines of source, test and script code, so
reformatting moves them. Run:

```
pnpm lint:fix
pnpm blocks:write      # the LOC counts lint:fix just changed
pnpm report:markdown   # docs/REPORT.md reads the tables blocks:write just rewrote
pnpm blocks:check      # now they can pass
pnpm report:check
```

`docs/REPORT.md` is a committed copy of generated output and needs the same discipline. It is NOT
covered by `blocks:check`, which watches `GENERATED` markers inside hand-written documents — that
file has none, so it went unchecked entirely until `pnpm report:check` existed.

Doing it the other way round leaves `blocks:check` red on numbers nobody typed, and the natural
reaction — re-running the check — never helps. Not a defect in either command; an ordering rule that
was learned the hard way twice in one pass and written down the second time.

## `pnpm verify:freeze` exits 1, and that is not a bug to fix

It checks the strong property that only a git object can carry: that the holdout existed at a commit
where `packages/core/src/policy.ts` did not. **In this repository it will always fail.** A freeze was
attempted and correctly rejected - the recorded commit already contained the engine, and no
holdout-only pre-engine commit exists in this history, because the corpus and the engine were first
committed together. `FREEZE.json` records `frozenAtCommit: null` and `state: attempted_and_failed`.

`audit-release.sh` fails if `verify:freeze` ever *passes*, since the ordering proof is supposed to be
unobtainable here. It is deliberately excluded from CI, and `claimregistry.test.ts` asserts the
exclusion, so "not in CI" stays a recorded decision rather than becoming an oversight somebody
helpfully corrects.

Do not record a commit to make it green. Nobody has, and the failure is doing its job.

## House rules for code

- `@agent-context-containment/core` imports nothing at all, including `crypto`, `TextEncoder` and
  `Buffer`, and a contract test fails the build if it grows an import. The published packages carry
  no runtime dependencies. Adding one to a package is a design conversation, not a diff.
- The engine is pure and synchronous, and never throws for any input including a malformed one. A
  policy engine that throws is a policy engine whose caller writes a try/catch, and that catch block
  is the bypass.
- No taint-level string literal in `decide()`. Thresholds live in the policy table and nowhere else.
- No domain vocabulary in the core package. The scan walks every file there. `toolrisk.ts` is the one
  exemption, it is advisory, and a second test fails if `decide()` ever imports it - so an advisory
  file cannot quietly become a decision path while carrying a standing permission.
- One table, read twice. `decide` and `checkContainment` both read `CAPABILITY_POLICY`. Do not
  introduce a second source of truth for what is permitted.
- Formatting is biome, configured in `biome.json`. `pnpm lint:fix` for the mechanical part. `corpus`
  is in biome's ignore list on purpose - see §5 above.
- Comments here explain why, and name the failure they prevent. A comment restating what the line
  does is not the house style.
- If you change a published package, add a changeset: `pnpm changeset`.

## Reporting a security issue

See `SECURITY.md`. It states the address, the response window, what counts as in scope, and what is a
documented limitation rather than a bug. Do not open a public issue for anything that would let
someone bypass the policy engine. That document is not duplicated here so that it cannot drift from
this one.
