# Integration

**Use `@agent-context-containment/ledger`. Use `@agent-context-containment/core` directly only if you know why.**

## The hazard this exists for

`decide()` takes `now` and `spentReceipts` as **optional** arguments:

```ts
decide({ action, sources, receipts, confirmed, now, spentReceipts });
```

Omit them and you get no expiry checking and unlimited receipt reuse. Nothing warns you. Every test
still passes, every receipt still admits, and a single human confirmation authorises a retry loop
forever.

The core cannot fix this. It reads no clock and holds no state — properties the whole design rests on
and `test/contract.test.ts` enforces by failing the build if either appears. A pure function cannot
own a ledger.

So the fix is a shell whose input type **does not have those fields**:

```ts
import { createGuard } from "@agent-context-containment/ledger";

const guard = createGuard({ clock: () => Date.now() });
const verdict = guard.decide({ action, sources, receipts });
```

`ContainmentInput` types both fields as `never`, so passing them is a compile error rather than a
silent override. That is deliberate and it is not the same as leaving them out of the interface:
TypeScript's excess-property check does not fire through a spread, so `{ ...base, now: 0 }` would
otherwise typecheck and be ignored — the worst outcome, since the caller believes they set a clock.

## What the guard does

| | |
|---|---|
| `guard.decide(input)` | judge, then burn whatever the verdict spent |
| `guard.decideOnly(input)` | judge without burning — for shells doing their own transactional spend |
| `guard.commit(verdict, actionId)` | burn a verdict's receipts. Idempotent |
| `guard.ledger` | the underlying store, for audit |

**Spending happens only on `ALLOW`**, and only for receipts the decision actually used. Burning
evidence that did no work is how a single-use confirmation gets exhausted ten minutes before the
action that needed it.

**One honest caveat.** `decide` burns at *decision* time, not *perform* time. If your shell then fails
to carry out the action, the receipt is gone and a human confirms again. That is the safe direction to
be wrong in — the alternative loses the burn on a crash and permits a replay — but it is a real
behaviour, not an oversight. A shell that needs atomicity uses `decideOnly` and spends alongside its
own effect, in the same transaction.

## Ledgers

```ts
memoryLedger()           // correct, obvious, lost on restart
jsonFileLedger({...})    // survives a restart. SINGLE PROCESS ONLY - see below.
lockingFileLedger({...}) // survives a restart AND is safe across processes
```

**`jsonFileLedger` loses records under concurrency, and a lost record is a permitted replay.** Two
processes read the file, each appends, each writes back; the second overwrites the first, the receipt
still looks unspent, and nothing errors. `packages/ledger/test/locking.test.ts` demonstrates the loss
rather than asserting about it.

**`lockingFileLedger` is the one to deploy.** Mutual exclusion comes from `open(lock, "wx")` —
`O_CREAT|O_EXCL`, where the create-if-absent test is atomic in the kernel, so exactly one process
wins however many are racing. Durability comes from writing a temp file and renaming over the target,
which is atomic within a filesystem: a reader sees the old file or the new one, never a half-written
one. Every `spend` re-reads **inside** the lock, so the check and the write are one critical section.

It throws `LedgerLockError` rather than skipping a spend it could not record — a ledger that quietly
fails to record has permitted a replay, and that is the one outcome worse than an exception. Stale
locks are reclaimed by age, because a process that dies holding one would otherwise turn a crash into
an outage.

**Where it is still not safe**, stated rather than discovered later: NFS and most network
filesystems, where `O_EXCL` and rename atomicity are unreliable; across hosts, for the same reason;
and against a stale reclaim racing a slow-but-alive holder. `ReceiptLedger` is three synchronous
methods, so a Postgres implementation is an afternoon.

### Every adapter declares what it survives, and you can require it

The paragraph above has been true since v0.4 and it does not prevent the failure, because the failure
does not happen when someone reads a paragraph. It happens later, when working code is deployed onto
three pods and **nothing notices**: `isSpent` starts answering `false` for receipts another process
already spent, the guard permits the action, and no exception is raised and no line is logged. That
silence is the whole problem.

