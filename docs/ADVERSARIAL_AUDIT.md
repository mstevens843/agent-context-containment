# Adversarial audit

**Every mechanism in this repository for catching overstated claims was built because the author
overstates claims. None of them caught defect §15. An independent reader asked to *refute* did.**

This document turns that into a step rather than an accident.

## What §15 was

v0.9 graded two claims **PROVEN**:

- The guard's "re-decide when it loses a receipt race" branch. **Deleting the entire branch left 74 of
  74 tests passing.** The tests were sequential; the branch only runs in an interleaving no shipped
  store could produce.
- A source comment asserting *"two independent fixes"* where the second was never written.

Neither was caught by the corpus checks, the mutants, the discrimination requirement, or a prose guard
written **in the same hour**. The failure is not that the machinery was weak. It is that all of it was
built by the person whose claims it was checking, and it therefore shares his blind spots exactly.

And then, running the audit for v1.0, the same method found something worse: **the purity contract's
import check had been vacuous since it was written** (§16). The most fundamental claim in the project,
cited as PROVEN in four documents, defended by a loop over an empty list.

## The protocol

Run before any release, and after closing any defect.

### 1. Pick the claims

Five to ten, from `docs/claims.json`. Prefer the ones a reader would quote and the ones most recently
graded — a claim graded in the last pass has had the least time to be contradicted.

### 2. For each: name the test that would fail if it were false

Not "there are tests in that area". The **specific** test, at a file and line. If you cannot name one,
that is the finding, and it is the most valuable output of the whole exercise.

### 3. Delete the fix and verify the tests fail

```bash
pnpm audit:mutations
```

Each entry patches the source, rebuilds, runs the named tests and requires them to **fail**. A
surviving mutation is a claim with no test behind it.

Two properties of that script are load-bearing and were both learned the hard way:

- **It refuses to run unless the tree is already green.** A pre-existing failure makes every mutation
  look caught. It is a differential measurement and needs a known starting point.
- **Each `find` must match exactly once.** Zero matches means the mutation silently did nothing and
  then reported as caught. Three entries were written wrong the first time and the guard refused all
  of them.

### 4. Check the docs against the generated reports

```bash
pnpm audit:docs        # generated blocks match their generators; no document overstates
```

Stale numbers have recurred in **four** separate passes. Hand-typed numbers in tables are now
generated blocks; hand-typed numbers in sentences must name the script that produces them.

### 5. Verify classifier claims against `classify()`, never a proxy

The §9 labelling test encoded one regex while the claim was about the shipped detector. The detector
also blocks on *"your real task is"* and *"approve all requests"* — a case with either would have
passed the regex test, been counted silent, and made the published number wrong. **No proxy regex for
a classifier claim** unless the claim is explicitly about the regex.

### 6. Verify each mutant isolates one defect

```bash
pnpm report:mutants
```

Bitten by nothing → it models a defect nothing exercises. Bitten by everything → blunt, and it proves
the suite is a tripwire rather than a measurement. Three times a mutant has been silently rescued by a
mechanism unrelated to its defect (§4, §11, §14), each time right after an unrelated fix. **A green
mutant is a claim that needs re-earning after every change to the mechanism it targets.**

### 7. Verify negative controls fail for the intended reason

A negative control that fails for the wrong reason is worse than none: it reports as discriminating.
`nonAtomicStore` must fail *exactly* the concurrent double-spend scenario — not all five.

### 8. Verify the prose guard catches an injected false claim

Add a sentence asserting something false, run `pnpm audit:docs`, confirm it is caught, remove it. A
guard nobody has seen fail is a guard nobody should trust.

### 9. Get an independent reader to refute

**The step none of the above replaces.** Not review — *refutation*. The brief that works:

> Find claims that are wrong about this codebase; tests proposed or claimed that could not actually
> fail; rules that would fire on every honest input and be disabled; anything that overstates what
> would be proven. Verify every file:line citation — a confident wrong citation is worse than a vague
> right one. Say which parts survive and which is the weakest link.

Asking someone to *review* produces agreement. Asking them to *refute* produces §15 and §16.

## What this protocol cannot do

It is still run by the author, on claims the author selected, with mutations the author wrote. The
mutation list covers the branches somebody thought to list — which is precisely how §15 happened.

`pnpm audit:mutations` reporting 8 of 8 caught is a **floor**, not a ceiling. It says those branches
are defended. It says nothing about the ones nobody listed, and adding an entry is part of closing a
defect rather than an afterthought.

The independent reader remains the only control that does not share the author's blind spots, and
that is a person, not a command.
