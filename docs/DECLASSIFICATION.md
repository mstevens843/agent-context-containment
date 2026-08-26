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
| `attested_tool_output` | a value something holding a key vouched for | singleton | **content safety.** See below |

`allowlist_member` returns the matched member rather than the input on purpose: that defeats the
whole family of normalise-one-side bugs, where code compares a trimmed, lower-cased form and then
ships the raw form with a zero-width character still attached.

`clean_selection` uses an explicit bounds check against an array rather than property access.
`collection[key]` on a plain object hands back `__proto__` and `constructor` as live objects rather
than `undefined`, which turns a selection rule into prototype pollution.

## Attested tool output, and why it is narrowed

`admitAttestedToolOutput` admits a value because something holding a key vouched for it. Three checks,
in order: the host's verifier accepts the attestation, `attestation.subject` equals the candidate
byte-for-byte, and `attestation.purpose` covers the exact `(capability, role)` being requested.

**This package does no cryptography.** The verifier is supplied by the host:

```ts
export type AttestationVerifier = (attestation: Attestation) => boolean;
```

Whatever it returns, the library believes. A host returning `true` unconditionally has disabled the
rule; a host deriving its answer from tainted data three frames up has handed the attacker a key. The
trust boundary is stated rather than hidden. Real signature checking belongs in a sibling package
that is allowed dependencies and `async` — the pure core is neither, and a hand-rolled hash would be
unaudited *and* would reintroduce the check-versus-use gap that carrying the value closes.

**The narrowing is the design.** A signature attests **origin, not content safety**. A correctly
signed response from your own indexer still contains whatever the attacker wrote on the page it
indexed. Accepting that from a key while this document refuses it from a domain would be incoherent —
so the rule **refuses to issue for any capability whose effect is not `none`, or whose egress is
`full`.** It can feed a read-only answer. It cannot choose a recipient, an amount or a destination,
however good the signature is, and that is enforced in the rule rather than left to whoever writes
the policy row.

Corpus cases `att-t-001` and `att-t-002` are the pair: identical key, valid signature, correct subject
binding, correct purpose — admitted into a `read_only_tool` selector, refused for `email_send`. In the
second the rule declines to mint at all, so the receipt never exists.

**It is a singleton, and not the kind `echo_of_clean` is.** Same cardinality, different provenance of
the choice: there the value was one we already held cleanly, so the attacker chose nothing; here the
*attester* chose it, and an attester's honesty is an assumption rather than a property. The capability
narrowing has to carry the safety instead of the cardinality.

## Receipts, end to end

A receipt is bound to **one value, one capability, one argument role, and one argument by name**, at
issuance. `Declassification` carries `argName` for that reason, which also makes it structurally a
`ReceiptEvidence` and lets a rule's output go straight to `decide()` with no adapter.

Four properties, each pinned by a tuning case:

| | case |
|---|---|
| without a receipt, an untrusted value needs declassification | `rcpt-t-001` |
| with an exact user-confirmed receipt, it is admitted | `rcpt-t-002` |
| a receipt for one argument does not admit another | `rcpt-t-003` |
| a receipt does not widen into a trust grant for its source | `rcpt-t-004` |

`rcpt-t-003` is the anti-bearer-token case: two arguments, same capability, same role, same untrusted
source, differing only in name. `rcpt-t-004` is the one that stops a receipt degenerating into the
source allowlist this document refuses to implement — confirming one value from an email grants
nothing to the account number in the same email.

Mutant `M7 receipt_bearer_token` drops `argName` from the matching predicate and is bitten by
`rcpt-t-003`. Without it the machinery would ship ungraded.

### Replay, expiry and binding — closed in v0.3

A receipt was previously a claim about a **slot**: capability, role, argument name. Three things it
was not, all now closed:

| | before | now |
|---|---|---|
| value binding | a receipt for one address admitted any address in that slot | `receipt.admitted` is compared to `arg.value` -> `receipt_value_mismatch` |
| source binding | the same address arriving from a different email was admitted | `scope.source` must have fed the argument -> `receipt_source_mismatch` |
| single use | one confirmation authorised a retry loop | the ledger is checked -> `receipt_already_consumed` |
| expiry | none | `scope.expiresAt` against a caller-supplied `now` -> `receipt_expired` |

**Every one of those inputs is caller-supplied**, because the core reads no clock and generates no
randomness — the purity contract bans `Date.now` and `Math.random`, and a nonce from a deterministic
counter is not a nonce. The ledger is threaded through the call signature rather than hidden in a
module so that forgetting it is visible at the call site. A caller who passes none gets no expiry
checking and unlimited reuse; that is a documented choice, pinned by a test, not an accident.

`Verdict.spends` names the receipts a decision consumed. The shell must mark them spent **atomically
with performing the action**, or the ledger lies and the next replay succeeds. Nothing is spent on a
refusal — burning evidence that did no work is how a single-use confirmation gets exhausted ten
minutes before the action that needed it.

**Rejection ordering matters.** Replay is checked first, because it is the only rejection whose reason
is evidence of an adversary rather than of a bug. A receipt can fail several checks at once and the
log keeps whichever fired first: check the capability first and a replayed receipt with the wrong
capability is logged as a mismatch, and the attack signal is gone.

## Correlated parameters

Receipts are per value, and so was every check in this library until v0.3. That leaves a gap the
individual checks cannot see:

> A recipient drawn from a valid payee allowlist, plus an amount inside a valid policy envelope, is a
> correctly-formed transfer to the wrong person. Both receipts are sound. Neither asked *"should THIS
> amount go to THIS recipient?"*, which is the only question a transfer poses.

`admitConfirmedTuple` ratifies a **combination** as one decision. It binds to a canonical key —
entries sorted by argument name — so a reordered pair matches and a substituted member does not.

**The gate is deliberately narrow.** A row declares `tupleRoles`, and the check fires only when two or
more of those roles were **declassified separately** — not merely present. Arguments already within
their ceilings raise no tuple question, because nothing had to be admitted. Without that scoping this
becomes a rules engine that fires on ordinary traffic and gets switched off, which protects nobody.

**What it does not solve.** It checks the combinations the table names and nothing else — currently
`payment` and `transaction_broadcast`, both on `(sink_identity, magnitude)`. Enumerating every
dangerous pair of every capability is the sprawling rules engine this design refuses to become, and
every unlisted pair is unchecked. `examples/wallet-tuple.ts` walks the money case end to end.

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
