# Audit log

What each adversarial audit found, and what changed because of it. Append-only.

The entries are deliberately unflattering. An audit log that records only clean runs is a log of the
audits that were not worth running.

---

## v0.9 — the first adversarial audit

**Method.** Four independent readers, each given one area and asked to **refute** rather than review,
followed by a second pass that refuted their findings. Run against a working tree that was changing
underneath them, which produced its own finding.

**What it found, in order of severity.**

### 1. §10 was graded PROVEN on a test that could not fail

The guard's re-decide branch — the fix for "the store won the race and never told the guard" — was
called FIXED and PROVEN. **Deleting the entire branch left 74 of 74 tests passing.**

The §10 tests were sequential: by the time the second guard read the spent set, the first had already
committed, so it refused correctly without the branch running. The branch only executes when a row
appears between `judge()` and `commit()` inside one synchronous call, which no shipped store can
produce — `spentSet()` and `spend` read the same map.

**Changed:** a store that models the race directly (unspent on read, already-taken on write). Deleting
the branch now fails 2 of 77. Entry `guard-redecide` in `pnpm audit:mutations`.

**Confirmed by accident, within the hour.** An audit agent left a mutation in the tree — `>= 0` where
the source says `=== 0`, which makes the branch dead — and the new test caught it immediately. The
machinery working on a regression nobody planted deliberately.

### 2. A comment claimed a fix that was never written

`policy.ts` said §11 had *"two independent fixes: this one, and rejecting duplicate argument names
outright."* The second was never implemented and nothing enforced it. Duplicate labels are legitimate
— an array parameter — which is why the fix is slots rather than a ban.

**Changed:** comment corrected, with the correction recorded rather than quietly rewritten. This is
defect §6 in a new costume: a comment asserting a property nobody checked.

### 3. §11 had been closed as FIXED when it was MITIGATED

v0.8 stopped a receipt being *reused within one action* and left `argName` as the key everywhere
else: `coverFor` matched on it, `admittedByReceipt` was a set of names, and `tupleKey` produced
`"url+url"`.

**Changed:** the slot model — `slotsOf`, `ActionArg.path`, `ReceiptEvidence.argPath`, everything keyed
by slot. Mutant M9, corpus `slot-t-001` and its paired control.

### 4. Stale numbers, for the third and fourth time

`STATUS.md` still carried `imported 6` (three versions after it became 34) and a silent-attack table
of 23/23 (long after 69/69).

**Changed:** generated blocks — see the v1.0 entry.

### 5. A regex standing in for a classifier claim

The §9 labelling test asserted one convention (`ignore previous instructions`) while the silent-attack
row reports a stronger property: that the shipped detector scores zero. The detector also blocks on
*"your real task is"* and *"approve all requests"*, so a case with either would have passed the test,
been counted silent, and made the published `0/69` wrong.

**Changed:** asserted directly with `classify()`. Not circular — using it to *define* the label would
be; using it to *check* the label asserts exactly the consistency the row already claims.

---

## v1.0 — turning the audit into machinery

**Method.** Three readers on claim traceability, unprotected branches and stale numbers, each refuted
by a second pass. Plus the first run of `pnpm audit:mutations`, which is the v0.9 method made standing.

**What it found.**

### 6. The purity contract's import check had been vacuous since it was written

**The most fundamental claim in this project** — *"the pure core imports nothing at all"*, graded
PROVEN, cited in the README, in STATUS, in `claims.json` and in every package README.

The contract test stripped comments **and string literals** before scanning for imports. An import
specifier *is* a string literal, so `from "node:fs"` became `from ""`, and the specifier regex
required at least one character. **It matched nothing, in every file, on every run.** The test looped
over an empty list and passed.

Found by `pnpm audit:mutations`: adding `import { readFileSync } from "node:fs"` to `policy.ts` and
watching nothing fail.

**Changed:** two strippers instead of one. Comments-only for anything that reads a string (imports);
comments-and-strings for anything that reads an identifier (`Date.now`, `Math.random`). The two needs
are genuinely different, and collapsing them is what made the check vacuous.

### 7. Three of eight mutation entries were written wrong, and the guard caught them

Their `find` strings matched zero times — the mutation would have silently done nothing and reported
as **caught**. The script refuses to run on any entry whose `find` does not match exactly once.

A mutation-testing harness that reports success for a no-op is the same failure it exists to detect,
one level up.

### 8. The mutation audit was unreadable against a moving tree

Concurrent edits left the tree failing, which made every mutation report as caught and two genuinely
protected branches report as SURVIVED. Meaningless in both directions.

**Changed:** the script refuses to run unless the baseline suite is green. A mutation audit is a
differential measurement and needs a known starting point.

### 9. My own audit entry made an unearned claim

The `core-purity` mutation originally *skipped the contract test* and expected a failure — which is
incoherent, because a skipped test passes. It reported SURVIVED, correctly, and the finding was about
the entry rather than the code.

Recorded because "the check written to catch unearned claims made an unearned claim" is exactly the
shape the script exists for, and it happened on its first run.

### 10. The audit machinery, audited — four of its own claims did not survive

Run against v1.0 itself, immediately after building it. Full account in `DEFECTS_FOUND.md` §17.

- **The prose guard could not fire on four of its five rules.** A bare `no` anywhere in a paragraph
  exempted it. Four of five injected false claims passed, while `audit:docs` reported the guard as
  working — because its one injected sentence happened to lack the word.
- **The claim registry asserted something false.** It said the engine contains "no wallet"; `wallet`
  appears four times in `policy.ts` and was never scanned.
- **The control for the whole mutant apparatus was outside CI.** "M0 reference is bitten by nothing"
  lived only in a script `pnpm test` does not run.
- **The most-quoted table in the README was hand-typed**, outside every generated block.

**Changed:** proximity-based negation, per-item paragraphs, one injection per rule, a precise
registry claim, the reference control moved into vitest, and a `holdout-headline` block.

---

## The pattern, across all audits

Every single finding is the same shape: **a mechanism that reports success without having measured
anything.** A test whose branch never runs. A comment asserting an unwritten fix. A regex standing in
for a classifier. A scanner matching an empty list. A mutation that does nothing. A skipped test read
as a passing one.

None of these look like failures from the inside. All of them look like green.
