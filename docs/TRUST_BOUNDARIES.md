# Trust boundaries

**What this library enforces, what it takes your word for, and what it cannot see at all.**

Read this before the numbers. Every figure in `README.md` is conditional on the left-hand column of
the table below being true, and nothing here can check that column.

## The one-paragraph version

Containment decides whether a tool call is permitted from **where a value came from** and **what the
action does**. Both of those are things you *declare*. The engine enforces the flow rules over your
declarations perfectly and has no way to know whether your declarations are honest. Declare a hostile
web page as `SYSTEM` and the attacker's address goes straight into the recipient slot — allowed, not
escalated, not flagged. That is not a defect; it is the boundary, and
`packages/core/test/ingest.test.ts` asserts it so nobody discovers it by surprise.

## Trusted config vs inferred truth

| you declare | the engine enforces | the engine cannot check |
|---|---|---|
| a source's **provenance** | ceilings per capability and argument role | that the bytes really came from there |
| a tool's **capability binding** | effect/egress rules for that row | that the tool does what the row says |
| an argument's **role** | the ceiling for that role | that the parameter means what the role says |
| a **receipt** from your approval flow | one value, one slot, once, with replay refused | that a human really saw the value |
| an **attestation verifier** | origin binding and purpose narrowing | anything about the signature — it is your function |

**Nothing in this library infers any of the left column.** `fromWeb(...)` does not sniff a URL;
`semanticRisks(...)` reads *names* and produces advisories, never facts. The word "validated" appears
in this repository only about **internal consistency**: `validatePolicy` proves a table does not
contradict itself, which is not the same as being true.

**The cost is measured, not estimated.** Declare a send tool as `read_only_tool` and, on the imported
corpus, **9 of 17** direct-harm and **17 of 17** data-stealing attacks go straight through
(`pnpm report:mapping`).

## Cooperative provenance vs hard sandboxing

The taint model is **cooperative**. There is no membrane in JavaScript:

- `Tainted.map(f)` hands `f` the raw value, and `f` can capture it
- `unsafeUnwrap` exists and is exported
- anywhere the wrapper is not threaded through, there is no taint at all
- `derivedFrom` is a second, independent check for exactly this reason — it catches a value laundered
  through a plain string — and it is also declared by the caller

**This is not a sandbox and does not replace one.** It contains nothing, limits no syscall, and stops
no code that is already running. A compromised host defeats all of it. Containment is a decision layer
*above* a sandbox, and the two answer different questions: a sandbox bounds what a process can reach,
containment bounds what an *argument* is allowed to steer.

## Deterministic reviewer vs authoritative judgement

`packages/conformance/src/reviewer.ts` decides from the **bytes** — the values, the evidence, the
consequence in prose — and is structurally denied the taint lattice, the ceilings, the policy table
and the verdict it is reviewing. A test scans its source for that vocabulary.

**It is a rule set somebody wrote down.** It does not model a human, and `reviewer.test.ts` contains a
case where it is **fooled and the engine is not**, plus one where it is right and the engine is
conservative. That asymmetry is the argument for running both; it is not evidence that either is
good. Workflow reports print mechanics and judgement on separate lines for the same reason.

The **model judge** (`pnpm judge:model`) is off by default, refuses to run under CI, gates nothing,
and enters no table. If it were deleted, every number in this repository would be unchanged.

## Local tests vs deployment guarantees

| grade | means | example |
|---|---|---|
| **PROVEN** | a test fails if it stops being true, and a negative control shows the test can fail | the receipt binds to one slot |
| **ADAPTER-PROVEN** | the code is right; says nothing about any deployment | the async reservation protocol against UNIQUE semantics |
| **PROVEN against a real database** | ran against a live Postgres, with a negative control that must double-claim — **and proves it for that database, that version and that topology only.** Not for Postgres in general, and not for your deployment | `DATABASE_URL=… pnpm prove:postgres`, 11/11 |
| **SKIPPED / NOT PROVEN** | not checked on this run. **Never reported as a pass** | that same proof without `DATABASE_URL` |
| **DELEGATED TO CALLER** | outside what the engine can see | whether your hosts share one database |

`docs/claims.json` carries every headline claim with its grade, the test that would fail if it were
false, and its negative control. `pnpm audit:claims` enforces that a PROVEN claim has both.

## What the engine enforces vs what your integration must

**The engine gives you, given honest declarations:**

- a value above its ceiling never steers an acting capability
- an unrated steering role fails closed
- a receipt admits one value, into one slot, once — replay refused by the engine, with its own reason
- two separately-admitted values still need the pair ratified, where a tuple policy names it
- a draft escalates rather than refusing, so the artifact a human reviews still gets built
- every refusal carries reason codes; a refusal nobody can audit is not a control

**Your integration must provide:**

| you must | or else |
|---|---|
| declare provenance honestly, per source | the ceilings are calibrated for a lie |
| bind each tool to the capability it actually has | measured at 17/17 on the data-stealing split |
| thread `derivedFrom` through every transformation | one missing edge launders a hostile source |
| show the human the **exact value**, not a description | the receipt ratifies something nobody saw |
| use `createGuard`, not `advanced.decide` | you supply `now`/`spentReceipts` yourself, or omit them |
| act on what `commit` returns on the `decideOnly` path | you hold a verdict that was true when computed |
| choose a ledger whose `guarantees` match your topology | a lost spend record is a permitted replay |
| pick `staleAfterMs` deliberately | too long strands receipts; too short **double-spends** |
| run `pnpm verify:manifests` on your own tables | a contradictory manifest decides confidently and wrongly |

## Remaining risks

Ordered by how much they would cost if you got them wrong.

1. **A wrong capability declaration.** The largest hole, measured at 9/17 and 17/17. Structural
   validation catches self-contradiction; naming advisories read names. Neither reaches a tool whose
   name is honest and whose behaviour is not.
2. **Cooperative taint.** No membrane. Anywhere `Tainted` is not threaded, there is no taint.
3. **Deployment topology.** Cross-host safety is adapter-proven and, with `DATABASE_URL`, proven
   against a real database. Whether *your* pods share one database is not checkable from here.
4. **`staleAfterMs`.** No setting is free. Reclaiming too eagerly is the double-spend direction.
5. **A corpus mostly written by the policy author.** 34 of 98 cases are upstream bytes; the rest are
   mine, and all the grading is. `pnpm report:mapping` measures how much of the imported result rests
   on my capability choices.
6. **The ordering proof is unavailable.** The v0 holdout was written before the engine and that was
   never committed, so it cannot be shown. `pnpm verify:freeze` exits 1, permanently and by design.
7. **The audit machinery shares its author's blind spots.** `pnpm audit:release` is a floor over
   branches somebody listed. Three times in one pass it made an unearned claim of its own — see
   `docs/DEFECTS_FOUND.md` §15–§17. **An independent refuter is the only control that does not, and
   it is a person.** See `docs/ADVERSARIAL_AUDIT.md`.
