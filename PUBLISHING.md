# Publishing checklist

**Nothing here has been published, and this file is not permission to publish it.** It is the list a
release would have to satisfy, written down while the reasoning is fresh.

## Before a first release

- [x] **Decide whether the version number is honest. SETTLED: `0.1.0`.** The five packages are at
      `0.1.0`; the private root manifest stays `0.0.0` and is never published. The corpus is 98
      hand-written and imported cases, the freeze is unavailable, and there is no model in the loop.
      `1.0.0` would be a claim the evidence does not support — it promises API stability to strangers
      on the strength of a mechanism, not a track record.

      **"v1.0" in `STATUS.md` and `README.md` is an internal hardening milestone, not an npm
      version — the packages are `0.1.0`.** They are different numbering schemes and the packet must
      not let them read as one:
      the milestone means "the claim-checking machinery is in place and the branch debt is closed",
      which is a statement about *this repository's* rigour, not about API stability for strangers.
      Whatever ships first should ship as `0.x`.
- [x] **Name check. SETTLED: the `@agent-context-containment` scope is owned.** All five packages are
      published under it. An automation token scoped to exactly that one scope, with read and write
      access, exists for CI.
- [ ] **Decide what ships.** `core`, `ledger` and `retrieval` are libraries. `classifier` exists as a
      baseline to lose to and should probably stay private — publishing it invites someone to depend
      on a detector this repository argues against. `conformance` is a test harness and is genuinely
      useful to a third party grading their own policy; ship it, clearly labelled.
- [ ] **`private: true` on everything not being published**, `examples` included.
- [ ] **`files` field** limits each package to `dist`. Verify with `npm pack --dry-run` that no
      corpus, test or source file ships by accident.
- [ ] **`repository`, `homepage`, `bugs`** on every package manifest.
- [x] **LICENSE at the root and in each published package.** MIT. Done at v1.0 finalization, and it
      was not done before: all five packages declared MIT and shipped **no LICENSE file at all**,
      because npm auto-includes one only from the package directory and it existed only at the root.
      This line had been a checklist item since the first release pass, which is precisely why it is
      a test now — `packages/conformance/test/packaging.test.ts` fails if any package declares a
      licence it does not ship. The `classifier` carries an Apache-2.0 origin note and the imported
      corpus is MIT from InjecAgent; both attributions must survive into whatever ships.

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

## The exact prepublish sequence

Run in this order, from a clean tree. Each line is expected to exit 0 **except where noted**.

```bash
pnpm install --frozen-lockfile
pnpm verify:corpus          # 7/7 against the frozen manifest
pnpm lint && pnpm typecheck && pnpm build && pnpm test
pnpm blocks:check           # every generated block matches its generator
pnpm verify:numbers         # registered numbers agree; unregistered count under its ceiling
pnpm audit:docs             # no document overstates the evidence
pnpm audit:claims           # the registry's own rules
pnpm audit:mutations        # deleting any recorded fix fails a named test
pnpm audit:release          # the whole deterministic audit
pnpm report:markdown        # regenerate docs/REPORT.md so no published number is stale
pnpm doctor                 # what the deployment can and cannot see

pnpm verify:freeze          # EXPECTED: exit 1
```

### The freeze failure is expected, and this is its wording

`pnpm verify:freeze` **exits 1** and records the freeze as `attempted_and_failed`. That is not a
broken check to fix before publishing — the git-object freeze artifact does not exist, so the claim
is **UNAVAILABLE, not pending**. Publishing with it green would require creating the artifact; do not
reach that state by weakening the check. Every release document must keep saying *unavailable*.

### Postgres is optional, and its absence is not a failure

```bash
pnpm prove:postgres                                   # SKIPPED / NOT PROVEN, exit 0
DATABASE_URL=postgres://localhost/containment_ledger_test pnpm prove:postgres   # 11/11 + control
```

Without `DATABASE_URL` the block reports **SKIPPED / NOT PROVEN** and must never be reported as a
pass. With one, the run proves the five concurrency scenarios **for that database, that version and
that topology only** — not for Postgres in general, and not for your deployment. CI deliberately does
not run it: a skip that exits 0 is a green step that proves nothing.

## Name availability, dry run, and the smoke test

