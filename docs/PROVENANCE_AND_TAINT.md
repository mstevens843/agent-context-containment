# Provenance and taint

## Two labels, not one

The brief for this library asked for a flat six-member taint enum: `clean`, `user-controlled`,
`untrusted-external`, `tool-derived`, `mixed`, `declassified`. It became a four-member lattice, a
provenance set, and two derived states, and the reason is worth stating because it is the central
modelling decision.

**`Taint` is a total order**: `CLEAN < USER_CONTROLLED < TOOL_DERIVED < UNTRUSTED_EXTERNAL`. The join
is `max`, `CLEAN` is the identity, and the empty set of inputs is `CLEAN`.

**`Provenance` is a set** of which origins contributed: `SYSTEM`, `USER`, `RETRIEVED`, `WEB`,
`EMAIL`, `DOCUMENT`, `EXTERNAL_API`, `TOOL_OUTPUT`.

**`MIXED` cannot be a lattice member.** If it were, `join(USER_CONTROLLED, WEB)` would have to be
both `UNTRUSTED_EXTERNAL` (the correct ceiling) and `MIXED` (the correct composition fact), and one
value cannot be both. So mixing is a *predicate over the set*, evaluated at a different gate. The
join answers "how dangerous"; the set answers "which", and a policy that wants to review anything
combining trusted and untrusted input needs the second, because the join has thrown it away.

**`DECLASSIFIED` cannot be a lattice member either.** As a member it would be the top of the order
(anything can become it) and the bottom by permission (it can go anywhere), which is not a lattice,
it is a hole in one. It is a *result* carrying a receipt - which rule admitted it, over which value,
for which capability.

## The provenance-to-taint table

| provenance | taint | why |
|---|---|---|
| `SYSTEM` | `CLEAN` | the operator's own prompt and config. The trust root |
| `USER` | `USER_CONTROLLED` | the principal. Trusted to authorise, not trusted to be correct |
| `TOOL_OUTPUT` | `TOOL_DERIVED` | our tool's structure, someone else's free-text fields |
| `RETRIEVED`, `WEB`, `EMAIL`, `DOCUMENT`, `EXTERNAL_API` | `UNTRUSTED_EXTERNAL` | attacker-authorable |

Five origins collapse to one level, and that is a projection rather than a loss: the level is what the
ceiling check needs, and the tag is kept because attribution in a refusal should say "the recipient
came from an email", not "the recipient was level 3".

The distinction that earns its keep is `TOOL_OUTPUT` against `EXTERNAL_API`. **A tool call is not a
trust boundary; the operator of the thing on the other end is.** Collapsing them is the most common
modelling error in hand-rolled versions of this, and it is what makes "the agent called a tool, so
the result is trusted" feel reasonable.

## Inheritance

`Source.derivedFrom` makes model output inherit the join of everything it was shown. A summary of a
hostile page is `UNTRUSTED_EXTERNAL`, not `TOOL_DERIVED`. A summary of the system policy stays clean.
This is an obligation on the integration layer that the library cannot enforce - see LIMITATIONS.md -
and getting it wrong defeats containment end to end.

The walk carries a seen-set and treats a cycle as the top of the lattice. Failing closed on a
malformed graph is cheaper than trusting the caller not to build one.

## Mixing is per-argument, not per-action

This one is worth stating loudly because getting it wrong makes the library unusable, and the first
run of the conformance suite caught exactly that.

Every useful agent task combines user intent with untrusted content - that is what an agent *is*. An
action-level mixing test therefore fires on essentially everything, and a confirmation prompt that
fires on everything is not a control, it is a click-through.

The dangerous composition is narrower: **one argument** assembled from both a trusted and an
untrusted source. "Summarise this thread and send it to alice@ourcorp.com" mixes at the action level
and at no argument - the recipient is purely the user's, the body purely the thread's - and it is the
ordinary use of an email assistant.