So `guarantees` is a **required** field on `ReceiptLedger` — an adapter cannot decline to answer:

| adapter | singleProcess | singleHost | crossHostSafe | crashSafe | staleLockReclaim |
|---|---|---|---|---|---|
| `memoryLedger` | yes | no | no | no | no |
| `jsonFileLedger` | yes | no | no | yes | no |
| `lockingFileLedger` | yes | **yes** | no | yes | yes |
| `durableLedger` + `postgresSpendStore` | yes | yes | **yes, once proven** | yes | n/a |

**No file-backed adapter claims `crossHostSafe`, and a test asserts none of them ever quietly starts
to.** The one adapter that can claim it has to earn it — see below.

State what your deployment needs and get a **startup failure** instead of a silent regression:

```ts
createGuard({
  clock: Date.now,
  ledger: lockingFileLedger({ path, fs: nodeLockingFs(fs), now: Date.now }),
  requireGuarantees: { singleHost: true, crashSafe: true },   // throws at construction if not claimed
})
```

The error repeats the adapter's own caveat and says what to do instead. Note what this does **not**
do: verify the claim. An adapter that declares `crossHostSafe: true` without being so is believed.
What the field buys is that the claim is written down, versioned with the code, and compared against
what the caller needs.

### Cross-host: `durableLedger`

Everything above is a filesystem, and a filesystem cannot give you the one thing several machines
need. The check and the write have to be **one atomic operation at a point every host agrees on**, and
any gap between a read and a write is the race. `twoHostSimulation()` shows what the gap costs: two
machines, one receipt, spent twice, no error anywhere.

So the whole cross-host problem reduces to a single primitive:

```ts
insertIfAbsent(record) -> "inserted" | "already_present"
```

One call, one atomic decision. In Postgres that is `INSERT ... ON CONFLICT DO NOTHING RETURNING`
against a `PRIMARY KEY`; in Redis, `SET NX`; in DynamoDB, a conditional put. `RETURNING` is what tells
the caller *which* one it was — without it there is no way to separate "I recorded this" from
"somebody else already had", and that distinction is the entire point.

```ts
import {
  createGuard, durableLedger, postgresSpendStore, proveCrossHost, crossHostProven, POSTGRES_SCHEMA,
} from "@agent-context-containment/ledger"

// Run POSTGRES_SCHEMA once at deploy time. It is CREATE TABLE IF NOT EXISTS.
const connect = () => postgresSpendStore({
  query,                      // (sql, params) => rows — your driver, wrapped
  sharedAcrossHosts: true,    // true only if every host really points at THIS database
})

const guard = createGuard({
  clock: Date.now,
  ledger: durableLedger({
    store: connect(),
    verifiedCrossHost: crossHostProven(proveCrossHost(connect)),
  }),
  requireGuarantees: { crossHostSafe: true },   // now satisfiable; before v0.7 it never was
})
```

**There is no `pg` dependency here, and there will not be one.** A native driver, a connection pool
and a lifecycle have no business in the path of `decide()`. `SqlExecutor` is `(sql, params) => rows`,
so a raw-`pg`, Drizzle, Prisma or Knex caller wires it the same way in one line.

**The claim is earned, not asserted.** `durableLedger` will not pass `crossHostSafe: true` through
unless *both* are true: the store declares `sharedAcrossHosts`, and it passed `proveCrossHost()` —
five interleavings including the concurrent double-spend that breaks the file-backed adapters.
Otherwise the ledger **downgrades itself to single-host** and says so in its own caveat. A store that
reads then writes fails scenario 2 and only scenario 2; `packages/ledger/test/durable.test.ts` runs
`nonAtomicStore` through the proof and asserts it is rejected, because a proof that cannot fail is
decoration.

Run it yourself:

