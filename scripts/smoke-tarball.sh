#!/usr/bin/env bash
# Install the real tarballs into a throwaway directory and check the one thing that matters.
#
# WHY TARBALLS AND NOT THE WORKSPACE. Everything else in this repository tests the source tree. A
# consumer installs a tarball: a different file set, a different module resolution, and `files`
# deciding what exists. v1.0 finalization found all five packages shipping without a LICENSE, which
# no source-tree test could have seen. This runs against what strangers actually get.
#
# OFFLINE. Packages are installed from local .tgz paths, so nothing here touches a registry. The
# post-publish registry smoke is a separate, manual step in PUBLISHING.md.
#
# Both module systems are exercised, because `exports` maps them separately and a broken `require`
# path is invisible to an ESM-only check.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "smoke: packing from $ROOT"
cd "$ROOT"
pnpm -s build >/dev/null

# `pnpm pack`, NOT `npm pack`, AND THE DIFFERENCE IS A PUBLISH BLOCKER.
#
# The workspace packages depend on each other by `workspace:*`. `npm pack` copies that string into
# the tarball verbatim, and `npm install` of the result dies with
# `EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`. `pnpm pack` rewrites it to the real
# version. So an `npm pack --dry-run` that looks perfect can still describe a tarball nobody can
# install - which is exactly how this was found. See DEFECTS_FOUND.md §22.
for p in core ledger; do
  (cd "packages/$p" && pnpm pack --pack-destination "$WORK" >/dev/null)
done

# Prove the rewrite happened rather than assuming it. If a `workspace:` specifier survives into a
# tarball, publishing it produces a package that cannot be installed.
# Tarball filenames are derived, never hardcoded: they carry the scope and the version, and both
# have changed under this script's feet once already.
LEDGER_TGZ="$(ls "$WORK"/*ledger-*.tgz)"
if tar -xzOf "$LEDGER_TGZ" package/package.json | grep -q 'workspace:'; then
  echo "SMOKE FAILED: a workspace: specifier survived into the tarball - it would be unpublishable"
  exit 1
fi

cd "$WORK"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund ./*core-*.tgz ./*ledger-*.tgz >/dev/null

echo "smoke: installed"
ls node_modules/@agent-context-containment/core/LICENSE >/dev/null || { echo "SMOKE FAILED: no LICENSE in the installed package"; exit 1; }

# ---- the containment check itself, once per module system --------------------------------------
# An untrusted web source steering the recipient of an irreversible, full-egress send. If a published
# build permits this, it is broken in the exact way the project exists to prevent.
cat > check.cjs <<'JS'
const { decide, actionId, sourceId } = require("@agent-context-containment/core");
const v = decide({
  action: { id: actionId("a"), capability: "email_send", tool: "gmail.send",
            args: [{ name: "to", role: "sink_identity", derivedFrom: [sourceId("web")] }] },
  sources: [{ id: sourceId("web"), provenance: "WEB" }],
  receipts: [],
});
if (v.decision === "ALLOW") { console.error("SMOKE FAILED (cjs): untrusted web content steered a send"); process.exit(1); }
console.log("  cjs  ->", v.decision, "|", v.reasons.map((r) => r.code).join(","));
JS

cat > check.mjs <<'JS'
import { decide, actionId, sourceId } from "@agent-context-containment/core";
import { createGuard } from "@agent-context-containment/ledger";
const v = decide({
  action: { id: actionId("a"), capability: "email_send", tool: "gmail.send",
            args: [{ name: "to", role: "sink_identity", derivedFrom: [sourceId("web")] }] },
  sources: [{ id: sourceId("web"), provenance: "WEB" }],
  receipts: [],
});
if (v.decision === "ALLOW") { console.error("SMOKE FAILED (esm): untrusted web content steered a send"); process.exit(1); }
console.log("  esm  ->", v.decision, "|", v.reasons.map((r) => r.code).join(","));
// The ledger's public entry point must construct across the package boundary.
const guard = createGuard({ clock: () => 0 });
if (typeof guard.decideOnly !== "function") { console.error("SMOKE FAILED: ledger guard did not construct"); process.exit(1); }
console.log("  esm  -> ledger guard constructed");
JS

node check.cjs
node check.mjs
echo "smoke: OK - the published build refuses an injected send in both module systems"
