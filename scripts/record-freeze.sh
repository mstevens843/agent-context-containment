#!/usr/bin/env bash
#
# Record a commit hash into corpus/holdout/FREEZE.json.
#
# WHAT THIS DOES AND DOES NOT DO, because the distinction is the whole point:
#
#   It writes metadata. That is all. Recording a hash does not make the holdout predate the engine -
#   it asserts that it does, and the assertion is worth exactly as much as the commit behind it.
#
#   `verify:freeze` is what checks the claim, by asking git whether packages/core/src/policy.ts
#   existed at that commit. Run it immediately after this, and if it fails, the hash was wrong. Do
#   not adjust either script to make it pass.
#
# Deliberately separate from verify-freeze.sh: one records, one checks. A script that did both would
# be a script that can be talked into agreeing with itself.
#
# Does NOT touch corpus/holdout/MANIFEST.sha256. FREEZE.json is excluded from the manifest precisely
# so this can run without tripping the drift check.

set -euo pipefail

FREEZE="corpus/holdout/FREEZE.json"
SHA="${1:-}"

if [ -z "$SHA" ]; then
  cat >&2 <<'MSG'
usage: pnpm record:freeze <commit-sha>

Find the commit where the corpus exists and the engine does not:

  git log --oneline --diff-filter=A -- corpus/holdout

Confirm the engine is absent there. THIS MUST FAIL:

  git cat-file -e <sha>:packages/core/src/policy.ts

Then record it and verify:

  pnpm record:freeze <sha>
  pnpm verify:freeze
  git tag -s corpus-holdout-v1 <sha>
MSG
  exit 2
fi

if ! printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "record-freeze: \"$SHA\" is not a 40-character lowercase hex sha." >&2
  echo "Use the full hash, not an abbreviation - an abbreviation can become ambiguous later." >&2
  exit 2
fi

if [ ! -f "$FREEZE" ]; then
  echo "record-freeze: $FREEZE not found. Run from the repository root." >&2
  exit 2
fi

EXISTING=$(node -e "process.stdout.write(String((JSON.parse(require('fs').readFileSync('$FREEZE','utf8')).frozenAtCommit) ?? ''))")
if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ] && [ "$EXISTING" != "$SHA" ]; then
  echo "record-freeze: already recorded as $EXISTING." >&2
  echo "Overwriting a freeze point is a decision, not a fix. Clear it by hand if you mean it." >&2
  exit 1
fi

node -e "
const f = require('fs');
const p = '$FREEZE';
const j = JSON.parse(f.readFileSync(p, 'utf8'));
j.frozenAtCommit = '$SHA';
j.verify = 'git cat-file -e $SHA:packages/core/src/policy.ts   # MUST exit non-zero';
f.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
"

echo "record-freeze: recorded $SHA in $FREEZE"
echo
echo "This wrote metadata and proved nothing. Verify it now:"
echo
echo "    pnpm verify:freeze"
echo
echo "If that fails, the hash is wrong. Fix the hash, not the script."
