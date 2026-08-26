#!/usr/bin/env bash
#
# STRICT freeze verification. Optional, and it fails until the freeze is actually cashed.
#
# `verify-corpus.sh` proves the holdout matches a digest. That is worth having and it is weaker than
# it sounds: it proves the files match a digest recorded at SOME point, not that the digest was
# recorded before the engine existed - and anyone who can edit the corpus can edit the manifest in
# the same change. This script checks the stronger property, which only a git object can carry:
#
#   the holdout existed at a commit where packages/core/src/policy.ts did not.
#
# That is what makes "the holdout was not written to fit the implementation" a fact a stranger can
# check in five seconds rather than a claim they have to take on trust.
#
# Kept OUT of normal CI on purpose. CI gates on the manifest, which always passes; this fails loudly
# until a human does the one-time procedure, and a check that is red by design does not belong in a
# pipeline everyone learns to ignore.

set -euo pipefail

FREEZE="corpus/holdout/FREEZE.json"
ENGINE="packages/core/src/policy.ts"

if [ ! -f "$FREEZE" ]; then
  echo "verify-freeze: $FREEZE not found. Run from the repository root." >&2
  exit 2
fi

COMMIT=$(node -e "process.stdout.write(String((JSON.parse(require('fs').readFileSync('$FREEZE','utf8')).frozenAtCommit) ?? ''))")

if [ -z "$COMMIT" ] || [ "$COMMIT" = "null" ]; then
  cat >&2 <<'MSG'

--------------------------------------------------------------------------------
FREEZE NOT CASHED: corpus/holdout/FREEZE.json has frozenAtCommit: null
--------------------------------------------------------------------------------

The v0 holdout was authored before the policy engine existed - the build order was
sequenced that way deliberately - but the repository has never been committed, so
there is no object to point at. Until then, that ordering is a claim like any
other and should not be described as verified.

TO CASH IT (one time, and it must be done by a human who can run git):

  1. Check out or construct the tree where the corpus exists and the engine does
     not. If history already contains such a commit, find it:

       git log --oneline --diff-filter=A -- corpus/holdout

  2. Confirm the engine is absent at that commit. THIS MUST FAIL:

       git cat-file -e <sha>:packages/core/src/policy.ts

     If it succeeds, that commit is not the freeze point.

  3. Record it and tag it:

       node -e "const f=require('fs');const p='corpus/holdout/FREEZE.json';
                const j=JSON.parse(f.readFileSync(p));j.frozenAtCommit='<sha>';
                f.writeFileSync(p,JSON.stringify(j,null,2)+'\n')"
       git tag -s corpus-holdout-v1 <sha>

  4. Re-run this script. It will then verify the property on every invocation.

NOTE: cashing the freeze edits FREEZE.json, which is NOT covered by
MANIFEST.sha256 - the manifest deliberately excludes it, so recording the commit
does not trip the drift check.
--------------------------------------------------------------------------------
MSG
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "verify-freeze: git is not available, so the commit cannot be checked." >&2
  exit 2
fi

echo "verify-freeze: checking that $ENGINE was absent at $COMMIT"

if ! git rev-parse --quiet --verify "$COMMIT^{commit}" >/dev/null 2>&1; then
  echo "verify-freeze: $COMMIT is not a commit in this repository." >&2
  exit 1
fi

if git cat-file -e "$COMMIT:$ENGINE" 2>/dev/null; then
  cat >&2 <<MSG

--------------------------------------------------------------------------------
FREEZE INVALID: the engine already existed at the recorded commit.
--------------------------------------------------------------------------------

  $ENGINE is present at $COMMIT.

The holdout's whole claim is that it was authored before the engine, so a freeze
point where the engine exists proves nothing. Either the wrong sha was recorded,
or the ordering did not hold. Do not adjust this script to pass.
--------------------------------------------------------------------------------
MSG
  exit 1
fi

if ! git merge-base --is-ancestor "$COMMIT" HEAD 2>/dev/null; then
  echo "verify-freeze: $COMMIT is not an ancestor of HEAD - the freeze is not on this history." >&2
  exit 1
fi

echo "verify-freeze: OK - the holdout predates $ENGINE, verified at $COMMIT."
