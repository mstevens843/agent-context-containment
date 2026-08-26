# Publishing checklist

**Nothing here has been published, and this file is not permission to publish it.** It is the list a
release would have to satisfy, written down while the reasoning is fresh.

## Before a first release

- [ ] **Decide whether the version number is honest.** This is `0.0.0` across the workspace. The
      corpus is 68 hand-written and imported cases, the freeze is unavailable, and there is no model
      in the loop. `0.1.0` with a blunt README is right; `1.0.0` would be a claim the evidence does
      not support.
- [ ] **Name check.** `agent-context-containment` is unclaimed on npm as of writing. Verify before
      relying on it, and check the `@agent-containment` scope is available or owned.
- [ ] **Decide what ships.** `core`, `ledger` and `retrieval` are libraries. `classifier` exists as a
      baseline to lose to and should probably stay private — publishing it invites someone to depend
      on a detector this repository argues against. `conformance` is a test harness and is genuinely
      useful to a third party grading their own policy; ship it, clearly labelled.
- [ ] **`private: true` on everything not being published**, `examples` included.
- [ ] **`files` field** limits each package to `dist`. Verify with `npm pack --dry-run` that no
      corpus, test or source file ships by accident.
- [ ] **`repository`, `homepage`, `bugs`** on every package manifest.
- [ ] **LICENSE at the root and in each published package.** MIT. The `classifier` carries an
      Apache-2.0 origin note and the imported corpus is MIT from InjecAgent — both attributions must
      survive into whatever ships.

## Every release

- [ ] `pnpm verify:corpus` — 7/7 against the frozen manifest
- [ ] `pnpm verify:freeze` — **expected to exit 1.** The ordering proof is unavailable, not pending
- [ ] `pnpm import:check` — imported cases rebuild byte-identically from pinned upstream rows
- [ ] `pnpm lint && pnpm typecheck && pnpm build && pnpm test`
- [ ] `npx tsc -p tsconfig.test.json` in each package — vitest does not typecheck
- [ ] `pnpm report:markdown` — regenerate `docs/REPORT.md` so no published number is stale
- [ ] Every example runs: `examples/*.ts` and `examples/agents/all.ts`
- [ ] `pnpm prove:crosshost` — the ledger's cross-host claim still earns itself
- [ ] `pnpm judge:model` — prints "skipped" with no key, exits 0
- [ ] No API key anywhere in the tree (a test walks it, but check the diff too)
- [ ] `STATUS.md` inventory counted, not remembered. It was stale for four versions
- [ ] Changeset written, describing behaviour changes rather than file counts

## What must never regress silently

Each of these has a test, and the test exists because the property is invisible when it breaks:

| property | what breaks if it goes |
|---|---|
| the pure core has no imports, no clock, no randomness | `decide()` stops being replayable and auditable |
| the v0 holdout's bytes match its manifest | every number measured against it means nothing |
| imported cases rebuild from pinned source | "upstream's bytes" becomes an unverifiable claim |
| no ledger claims `crossHostSafe` without passing `proveCrossHost` | a silent double-spend |
| the model judge never gates a test | a number that moves on its own starts failing builds |
| reports cannot claim optimality | the most quotable line becomes the least defensible one |

## Deliberately not automated

Releases are not wired to CI. A publish is a claim about quality made to strangers, and this project's
whole argument is that claims should be checkable by the person making them before anyone else has to
trust them. A green pipeline is not that.
