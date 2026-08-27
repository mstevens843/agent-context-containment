# Security

## Reporting a vulnerability

Email **mathewstevens7457@gmail.com** with `[agent-context-containment]` in the subject. Please do not
open a public issue for anything that would let someone bypass the policy engine.

I will acknowledge within 72 hours. There is no bounty; this is a research project maintained by one
person.

## What counts as a vulnerability here

**In scope** — anything that makes the engine give a *wrong answer for a sound input*:

- a path where untrusted content reaches a steering role on an acting capability and is `ALLOW`ed
- a declassification rule that admits more than its stated codomain, or that can be made to admit a
  value it was not issued for
- a receipt usable outside its bound `(capability, role, argName)`, after expiry, or twice
- a taint join that loses a `derivedFrom` edge, so laundering through a hop clears the label
- a ledger adapter whose declared `guarantees` are false
- a corpus or manifest check that can be made to pass on drifted content

**Out of scope**, and each of these is a documented limitation rather than a bug:

- **A wrong capability declaration.** Containment enforces flow *given* the declaration. Declare an
  exfiltration tool as `read_only_tool` and it will be permitted — that is measured at **21 of 30**
  direct-harm and **32 of 32** data-stealing on the imported split (`pnpm report:mapping`) and is the
  first thing to audit in a deployment.
- **A caller not threading `Tainted` through.** The taint is cooperative, not enforced. There is no
  membrane in JavaScript: `unsafeUnwrap` exists, `map(f)` hands `f` the raw value, and anywhere the
  wrapper is not carried there is no taint at all. Coercing a `Tainted`, or calling `toString()` on one,
  throws rather than silently stringifying, which catches the common accidental paths but not
  `Object.prototype.toString.call`; and none of it makes the label survive the coercion.
- **Reaching past the guard.** `advanced.decide` is exported and is a deliberate bypass of the
  ledger and clock. It is namespaced so that using it is visible in a diff, not prevented.
- **Model behaviour.** Nothing here constrains what a model says or plans. It constrains what a tool
  call is permitted to do with a value.
- **An attacker who controls a `SYSTEM` or `USER` source.** That is outside the threat model in
  `docs/THREAT_MODEL.md` — if configuration is attacker-controlled, provenance means nothing.

## What this project does not defend against

See `docs/LIMITATIONS.md` for the full table, maintained per row. The short list: no sandboxing, no
model alignment, no defence against a compromised host, and no cross-host replay protection unless you
deploy a ledger that has passed `proveCrossHost()`.

## Cryptography

**There is none, deliberately.** The pure core has no imports at all — a contract test fails the build
if it grows one, and that includes `crypto`, `TextEncoder` and `Buffer`. Attestation verification is a
port: the host supplies `verify(attestation) => boolean`, and whatever it returns, the library
believes. That trust boundary is stated rather than hidden, and a host that returns `true`
unconditionally has disabled the rule.

## Supply chain

The published packages have **zero runtime dependencies**. `@agent-context-containment/core` imports nothing;
the others import only each other. The Postgres ledger adapter takes a query function rather than a
driver, so adding cross-host durability does not add a native module to the path of a policy decision.
