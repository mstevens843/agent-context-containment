# Playground

**Status: a CLI playground is implemented** at `examples/playground.ts`. A browser version is planned
and not built; the plan is at the bottom.

## Why a playground earns its place

The argument this project makes is counter-intuitive on first contact. "It refuses without reading
the text" sounds either like a trick or like a system that refuses everything. Reading
`CAPABILITY_POLICY` settles it, and almost nobody reads a policy table.

The playground settles it in about fifteen seconds: change the content, watch the decision not move.
That single interaction carries more than the README does, because the reader performs the experiment
instead of being told the result.

## The CLI

```bash
npx tsx examples/playground.ts --help
npx tsx examples/playground.ts --capability payment --role sink_identity --provenance WEB \
  --content "Remit to account 7781-2210."
npx tsx examples/playground.ts --matrix --role sink_identity
```

**Single-decision mode** prints, for one `(capability, role, provenance)`:

- the content, **echoed and never read** — the label says so, and rewriting it proves it
- the taint derivation: provenance, its level, any `--derived-from` join, the effective level, and
  every contributing source
- the capability's row: effect, egress, the ceiling *for that role*, whether confirmation is required,
  and what could lift it — or `nothing - the ceiling is absolute`
- the decision, every reason code with its message, and the effects
- **a classifier verdict on the same bytes, for comparison** — which is where the point lands, because
  the two columns disagree in both directions

`--derived-from` models laundering in one flag: `--provenance TOOL_OUTPUT --derived-from WEB` shows a
summary of a hostile page inheriting `UNTRUSTED_EXTERNAL` rather than resting at `TOOL_DERIVED`.

`--confirmed` satisfies the confirmation gate, which is how `NEEDS_REVIEW` becomes `ALLOW`.

**Matrix mode** prints every capability against every provenance for one role. It is the fastest way
to see the shape of the policy, and it has already earned itself: reading the grid surfaced a real
problem no per-row invariant could see — `transaction_prepare` refusing a steering argument outright,
recorded as defect #7 in `DEFECTS_FOUND.md`. A test asserts properties of rows one at a time; a grid
shows how two rules compose.

## What the CLI deliberately does not do

- **No agent, no model, no network.** It exercises `decide()` and nothing else. A playground that
  called a model would be demonstrating the model.
- **No mutation of policy.** You cannot loosen a ceiling from the command line. Editing the table is
  a code change, reviewable in a diff, which is the entire point of having one table.

## Planned: a browser version

Not built. Sketch, so the shape is legible:

- **Panes.** Left: paste content, choose provenance from the eight, optionally add an upstream source
  to model laundering. Middle: choose capability and argument role. Right: the decision.
- **The taint chain as a diagram** rather than as lines of text — sources as nodes, `derivedFrom`
  edges between them, the join annotated, and the ceiling drawn as a line the bar either crosses or
  does not.
- **Two columns, always.** Containment's verdict beside the classifier's on the same bytes, because
  the disagreement in *both* directions is the finding, not just the misses.
- **Preset scenarios** loaded straight from `corpus/`, so the demo and the eval cannot drift apart.
- Static and dependency-free: the engine is pure, synchronous and zero-dependency, so it runs in a
  page with no server at all.

**Cost, honestly:** the interesting half is the taint diagram, and that is real front-end work rather
than an afternoon. The CLI already carries the argument, so this is a presentation upgrade, not a
capability one. It ranks below closing the receipt-replay gap and below getting a third party to
review the corpus.