```bash
# 1. Is the scope free / owned?
npm view @agent-context-containment/core          # expect 404 on a first release (0.1.0)
npm org ls agent-containment 2>/dev/null  # or confirm ownership

# 2. What would actually ship? `files` is ["dist", "LICENSE"] - verify nothing else leaks.
pnpm -r exec npm pack --dry-run     # inspect the FILE LIST with this...
pnpm -r pack --pack-destination /tmp/acc-tarballs   # ...but produce real tarballs with THIS

# 3. Dry-run the publish itself.
pnpm -r publish --dry-run --access public --no-git-checks

# 4. Install the real tarballs offline and check containment still refuses an injected send.
pnpm smoke:pack
```

### Use `pnpm pack`, never `npm pack`, and this is a publish blocker rather than a preference

The five packages depend on each other by `workspace:*`. **`npm pack` copies that string into the
tarball verbatim**, and installing the result fails with:

```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
```

`pnpm pack` and `pnpm publish` rewrite it to the real version. So `npm pack --dry-run` is useful for
reading the **file list** and actively misleading about **installability**: it can look perfect while
describing a tarball nobody can install. `pnpm smoke:pack` installs the real thing and fails if a
`workspace:` specifier survives. Publish with `pnpm`.

Read the `npm pack --dry-run` file list before believing it. `files: ["dist"]` plus npm's automatic
inclusion of `README.md`, `LICENSE` and `package.json` is what should appear — **no corpus, no
tests, no sources**. The corpus in particular must not ship: the frozen holdout is an instrument, and
an instrument that travels loses the property that makes it one.

### Scope decision

The scope `@agent-context-containment/*` is **final** for anything published, and the five package names in
`packages/*/package.json` already match it. There is no unscoped fallback: an unscoped
`agent-containment` would be a different claim about ownership than this project can make.

### Post-publish smoke test

From an empty directory outside this repository — the point is to install what strangers install,
not what the workspace resolves:

```bash
mkdir /tmp/acc-smoke && cd /tmp/acc-smoke && npm init -y
npm install @agent-context-containment/core

node -e '
const { decide, actionId, sourceId } = require("@agent-context-containment/core");
const v = decide({
  action: { id: actionId("a"), capability: "email_send", tool: "t",
            args: [{ name: "to", role: "sink_identity", derivedFrom: [sourceId("web")] }] },
  sources: [{ id: sourceId("web"), provenance: "WEB" }],
  receipts: [],
});
if (v.decision === "ALLOW") { console.error("SMOKE FAILED: untrusted web content steered a send"); process.exit(1); }
console.log("ok:", v.decision, v.reasons.map(r => r.code).join(","));
'
```

A published package that permits that call is broken in the one way this project exists to prevent,
and the smoke test exits non-zero rather than printing something reassuring.

## Publishing needs a token that can bypass 2FA

A first attempt from a logged-in local shell (`npm whoami` returning the maintainer) was refused:

```
npm error code E403
npm error 403 Forbidden - PUT https://registry.npmjs.org/@agent-context-containment%2fcore
npm error 403 Two-factor authentication or granular access token with bypass 2fa enabled
npm error 403 is required to publish packages.
```

Being logged in is not sufficient. Three ways past it, in order of preference:

1. **CI, with a granular token** — `.github/workflows/release.yml`, `workflow_dispatch` only. It
   re-runs the entire gate (build, tests, all five claim gates, the offline tarball smoke) and only
   then publishes, with `--provenance`. The repository secret `NPM_TOKEN` must be a **granular access
   token scoped to `@agent-context-containment`, read and write, with "bypass 2FA" enabled.** A
   granular token *without* that setting fails exactly as above.
2. **Locally with a one-time password** — `pnpm -r publish --access public --otp=123456`, taking the
   code from your authenticator. Short-lived, and nothing is stored.
3. **Locally with the granular token** — export it as `NODE_AUTH_TOKEN` for one command. Least
   preferred: a long-lived credential in a shell's history and environment.

The workflow defaults `dry_run` to **true**. Run it once that way, read the log, then run it again
with `dry_run` unchecked.

## Deliberately not automated

Releases are not wired to CI. A publish is a claim about quality made to strangers, and this project's
whole argument is that claims should be checkable by the person making them before anyone else has to
trust them. A green pipeline is not that.
