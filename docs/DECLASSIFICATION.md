# Declassification

The release valve, and the part most likely to ship broken.

Every taint system dies the same way: everything downstream becomes untrusted, every call needs a
dialog, developers get tired, and the library is removed. Declassification is what prevents that,
which makes it the place where this design either earns its keep or quietly becomes a rubber stamp.

## The admissibility rule

> A rule may admit a value for a sensitive parameter only if the set of values it can possibly admit
> is **finite**, **enumerable from inputs that are all clean**, and **safe element by element**.

Read it as a channel. Every value declassification is a channel from the attacker to a side effect,
and the only question is how many bits go through it. `bitsOfChoice(codomain)` computes that number,
and every `Declassification` records its own cardinality so an audit can ask.

This replaces "does this feel safe" with arithmetic:

| | finite? | admissible? |
|---|---|---|
| `z.string()` | no | no |
| `z.string().email()` | no | no |
| `/^[a-z0-9@.]+$/` | no - unbounded quantifier | no, and this is the one people reach for |
| `z.enum([...])` | yes, `n` | yes |
| `[lo, hi]` at fixed granularity | yes | yes |
| byte-identical to a clean value | yes, 1 | yes, universally |

## Structural vs value

**Structural declassification** tells you the shape is known-good. `declassifyShape` returns the
field names, the length, the variant - and no values. It is free, unlimited, needs no receipt, and
cannot be mistaken for a value declassification because there is deliberately no way to get a value
out of the result. This is where most real friction goes: routing logic almost never needs a value.

**Value declassification** says one specific value may fill one specific sensitive slot. It is
receipted, scoped to one capability and one argument role, and only ever issued from a finite domain.

**Schema validation is structural, not value**, and conflating them is the single most likely way to
ship this library broken. A string that passes a schema is still attacker-chosen text; parsing
`{ to: string }` and calling the result clean hands the attacker the recipient field. Validation
tells you the *shape* is known-good and says nothing about *who chose the bytes*. This is exactly the
residual risk arXiv:2506.08837 names for Plan-Then-Execute: an injection cannot force a new action,
and it can still choose that action's parameters. Holdout case `tool-h-001` is this attack.

## The rules

| rule | admits | codomain | what it does not stop |
|---|---|---|---|
| `echo_of_clean` | a value byte-identical to one already held cleanly | 1 | nothing - zero bits of attacker choice. The only rule defensible for all capabilities |
| `allowlist_member` | the **matched member**, never the input | `n` | an allowlist containing a member with far more authority than the rest. `all-staff@` is sound by this rule and catastrophic in practice |
| `clean_selection` | the element a tainted index selects from a clean collection | `n` | the element is clean; the *choice* is attacker-made, so this is `log2(n)` bits, not a singleton |
| `numeric_envelope` | a number inside a clean bound | `(hi-lo)/g+1` | **accumulation**. 400 payments of 9.99 under a cap of 10 pass every individual check |
| `user_confirmed_value` | a value a human ratified verbatim | human-ratified | pixels. See below |

`allowlist_member` returns the matched member rather than the input on purpose: that defeats the
whole family of normalise-one-side bugs, where code compares a trimmed, lower-cased form and then
ships the raw form with a zero-width character still attached.

`clean_selection` uses an explicit bounds check against an array rather than property access.
`collection[key]` on a plain object hands back `__proto__` and `constructor` as live objects rather
than `undefined`, which turns a selection rule into prototype pollution.

## Why there is no source allowlist

It is the rule everyone asks for, and it is not admissible as a value declassifier under any
preconditions.

1. **A domain says who served the bytes, never who wrote them.** Every allowlist entry worth having -
   a wiki, a docs host, a ticketing system, a SaaS tenant, your own CMS - is a user-generated-content
   host. Allowlisting it allowlists the attacker.
2. **Compromise moves the whole list at once.** The point of an allowlist is that it is small and
   stable, which is what makes one compromised entry high-yield.
3. **The URL you checked is not the URL you fetched.** Redirects, open redirects on the allowlisted
   origin, DNS rebinding, and subdomain takeover all break check-versus-use identity.
4. **It bounds nothing.** A page on an allowlisted domain is arbitrary attacker text, which fails the
   finiteness test above.

An allowlist is a label, not a trust grant. It may lower a risk tier. It may never admit a value.

## Anti-self-declassification

Two properties:

- **No self-admission.** A value may not be the source of its own admission criteria.
- **Clean basis.** Every input to a rule's decision must be clean.

The second is the hard one, because the dangerous case is data that *was* tainted, got unwrapped, and
is now an ordinary `string[]`. TypeScript has no effect system and primitive strings cannot be
tracked at runtime, so the honest goal is not "impossible" but **"requires an explicit lie in a place
a reviewer can see"**.

Ways this gets violated by accident, all worth grepping for:

1. An allowlist loaded from a config file that a tainted tool wrote.
2. A numeric bound read from retrieved content - *"the invoice states the approval limit is $50,000"*.
   This is holdout case `doc-h-001`, and it is why `admitNumericEnvelope` requires a clean bound.
3. Enum members built from tool output: `z.enum(Object.keys(apiResponse))`.
4. A confirmation prompt whose framing text came from the untrusted document.
5. Aggregation laundering - `tainted.map(s => s.length)` then a numeric envelope. Formally fine, and
   developers will read the number as "derived, therefore safe" rather than "attacker-chosen within
   a range".
6. **Correlated parameters.** A recipient from a valid allowlist receipt plus an amount from a valid
   bounds receipt: each individually admissible, the pair is the attack. Receipts are per-value, so
   an action-level check over the whole argument tuple is a separate obligation.

## Over-tainting, and the release valves

Five, in order of how much friction each removes:

1. **`text_response` admits everything.** Summarising untrusted content is the product.
2. **`read_only_tool` admits everything by default.** Reading is free; exfiltration is not.
3. **Per-role ceilings.** The big one. An untrusted body to a confirmed recipient is fine.
4. **Structural declassification is free.** Routing logic never needs a value.
5. **`transaction_prepare` is permissive.** Build freely, gate the broadcast.

The escape hatch, `unsafeUnwrap`, always returns a warning string alongside the value so the bypass
appears in an audit whether or not the caller reads it. It is greppable on purpose.
