# Argument identity

**A receipt binds to a SLOT, not to a label.**

## The defect this exists because of

A receipt was bound by `(capability, role, argName)`, and that was believed to name exactly one
argument. It does not — labels repeat:

```
web_fetch with two parameters both called "url"
one allowlist receipt admitting https://ok.example
  -> ALLOW    reasons: declassified, declassified    spends: [r, r]
```

**One human approval of one URL admitted a second, arbitrary one.** The reason codes said
`declassified` twice, which reads like two admissions. The ledger spent the id once, because spending
is idempotent by design. Nothing anywhere looked wrong. See `docs/DEFECTS_FOUND.md` §11.

## Slots

Every argument of an action gets a unique identity, computed from the whole argument list:

| rule | result |
|---|---|
| an explicit `path` | that path — the caller knows their own schema |
| a name occurring **once** | the name. No ceremony for the common case |
| a repeated name | `name[i]`, positionally |
| two arguments with the same explicit `path` | suffixed so slots stay unique; a caller bug, handled safely |

```ts
slotsOf([{ name: "to" }, { name: "body" }])                    // ["to", "body"]
slotsOf([{ name: "url" }, { name: "url" }])                    // ["url[0]", "url[1]"]
slotsOf([{ name: "to", path: "message.to" }, { name: "to", path: "message.replyTo" }])
                                                               // ["message.to", "message.replyTo"]
```

## How a receipt matches

```ts
admitUserConfirmedValue({
  candidate: "ops@corp.example",
  presented: "Send to ops@corp.example?",
  capability: "email_send",
  role: "sink_identity",
  argName: "to",
  argPath: "message.to",      // supply this whenever a label can repeat
  lifts: "UNTRUSTED_EXTERNAL",
  scope,
})
```

- **With `argPath`:** it must equal the argument's slot exactly. A receipt for `recipients[0]` has
  nothing to say about `recipients[1]`.
- **Without it:** it matches by label — and **only where that label identifies one argument.**

**Where the label repeats, a label-only receipt matches nothing.** Not the first, not the last.
Neither. Its issuer could not have expressed which one they meant, and guessing is precisely what
admitted an argument nobody approved. The engine says so rather than failing silently:

```
receipt r-3 names the label "url", which identifies more than one argument of this action;
a receipt must name a slot (argPath) to admit one of them
```

## What else is keyed by slot

Everything that was keyed by label, because the confusion was not confined to `coverFor`:

| what | was | is |
|---|---|---|
| receipt matching | `argName` | slot |
| `admittedByReceipt` — what the tuple gate reads | a set of names | a set of slots |
| `tupleKey` — which combination a tuple receipt ratifies | `"url+url"` | `"url[0]+url[1]"` |
| `admitConfirmedTuple`'s key | joined names | joined `argPath ?? argName` |

The tuple key is built in two files and they must agree exactly, or a correctly-ratified pair is
refused and nobody can work out why. `argidentity.test.ts` asserts both.

## What this is not

**Not a fix that forbids duplicate labels.** That would have been cheaper and would have broken every
tool with an array parameter. Corpus case `slot-t-002` is the paired control: two arguments called
`url`, each with its own slot and its own receipt, **allowed**.

**Not a defence against a caller who lies about paths.** Two arguments given the same explicit `path`
are a caller bug. `slotsOf` keeps the slots unique so nothing is admitted by accident, and neither is
matchable by label — the failure is safe, and the engine still cannot see that the caller was wrong.

**Not the only thing protecting a receipt.** `ActionArg.value` is a second, independent binding: when
the caller supplies a value, the receipt must admit that exact value. The original defect needed
`value` to be omitted — which is the ordinary shape, since it is optional and most callers do not
thread concrete values into a policy decision. Two defences, one of them broken, and the broken one
was the one that mattered.

## Migration

Nothing breaks. A single argument called `to` has slot `to`, a receipt naming `to` matches it, and no
existing call changes behaviour. `argPath` is needed only where a label can repeat — arrays, repeated
parameters, and nested objects that flatten to the same leaf name.
