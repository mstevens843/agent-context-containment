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

IN THIS REPOSITORY, THIS IS EXPECTED AND WILL NOT BE FIXED.

A freeze was attempted and rejected: the commit recorded already contained
packages/core/src/policy.ts, so it cannot witness a point where the corpus
existed and the engine did not. No holdout-only pre-engine commit exists in this
history - the corpus and the engine were first committed together.

So the ordering proof is UNAVAILABLE here, not merely pending. See
corpus/holdout/FREEZE.json for the full record of the attempt.

WHAT IS STILL TRUE, and is what the project claims:

  - the 16 holdout cases have not changed
  - MANIFEST.sha256 covers their bytes, and CI verifies it before anything else
  - that check has caught a real drift once, when a formatter rewrote whitespace

WHAT IS NOT TRUE, and must not be written anywhere:

  - that the holdout is proven to predate the engine

THE LESSON, for the next repository:

  Authoring order leaves no trace. Commit order does. The holdout must be
  COMMITTED before the engine exists, not merely written first:

  1. Author the corpus and the spec it is written against.
  2. Commit them, with no engine in the tree.
  3. Record that sha and tag it, BEFORE writing the engine.
  4. Verify - this must exit NON-ZERO:

       git cat-file -e <sha>:packages/core/src/policy.ts

DO NOT weaken this script to make it pass, and do not record a commit that does
not satisfy it. A freeze check that can be talked into agreeing is worth less
than no freeze check at all, because it looks like evidence.

NOTE: FREEZE.json is deliberately excluded from MANIFEST.sha256, so recording or
clearing a commit here never trips the drift check.
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
