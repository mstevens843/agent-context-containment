#!/usr/bin/env bash
#
# Verify that the frozen holdout corpus has not drifted, byte for byte.
#
# WHY THIS EXISTS. The holdout is the instrument that grades the policy engine. If it can be edited -
# deliberately, or by a formatter, or by an editor stripping a trailing newline - then every number
# measured against it is unfalsifiable, because the thing being measured and the thing doing the
# measuring are both under the same hand.
#
# This is not hypothetical in this repository. Before `corpus` was added to biome's ignore list, a
# routine `biome check --fix` reformatted the JSON whitespace of three holdout files. The content was
# unaffected; the bytes were not. The manifest is what caught it, and it was being run by hand.
# See docs/DEFECTS_FOUND.md section 5.
#
# ONLY THE HOLDOUT IS GATED. corpus/tuning/ is expected to change - it is where new regression cases
# go when the holdout is found wanting - so gating it would produce false failures and train everyone
# to ignore this check. Its manifest is informational.
#
# IF THIS FAILS, DO NOT REGENERATE THE MANIFEST TO MAKE IT PASS. That is the one move that turns a
# working integrity check into decoration. Find out what wrote to the file first.

set -euo pipefail

MANIFEST="corpus/holdout/MANIFEST.sha256"

if [ ! -f "$MANIFEST" ]; then
  echo "verify-corpus: $MANIFEST not found." >&2
  echo "Run this from the repository root." >&2
  exit 2
fi

# shasum is the documented command and is present on macOS and on GitHub's ubuntu runners.
# sha256sum is the coreutils fallback for a leaner Linux image. Same digest either way.
if command -v shasum >/dev/null 2>&1; then
  CHECK=(shasum -a 256 -c "$MANIFEST")
elif command -v sha256sum >/dev/null 2>&1; then
  CHECK=(sha256sum -c "$MANIFEST")
else
  echo "verify-corpus: neither shasum nor sha256sum is available." >&2
  exit 2
fi

echo "verify-corpus: checking frozen holdout against $MANIFEST"

if "${CHECK[@]}"; then
  n=$(grep -c . "$MANIFEST")
  echo "verify-corpus: OK - $n holdout file(s) match the frozen manifest."
  exit 0
fi

cat >&2 <<'MSG'

--------------------------------------------------------------------------------
CORPUS DRIFT: the frozen holdout no longer matches its manifest.
--------------------------------------------------------------------------------

The holdout grades the policy engine. If it changes, every number measured
against it is worth less, and possibly worth nothing.

Do NOT regenerate the manifest to make this pass. Work out what wrote to the
file:

  1. A formatter or linter?  `corpus` is in biome's ignore list; check that it
     is still there, and check any editor-on-save formatting.
  2. A deliberate edit?  The holdout is frozen at v0. New cases belong in
     corpus/tuning/. If the holdout genuinely needs to change, that is a
     holdout v2: cut a new version, keep v1's results published, and say so.
  3. A whitespace-only change?  The content may be intact and the bytes are
     still not. Both claims matter and they are not the same claim.

Only regenerate the manifest once you know which of those it was, and record it
in docs/DEFECTS_FOUND.md.
--------------------------------------------------------------------------------
MSG
exit 1
