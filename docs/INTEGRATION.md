# Integration

**Use `@agent-containment/ledger`. Use `@agent-containment/core` directly only if you know why.**

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
import { createGuard } from "@agent-containment/ledger";

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
memoryLedger()        // correct, obvious, lost on restart
jsonFileLedger({...}) // survives a restart. Single process only.
```

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
