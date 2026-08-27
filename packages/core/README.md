# @agent-context-containment/core

The policy engine. Zero dependencies, zero I/O, zero randomness — a contract test fails the build if
this package grows an import, a clock, a `Promise`, or a hard-coded threshold.

```ts
import { decide, actionId, sourceId } from "@agent-context-containment/core"
```

**Most callers should not use this directly.** Use `@agent-context-containment/ledger`'s `createGuard`, which
supplies the two arguments whose omission silently disables replay protection. The raw engine is
exported for three cases: writing a checker, replaying an audit log against a past policy, and
testing. See `docs/INTEGRATION.md`.

## What is in here

| | |
|---|---|
| `policy.ts` | `CAPABILITY_POLICY`, the single truth table: 10 capabilities × `effect` × `egress` × per-role taint ceilings |
| `taint.ts` | the lattice `CLEAN < USER_CONTROLLED < TOOL_DERIVED < UNTRUSTED_EXTERNAL`, and the provenance join |
| `declassify.ts` | the eight rules that can admit a value above its ceiling, and the arithmetic that decides which are admissible at all |
| `check.ts` | `checkContainment` — re-derive a third party's decision log and find the disagreements |
| `corpus.ts` | the corpus schema and its validator |

## The two ideas

**Capabilities are rated on two axes, not one.** `effect` (none / reversible / irreversible) and
`egress` (none / metadata / full) are independent, and `web_fetch` proves it: it changes nothing and
leaks everything. A one-dimensional "how dangerous is this tool" scale waves it through, which is how
the commonest real exfiltration path gets missed.

**Ceilings are per argument role, not per capability.** Untrusted text in the *payload* of an email is
the product. Untrusted text choosing the *recipient* is the attack. Without that split the library
would be unusable, and with it a single row can permit the first and refuse the second.

Unrated steering roles **fail closed**: they tighten to `USER_CONTROLLED` rather than inheriting a
permissive default, so forgetting to rate a role is never the loosening.

## What it does not do

It does not read the text. Not as a fallback, not as a tiebreak. That is the whole design: a decision
made from provenance and capability is unaffected by how innocent the content looks, and unaffected by
how alarming it looks either.
