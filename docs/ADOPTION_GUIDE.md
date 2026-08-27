# Adoption guide

For someone wiring this into a real agent. Read `docs/TRUST_BOUNDARIES.md` first — the whole thing
rests on declarations you supply, and it is better to know that before you write them than after.

## 1. Work out what your agent can actually do

Not what it *should* do. List every tool it can call and answer two questions per tool:

- **Can it change something?** none / reversible / irreversible
- **Can data leave through it?** none / metadata / full

Those are independent, and treating them as one scale is the commonest modelling error.
`web_fetch` changes **nothing** and leaks **everything**; `account_modify` is irreversible and leaks
almost nothing. A single "how dangerous is this tool" score gets the first one wrong, which is the
most common real exfiltration path.

Then bind each tool to a capability row:

```ts
const TOOLS = [
  { name: "gmail.readMessage", capability: "read_only_tool", params: { messageId: "selector" } },
  { name: "gmail.sendMessage", capability: "email_send",
    params: { to: "sink_identity", subject: "payload", body: "payload" } },
  { name: "fs.writeFile", capability: "file_write",
    params: { path: "sink_identity", content: "payload" } },
]
```

**The roles are the part that makes this usable.** `payload` is content the action carries;
`sink_identity` is *where the action goes*. Untrusted text in an email body is the product; untrusted
text choosing the recipient is the attack. Getting a destination filed as `payload` is the cheapest
possible way to disable containment for a tool — and `pnpm verify:manifests` flags it as an advisory,
by name.

## 2. Declare where content came from

Use the ingestion helpers. They do not infer anything — you are still declaring — but they make three
mistakes impossible that a hand-written literal makes easy:

```ts
import { contextOf, fromUser, fromEmail, derivedOutput } from "@agent-context-containment/core"

const { sources, content } = contextOf([
  fromUser("task", "Reply to the Northwind invoice mail."),
  fromEmail("inbox", rawMessage),
  derivedOutput("summary", modelSummary, ["inbox"]),   // <- the edge is the point
])
```

`contextOf` throws on a **dangling edge**, a **duplicate id**, and an **empty id**. The first is the
dangerous one: an unresolvable edge contributes nothing, so the value reads as `CLEAN` — a laundering
path that looks like a typo.

**`derivedOutput` is the constructor whose absence causes the most damage.** A summary of a hostile
page is your own model's output and is still hostile. Write `fromToolOutput("summary", text)` with no
edge and you have laundered the page in one line.

## 3. Decide through the guard, not the engine

```ts
import { createGuard, lockingFileLedger, nodeLockingFs } from "@agent-context-containment/ledger"

const guard = createGuard({
  clock: Date.now,
  ledger: lockingFileLedger({ path: "./receipts.json", fs: nodeLockingFs(fs), now: Date.now }),
  requireGuarantees: { singleHost: true, crashSafe: true },   // startup failure, not a silent one
})

const verdict = guard.decide({ action, sources })
```

`advanced.decide` exists for three things — writing a checker, replaying an audit log, and testing —
and is namespaced so that reaching for it shows up in a diff.

**Pick the ledger for your topology, and say so in code:**

| deployment | ledger | `requireGuarantees` |
|---|---|---|
| one process, tests | `memoryLedger` | — |
| one process, survives restart | `jsonFileLedger` | `crashSafe` |
| several processes, one machine | `lockingFileLedger` | `singleHost, crashSafe` |
| several machines | `durableLedger` + `postgresAsyncLedger` | `crossHostSafe` |

`requireGuarantees` turns a mismatch into a **boot failure**. Without it, code tested on one process
is deployed onto three pods and nothing notices: `isSpent` starts answering `false` for receipts
another pod already spent, and replay protection is gone with no error and no log line.

## 4. Handle each of the four answers

| verdict | what it means | what to do |
|---|---|---|
| `ALLOW` | within every ceiling | run the tool |
| `NEEDS_REVIEW` | a human must decide | show them the **exact value**, mint a receipt, retry |
| `NEEDS_DECLASSIFICATION` | a rule could admit it | obtain a receipt, or refuse |
| `DENY` | the row has no route out | do not retry — nothing will change the answer |