```bash
node scripts/prove-crosshost.mjs                      # adapter logic, no database needed
DATABASE_URL=postgres://... node scripts/prove-crosshost.mjs   # also checks your database's constraint
```

**What the proof does not cover, stated plainly:** that *your* hosts share *one* database. A Postgres
in a container on a laptop is atomic and is not cross-host; neither is a per-pod sidecar. No test here
can see your infrastructure, which is why `sharedAcrossHosts` is a question the caller answers.

#### The synchronous problem

`ReceiptLedger` is synchronous because `Guard.decide` is, because the engine is — and making a
security decision return a promise would push `await` into every call site of it. A database is not
synchronous. Three shapes work, in rough order of how much you should like them:

1. **Spend transactionally alongside your own effect.** Use `guard.decideOnly()`, then insert the
   receipt row in the *same* transaction as the action it authorises. Strongest: the burn and the
   effect commit or roll back together.
2. **A warm in-process set, written through.** `isSpent` answers from memory; every `spend` also does
   the atomic insert. Correct as long as the insert's return value is what you act on, never the
   cached read.
3. **A blocking bridge** — a worker thread with `Atomics.wait`, or a synchronous driver. Simple,
   and it puts a network round trip inside a policy decision.

### Writing your own adapter

Three methods and the metadata block. Two of the three guarantees in the interface comment fail
*silently* when they are missing, so the package ships a runnable suite rather than a checklist:

```ts
import { checkLedger, formatLedgerChecks } from "@agent-context-containment/ledger";
console.log(formatLedgerChecks(checkLedger(() => myPostgresLedger())));
```

It covers idempotent `spend`, first-spend-wins ordering, `isSpent` durability, non-collision, no
throwing on ordinary input, and internal consistency of the declared guarantees. All three shipped
adapters pass it, and `packages/ledger/test/guarantees.test.ts` runs them through it.

**For anything cross-host, put a real store behind the interface.** Postgres with a unique constraint
on the receipt id, or Redis with `SET NX`, are both a short afternoon; the interface is synchronous,
so the adapter does its own blocking or caching. `twoHostSimulation()` in the same package shows in
eight lines exactly what you are buying: two hosts, one receipt, spent twice, no error anywhere — and
once the stores converge the ledger looks perfectly consistent, which is what makes it so hard to spot
after the fact.

## Why not SQLite

Node 22 ships `node:sqlite` as experimental, and `better-sqlite3` is a native module with a build
step. Either puts a compiled dependency in the path of a policy decision, to store a set of short
strings. The access pattern is append-mostly over a few thousand ids, so a lock and an atomic rename
— both of which the filesystem already provides — is the right amount of machinery.

`ReceiptLedger` is three synchronous methods, so a Postgres or Redis implementation is an afternoon.
It is synchronous on purpose: an async port would force `Guard.decide` to be async, and the engine was
built for synchronous call sites.

**A ledger that forgets permits replay after every deploy.** The in-memory one is right for tests and
for a process that does not outlive a request; anything longer-lived wants the file, or a real store.
`jsonFileLedger` is explicitly not safe across processes — two writers lose records, and a lost record
is a permitted replay.

## When to use the core directly

Three cases, all of them ones where controlling time and the ledger is the point:

- **writing a checker** — `checkContainment` re-derives decisions and must not consume anything;
- **replaying an audit log** against a past policy, where "now" is a historical moment;
- **testing**, including every test in this repository.

Everywhere else, the guard. The raw engine is the advanced path, and the reason it stays exported is
that the three cases above are real — not because it is the recommended one.

It is also namespaced: `advanced.decide` is the same function as the flat `decide`, exported under a
name that reads differently in a diff. A reviewer skimming a pull request sees the word.

**Be honest about the size of that.** It is a naming convention, not a barrier. Nothing stops anyone
importing the flat export, and `packages/ledger/test/misuse.test.ts` asserts that the bypass still
works rather than implying otherwise. What stops the *accident* is the guard's type; the namespace
only stops the accident being invisible.
