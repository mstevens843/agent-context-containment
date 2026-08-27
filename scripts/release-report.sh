#!/usr/bin/env bash
# One command that produces everything a stranger needs to evaluate this repository.
#
# Runs the whole gate AND the whole report, in that order, and stops on the first failure - because a
# report generated from a tree that does not build is a set of numbers about nothing.
#
#   pnpm release:report            terminal
#   pnpm release:report --markdown also writes docs/REPORT.md
#
# Everything below is generated. Nothing in it is typed by hand, which is the point: a
# hand-maintained number is a claim that was true once, and the stale one is always the one somebody
# quotes.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

step "corpus integrity"
pnpm -s verify:corpus

step "exact imports rebuild from pinned upstream source"
pnpm -s import:check

step "capability manifests"
pnpm -s verify:manifests >/dev/null && echo "  every table: 0 contradictions"

step "freeze status"
if pnpm -s verify:freeze >/dev/null 2>&1; then
  echo "  UNEXPECTED: verify:freeze passed. The ordering proof is supposed to be unavailable."
  exit 1
else
  echo "  UNAVAILABLE, as expected. verify:freeze exits 1 by design - see corpus/holdout/FREEZE.json."
fi

step "build and test"
pnpm -s lint >/dev/null && echo "  lint      PASS"
pnpm -s typecheck >/dev/null && echo "  typecheck PASS"
pnpm -s build >/dev/null && echo "  build     PASS"
TEST_LOG="$(mktemp)"
trap 'rm -f "$TEST_LOG"' EXIT
if pnpm -s test >"$TEST_LOG" 2>&1; then
  if ! grep -E "Tests +[0-9]+ passed" "$TEST_LOG" | sed 's/^/  /'; then
    echo "  could not parse test summaries from pnpm test output"
    exit 1
  fi
else
  sed 's/^/  /' "$TEST_LOG"
  exit 1
fi

step "capability manifests, semantic advisories, mutant bite matrix"
pnpm -s verify:manifests >/dev/null && echo "  manifests: 0 contradictions across every table"
pnpm -s report:mutants >/dev/null && echo "  mutants:   every one bitten somewhere, none everywhere"

step "ledger proofs"
pnpm -s prove:crosshost >/dev/null && echo "  sync cross-host adapter logic   ADAPTER-PROVEN"
pnpm -s prove:asyncledger >/dev/null && echo "  async reservation protocol      ADAPTER-PROVEN"
if [ -n "${DATABASE_URL:-}" ]; then
  pnpm -s prove:postgres | grep -E "PROVEN against|FAILED" | sed 's/^/  real Postgres:  /'
else
  echo "  real Postgres:  SKIPPED / NOT PROVEN - DATABASE_URL is not set. This is NOT a pass."
  echo "                  DATABASE_URL=postgres://... pnpm prove:postgres"
fi

step "the report"
node scripts/report.mjs
if [ "${1:-}" = "--markdown" ]; then
  node scripts/report.mjs --out docs/REPORT.md
fi

step "what is NOT proven"
cat <<'NOTE'
  Read these next to every number above.

  - The v0 holdout ORDERING proof is UNAVAILABLE, not pending. A freeze was attempted and correctly
    rejected: the recorded commit already contained the engine, and no holdout-only pre-engine commit
    exists in this history. `frozenAtCommit` is null and stays there.
  - No policy here is proven optimal. Five profiles, TWO of them undominated - the arithmetic shows a
    tradeoff and cannot pick. See docs/POLICY_CHOICE.md.
  - A capability declaration is trusted input. Declare a send tool as read-only and 32 of 32 imported
    data-stealing attacks go through. Structural validation cannot see it.
  - Cross-host ledger safety is ADAPTER-PROVEN, and PROVEN against a real Postgres only when
    DATABASE_URL is set - a run without it reports that block as SKIPPED / NOT PROVEN, never green.
    Whether YOUR hosts share one database is infrastructure nothing here can reach.
  - Manifest validation proves a table is CONSISTENT, never that it is TRUE. The semantic advisories
    read names and nothing else; zero findings means nothing was named oddly.
  - The review workflows prove MECHANICS. The reviewer is a rule set somebody wrote down, reported on
    its own line, and reviewer.test.ts holds a case where it is fooled and the engine is not.
  - The taint is cooperative, not enforced. There is no membrane in JavaScript.
  - Model-judged results are supplementary and gate nothing. `pnpm judge:model` skips without a key.
NOTE
