# @agent-context-containment/ledger

The recommended entry point. Wraps the engine with a clock and a receipt ledger, so replay protection
is not something a caller can forget.

```ts
import { createGuard, lockingFileLedger, nodeLockingFs } from "@agent-context-containment/ledger"
import fs from "node:fs"

const guard = createGuard({
  clock: Date.now,
  ledger: lockingFileLedger({ path: "./receipts.json", fs: nodeLockingFs(fs), now: Date.now }),
  requireGuarantees: { singleHost: true, crashSafe: true },   // fails at startup, not silently
})

const verdict = guard.decide({ action, sources, receipts, confirmed })
```

`ContainmentInput` types `now` and `spentReceipts` as `never`. They are not the caller's to omit,
because omitting them disables replay protection without any visible sign.

## Adapters, and what each survives

| adapter | singleProcess | singleHost | crossHostSafe | crashSafe |
|---|---|---|---|---|
| `memoryLedger` | yes | no | no | no |
| `jsonFileLedger` | yes | no | no | yes |
| `lockingFileLedger` | yes | **yes** | no | yes |
| `durableLedger` + `postgresSpendStore` | yes | yes | **yes, once proven** | yes |

`guarantees` is a **required** field. An adapter cannot decline to say what it survives, because the
failure it prevents is silent: code tested on one process is deployed onto three pods, `isSpent`
starts answering `false` for receipts another pod already spent, and nothing logs.

## Cross-host

The whole problem reduces to one atomic primitive — `insertIfAbsent(record)` — because any gap between
a read and a write is the race. `postgresSpendStore` builds one from `INSERT ... ON CONFLICT DO
NOTHING RETURNING` against a `PRIMARY KEY`, **with no `pg` dependency**: you pass a query function.

The claim is earned, not asserted. `durableLedger` refuses to pass `crossHostSafe: true` through
unless the store both declares `sharedAcrossHosts` and passes `proveCrossHost()` — five interleavings
including the concurrent double-spend. `nonAtomicStore` is exported purely so a test can show the
proof saying no.

```bash
node scripts/prove-crosshost.mjs
```

What no test here can reach: whether *your* hosts share *one* database.

## Writing your own

Three methods and the metadata block. Two of the three guarantees fail silently when missing, so run
the suite rather than reading a checklist:

```ts
import { checkLedger, formatLedgerChecks } from "@agent-context-containment/ledger"
console.log(formatLedgerChecks(checkLedger(() => myRedisLedger())))
```
