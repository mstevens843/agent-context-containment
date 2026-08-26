#!/usr/bin/env bash
# The full adversarial audit, as one command.
#
# Runs the deterministic half of docs/ADVERSARIAL_AUDIT.md. The half it CANNOT run is step 9 - an
# independent reader asked to refute - and that is not a limitation to work around. Every finding in
# docs/AUDIT_LOG.md came from that step or from a method it suggested; none came from a machine
# noticing on its own.
#
#   pnpm audit:release
#
# Ordered so the cheapest checks fail first, and so the mutation audit - which rebuilds packages and
# takes minutes - only runs against a tree that is already green.
set -uo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail=0
check() { if "$@" >/tmp/audit-step.log 2>&1; then echo "  PASS"; else echo "  FAIL"; sed 's/^/    /' /tmp/audit-step.log | tail -20; fail=1; fi; }

step "1. the tree is green — everything below is a differential measurement"
check pnpm -s test

step "2. documents agree with the code that produces their numbers"
pnpm -s audit:docs || fail=1

step "3. every mutant isolates one defect"
pnpm -s report:mutants >/tmp/audit-step.log 2>&1 && echo "  PASS — every mutant bitten somewhere, none everywhere" || { echo "  FAIL"; tail -12 /tmp/audit-step.log; fail=1; }

step "4. delete each fix and require the tests to notice"
pnpm -s audit:mutations || fail=1

step "5. negative controls fail for the intended reason"
pnpm -s prove:crosshost >/tmp/audit-step.log 2>&1 && echo "  PASS — nonAtomicStore fails exactly the double-spend scenario" || { echo "  FAIL"; fail=1; }
if [ -n "${DATABASE_URL:-}" ]; then
  pnpm -s prove:postgres >/tmp/audit-step.log 2>&1 && echo "  PASS — the naive adapter double-claims against a real database" || { echo "  FAIL"; fail=1; }
else
  echo "  SKIPPED / NOT PROVEN — DATABASE_URL is not set. The database negative control did not run."
fi

step "6. the freeze claim is still unavailable, not pending"
if pnpm -s verify:freeze >/dev/null 2>&1; then
  echo "  FAIL — verify:freeze passed. The ordering proof is supposed to be unobtainable here."
  fail=1
else
  echo "  PASS — exits 1, by design"
fi

step "what this command cannot do"
cat <<'NOTE'
  Step 9 of docs/ADVERSARIAL_AUDIT.md is missing from this script and cannot be added: an independent
  reader, asked to REFUTE rather than review.

  Everything above was written by the person whose claims it checks, and therefore shares his blind
  spots exactly. It caught nothing in v0.9 - a prose guard written the same hour as the defect missed
  the defect. The purity contract passed for months while scanning an empty list.

  A green run here means the listed branches are defended. It says nothing about the ones nobody
  thought to list, which is how every entry in docs/AUDIT_LOG.md happened.
NOTE

if [ "$fail" -eq 0 ]; then
  printf '\n\033[1m▸ audit: PASS\033[0m — the deterministic half. Now get somebody to refute it.\n'
else
  printf '\n\033[1m▸ audit: FAIL\033[0m — see above.\n'
fi
exit "$fail"