`NEEDS_DECLASSIFICATION` and `DENY` are genuinely different and the distinction is load-bearing: the
first says *get an approval*, the second says *this row will never take that value*.

## 5. Mint receipts from a real approval

```ts
const receipt = admitUserConfirmedValue({
  candidate: "billing@vendor.example",
  presented: "Send your reply to billing@vendor.example?",   // what the human actually saw
  capability: "email_send", role: "sink_identity", argName: "to",
  argPath: "message.to",     // supply whenever a label can repeat — arrays, nested objects
  lifts: "UNTRUSTED_EXTERNAL",
  scope: { nonce, issuedAt: Date.now(), expiresAt, source: sourceId("inbox") },
})
```

The receipt admits **one value, into one slot, once.** `presented` must contain the candidate
verbatim, because a dialog that named one value and quietly carried another is the confirmation-UI
attack with extra steps. See `docs/ARGUMENT_IDENTITY.md` for why `argPath` matters.

**Paired arguments need a third receipt.** An allowlisted destination plus an in-policy amount are two
correct answers to two questions nobody asked together, and where a tuple policy names the pair the
engine will say so.

## 6. Check your own configuration before shipping

```bash
pnpm verify:manifests     # your capability tables: contradictions, then naming advisories
```

**Contradictions must be zero.** Advisories are advisory — read them, decide, and note the decision.
A clean advisory run means nothing was named oddly, which is a fact about vocabulary rather than
behaviour: a tool called `fetchStatus` that quietly POSTs your inbox produces no finding and never
will.

## 7. Run the checks that apply to you

```bash
pnpm verify:corpus        # the frozen holdout has not drifted
pnpm import:check         # imported cases still rebuild from upstream bytes
pnpm verify:freeze        # exits 1, permanently and by design — see below
pnpm lint && pnpm typecheck && pnpm build && pnpm test
pnpm audit:release        # and the question the gate does not ask: could these tests fail?
```

**`pnpm verify:freeze` exiting 1 is the correct outcome and always will be.** A freeze was attempted
and correctly rejected; no holdout-only pre-engine commit exists in this history. The claim is
*unavailable*, not pending. If it ever passes, something is wrong.

If you have a database:

```bash
DATABASE_URL=postgres://… pnpm prove:postgres   # 11 scenarios, independent connections
```

Without it, that block reports **SKIPPED / NOT PROVEN** — which is not a pass, and is never printed
as one.

## 8. Deployment notes worth reading twice

**`staleAfterMs` has no free value.** A crash between reserve and consume leaves a receipt nobody will
finish. Too long and it is stranded until it expires; too short and a slow-but-alive caller loses a
reservation it was about to consume — **and that direction is a double-spend.** `stats(now)` counts
`reserved`, `consumed` and `stranded` so the choice has visible consequences rather than invisible
ones. `staleAfterMs: null` is strictly safer and makes every crash permanent for the receipts it held.

**Audit the high-blast-radius rows first.** Which tools are bound to `payment`, `email_send`,
`wallet_sign`, `transaction_broadcast` — irreversible with full egress. That binding is the
highest-leverage thing in a deployment and `verify:manifests` lists them for you.

**Diff your manifest in code review.** A one-word ceiling edit is the smallest change that fully
disables containment for a capability, and it looks like nothing in a pull request. `diffPolicies`
lists loosenings first and separately.

## 9. What to tell your team

- It contains **what a tool call may do with a value**. It is not a sandbox, not a model-alignment
  method, and not a prompt-injection silver bullet.
- It works from **declarations you write**. Wrong declarations are a config and supply-chain risk, and
  the cost is measured: `pnpm report:mapping`.
- The numbers in `README.md` come from `pnpm report`. Run it against your own corpus; five profiles
  and 98 cases is a starting point, not a recommendation for your deployment.
