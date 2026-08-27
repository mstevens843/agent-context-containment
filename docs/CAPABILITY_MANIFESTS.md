# Capability manifests

**The engine enforces flow given the declaration. It cannot check the declaration is honest.**

That is the largest remaining hole in this project, it is not closable from the inside, and this
document is about being precise rather than reassuring.

## The size of it

`pnpm report:mapping` re-runs every imported case under a deliberately *understated* declaration —
a tool filed as less capable than it is:

| split | attacks that go straight through |
|---|---|
| InjecAgent direct harm | **21 of 30** |
| InjecAgent data stealing | **32 of 32** |

The second is not a corner case, it is the whole split, and necessarily so: those attacks *are* the
send. Declare the send harmless and there is nothing left for containment to refuse — not because the
engine failed, but because it was told the action does nothing.

## Three buckets, and only one is code

| bucket | means | who settles it |
|---|---|---|
| **structural** | a contradiction *inside* the declaration | `validatePolicy()`, a pure function |
| **corroborated** | needs exactly one named artifact — a tool's parameter schema, a decision log, an observed effect | a check outside this library, or a person |
| **undecidable** | requires knowing what the tool *means* | nobody, from here |

**Of the five mis-declarations most worth worrying about, only two are structural.**

| mis-declaration | bucket | why |
|---|---|---|
| read-only while it has side effects | corroborated | `effect: "none"` contradicts nothing internally |
| steering role labelled `payload` | corroborated | needs the tool's schema or its semantics |
| full egress understated as read-only | corroborated | same shape, and the 32/32 above |
| confirmation omitted on an irreversible row | **structural** | contradicts the declared effect |
| tuple missing for paired dangerous args | **structural** | a property of the row's own ceilings |

Declaring a tool's transport — *"performs an outbound request to a host taken from parameter `url`"* —
**does not detect the lie. It relocates it one level down.** What that relocation buys is
**specificity**, and a more specific claim is one a schema or a probe can contradict. That is the only
mechanism by which an item moves from undecidable to corroborated, and it is worth saying plainly,
because "we validate the manifest" invites the reading that a validated manifest is a true one. It is
a *consistent* one.

## What `validatePolicy` does check

```bash
pnpm verify:manifests        # every table in the repo, plus a diff of each profile
```

```ts
import { validatePolicy, contradictions } from "@agent-context-containment/core"

const bad = contradictions(validatePolicy(myPolicy))
if (bad.length > 0) throw new Error(...)   // at startup, never inside decide()
```

**Contradictions** — the manifest is wrong however the tools behave:

| code | what it catches |
|---|---|
| `UNKNOWN_CAPABILITY` | a row for a capability nobody vetted. A *missing* row fails closed; an *extra* one fails **open**, because `decide` honours whatever it finds |
| `MISSING_CAPABILITY` | the reverse — every action naming it is refused |
| `ROW_KEY_MISMATCH` | a copy-pasted row that forgot to change its own key |
| `INERT_ROW_UNRATED_STEERING_ROLE` | defect §12's general form: a no-effect, no-egress row whose unrated steering role clamps to a flat DENY with no route out |
| `DEAD_TUPLE_POLICY` | defect §13: a combination gate on a row that can admit nothing separately, so it can never fire |
| `TUPLE_WITHOUT_DISTINCT_ROLES` | a combination of one thing |
| `DRAFT_THAT_ACTS` | `draftOnly` on a row with an effect or an egress — a general safety downgrade wearing a narrow name |

**Suspicions** — defensible, and the shape of a known mistake:

| code | what it means |
|---|---|
| `STEERING_ADMITS_TOOL_DERIVED` | reopens the band the mixed-provenance splice check covers — and that check is **diagnostic only**. The `permissive` profile trips this twice |
| `IRREVERSIBLE_WITHOUT_CONFIRMATION` | must be a decision somebody made, not a field nobody filled in |
| `UNLIFTABLE_STEERING_CEILING` | every refusal is a flat DENY with no route to approval. Correct for a signing key, an availability failure elsewhere |
| `ROLE_LOOSER_THAN_DEFAULT` | legitimate for `payload`/`selector`; on a steering role it is how a ceiling widens by accident |
| `HIGH_BLAST_RADIUS` | irreversible *and* full egress — the rows where an under-declaration costs most, so the rows to audit first |

The shipped table has **0 contradictions and 7 suspicions**, and the suspicions stay visible on
purpose: a validator that returns nothing against the table it was written for has been tuned until it
agrees.

## Why a function, not a test

Every one of these rules used to live in a `describe()` block over the shipped `CAPABILITY_POLICY`.
But `decide(input, policy)` accepts **any** policy, and `packages/conformance/src/profiles.ts` builds
five at run time and publishes numbers from them — none of which were ever checked against the rules
the shipped table has to satisfy. **A rule that only ever runs against one constant is a rule about
that constant.**

Profiles now validate at construction and throw on a contradiction. Throwing is right there and would
be wrong inside `decide()`: this is module load, no request in flight, and the only thing a caller
could do with a caught error is run anyway. A manifest problem is a config-time problem.

## Diffing

A capability table is configuration, and configuration gets reviewed by whoever is on rotation. **A
one-word edit — `CLEAN` to `TOOL_DERIVED` on one role of one row — is the smallest change that fully
disables containment for a capability, and it looks like nothing in a pull request.**

```ts
import { diffPolicies, formatPolicyDiff } from "@agent-context-containment/core"
console.log(formatPolicyDiff(diffPolicies(before, after)))
```

Loosenings are listed first and separately. Two are easy to get backwards and are worth stating:
**removing a row is a tightening** (`decide` fails closed on a capability it cannot find), and
**adding one is a loosening** (it honours whatever it finds).

## What to actually do about the hole

1. **Audit the `HIGH_BLAST_RADIUS` rows first** — which tools are bound to `payment`, `email_send`,
   `wallet_sign`, `transaction_broadcast`. That binding is the highest-leverage thing in a deployment.
2. **Derive the binding from the tool's schema where you can**, rather than declaring it by hand.
   A generated declaration can be wrong; a hand-written one can be wrong *and* drift.
3. **Diff the manifest in code review** and read the loosenings, not the whole table.
4. **Treat it as a supply-chain surface.** A capability table is a config file that decides what an
   agent may do; it deserves the review a dependency bump gets, and usually gets less.
