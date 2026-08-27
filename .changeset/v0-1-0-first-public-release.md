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
was run against, and the corpus is 130 hand-written and imported cases. "v1.0" elsewhere in this
repository is an internal hardening milestone, not this version number.

What the release packet does claim, and what backs each claim, is in `docs/claims.json` with a grade,
a test that fails if the claim stops being true, and a negative control showing that test can fail.
`docs/DEFECTS_FOUND.md` records every defect found in the project's own claim-checking machinery,
including the ones found during this release pass.

Includes the v1.0.1 hardening pass, which began when an outside reader was asked to refute the
project rather than review it. Three defects came out of one function and none of them was reachable
from any gate in this repository:

- `resolveTaint` carried one seen-set across a node's siblings and never unwound it, so a source
  reached by a second path was misread as a cycle. A diamond - one document, two extracts, one
  summary, the ordinary shape of `derivedOutput` - resolved to the top of the lattice with every node
  CLEAN. It failed closed, so this was over-refusal rather than leakage. The walk is now iterative,
  path-scoped and memoised.
- The same walk recursed, so a provenance chain about ten thousand deep threw a `RangeError`. That
  broke `decide()`'s own stated contract, and the contract matters: a caller whose policy engine
  throws writes a try/catch, and that catch block is the bypass. `decide()` is now total, and every
  malformed input is denied with a `malformed_input` reason.
- `ceilingFor` asked whether a role was in the STEERING set. A misspelling is not, so it collected the
  row's loosest ceiling: a WEB-derived recipient on `email_send` became an ALLOW purely by
  mislabelling the argument. This is the only one of the three that could permit anything.

Why nothing here caught them: no test and no corpus case had ever declared a source with more than
one parent, so the corpus encoded the graph the author had in mind and could not disagree with the
code about its shape. The prose guard also only ever walked documents, so `decide()`'s false "never
throws" lived in the one place the anti-overstatement apparatus did not look. Both gaps are closed -
the guard now walks source comments too, and found a second false claim on its first run.

`docs/QUICKSTART.md`, `examples/integration-template.ts`, `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`
are new. `examples/` is now typechecked, which it never was, and that immediately found the
`nodeLockingFs(fs)` line printed in three READMEs failing to compile against `node:fs`.

The pass then went after the standing limitations rather than restating them.

**Circularity, reduced with material that was already in the tree.** `corpus/imported/source/` holds
pinned upstream fixtures with more attacker rows than were ever used: the import stopped at the
number of user rows and its own prose called that "every pairable row". Pairing every remaining row
by upstream's own cartesian design took imported cases from 34 to 62 and the corpus from 102 to 130
(98 at the start of the release pass; the four provenance-DAG cases added earlier account for the
rest, and those are the author's).
The grading did not become more the author's: `mapping.test.ts` requires a capability to be a pure
function of upstream's attack type, and every new row carries a type that was already mapped.

**Something now iterates against the engine.** `pnpm adversary` generates provenance graphs and
argument shapes nobody wrote - chains, diamonds, stacked diamonds, cycles, dangling edges, wide
fan-ins - and checks them against a taint walk written independently of the engine's. It is not an
adaptive attacker: it does not learn and does not read the engine to choose its next move. It is also
not decorative. With the diamond defect reintroduced it finds the disagreement in the hundreds within
a few thousand decisions, having been told nothing about what to look for, and it is a CI gate with
its own negative control.

**Coercion is a tripwire now, and still not a membrane.** Interpolating a tainted value used to
produce `[object Object]` silently. It throws and names the way out. The label still cannot survive a
coercion - a primitive cannot carry one - and a test asserts that, so the change cannot be read as
more than it is.

Three checkers were found to be measuring less than they appeared to: a mis-declaration pattern whose
denominator was a literal that had stopped matching any live sentence, a CI gate counter with a
hardcoded list, and the prose guard's coverage line using its own injection list as denominator.