## The splice, and why it is scoped twice

"Mixed provenance" as a refusal condition is intuitive and wrong twice over. Both narrowings were
forced by cases that the broader version got wrong.

**Not per action.** Every useful agent task combines user intent with untrusted content - that is
what an agent *is*. An action-level test fires on essentially everything, and a prompt that fires on
everything is a click-through rather than a control. Holdout `email-h-002` is the case that killed
this version: "summarise this thread and send it to alice@ourcorp.com" mixes at the action level and
at no argument, since the recipient is purely the user's and the body purely the thread's.

**Only for steering roles.** A spliced *payload* is the normal case - "save this summary", where the
content is part the user's words and part a fetched page - and escalating it is the second way the
rule over-blocks. What matters is a splice in an argument that decides **where** the action goes or
**how much** it moves: `sink_identity`, `magnitude`, `control`.

So the splice check asks: *is there one argument, in a steering role, assembled from more than one
trust class?*

### It fires, and it is inert as a gate — two different claims

An earlier version of this document said the check "currently cannot fire, and that is proven rather
than assumed". **That was wrong**, and the correction is recorded in `DEFECTS_FOUND.md` §6 because a
repository arguing for honest reporting does not get to leave a false claim in its own docs.

The splice check **does** fire. A `read_only_tool` call whose `sink_identity` is assembled from a
`TOOL_OUTPUT` source and a `SYSTEM` source yields `reasons: [mixed_provenance, within_taint_ceiling]`
— tuning case `tool-t-002` is exactly this shape. `read_only_tool` has `effect: "none"` and admits
`TOOL_DERIVED` in a sink, so the splice is well within its ceiling and is reported.

What it cannot currently do is change the **decision**. The escalation is gated on
`row.effect === "irreversible"`, and `policy.test.ts` asserts every steering role on a capability
with a real effect sits at or below `USER_CONTROLLED` — so any splice that would reach the escalation
has already exceeded its ceiling and been refused. **The ceiling subsumes the splice as a gate; it
does not subsume it as a signal.**

Keep the two apart:

| | today |
|---|---|
| splice is detected and appears in `reasons` | **yes** |
| splice can change ALLOW into NEEDS_REVIEW | **no** — no acting capability admits a splice within ceiling |

The check stays because it guards a band that is currently empty. Loosen a steering ceiling on an
acting capability and the gate activates on its own, while the invariant test fails at the same
moment to say the band has opened. Deleting it would make that future loosening silent.

### The related fail-closed rule

`ceilingFor` returns the stricter of the row default and `USER_CONTROLLED` for any **unrated**
steering role. An omission tightens rather than loosens.

This was a live bug: `email_send` rated `sink_identity` and left `magnitude` unrated, so it inherited
the row's deliberately permissive `UNTRUSTED_EXTERNAL` default - right for a mail body, wrong for
anything steering the send. The invariant test caught it. The row now rates `magnitude` explicitly as
well, because a policy row should read correctly to someone who does not know the fallback exists;
the fallback is a backstop against omission, not a substitute for stating the policy.

Same posture as the sibling transaction scanner's per-program capability model: an undeclared
capability is not allowed, rather than allowed by default.

## The `Tainted<T>` wrapper

A closure-backed label that `map` preserves and `chain`/`zip` join. The value is captured in scope
rather than held as a property, so `JSON.stringify` of a `Tainted` yields the label and not the
payload - a real leak that a naive `{ value, label }` record has.

**Labels never carry attacker data.** `taint` is a lattice member, `provenance` is a set from a
closed enum. That invariant is why reading a label needs no receipt while reading a value does, and
it is why there is no `detail: string` field however much one would help debugging: a string there is
a covert channel out of the wrapper.

`unwrap` returns the *declassification's* admitted value, not the wrapped one. That single choice
makes check-versus-use divergence unrepresentable - the usual "verify a hash, then use what you were
holding" design lets code validate one string and send another.
