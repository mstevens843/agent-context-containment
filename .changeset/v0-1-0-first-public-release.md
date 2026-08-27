---
"@agent-context-containment/core": minor
"@agent-context-containment/classifier": minor
"@agent-context-containment/conformance": minor
"@agent-context-containment/ledger": minor
"@agent-context-containment/retrieval": minor
---

First public release: 0.1.0.

Containment decides tool calls from PROVENANCE and CAPABILITY, never by reading text for malicious
wording. What ships is the decision engine, the two-phase receipt ledger, the BM25 retrieval adapter,
the baseline classifier the engine is measured against, and the conformance harness a third party can
run over their own policy.

Deliberately `0.1.0` and not `1.0.0`. The evidence supports the mechanism, not an API-stability
promise: the git-object ordering proof is UNAVAILABLE and `verify:freeze` exits 1 by design, the
live-Postgres concurrency proof is opt-in and holds only for the database, version and topology it
was run against, and the corpus is 98 hand-written and imported cases. "v1.0" elsewhere in this
repository is an internal hardening milestone, not this version number.

What the release packet does claim, and what backs each claim, is in `docs/claims.json` with a grade,
a test that fails if the claim stops being true, and a negative control showing that test can fail.
`docs/DEFECTS_FOUND.md` records every defect found in the project's own claim-checking machinery,
including the ones found during this release pass.
