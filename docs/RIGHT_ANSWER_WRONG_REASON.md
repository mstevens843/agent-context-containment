# Right answer for the wrong reason

A refusal that lands on the correct verdict through faulty reasoning is a **failure**, and this
repository grades it as one.

That is unusual, so it needs an argument.

## The failure it prevents

Consider an exfiltration case: a fetched page supplies the URL for a `web_fetch`. Two engines refuse
it.

- Engine A refuses because `web_fetch` has **full egress** and its destination came from `WEB`.
- Engine B refuses because it rates capabilities on **effect** alone, has miscategorised `web_fetch`
  as irreversible, and refuses everything irreversible.

Both print `DENY`. A grader that compares verdicts passes both. But engine B does not model egress at
all, so on the next case - a `read_only_tool` whose arguments leak, or a `web_fetch` it has
categorised correctly as harmless - it waves the attack straight through. The passing grade was
noise. It told you nothing about whether the engine understands the thing it is being tested on.

This is not hypothetical. It is what mutant `M1 effect_only` is, and on a verdict-only grader it
scores respectably.

## How it is enforced

Every corpus case that expects a refusal names the reason codes that must appear:

```json
"expected": {
  "containment": "DENY",
  "requiredReasons": ["taint_exceeds_ceiling", "egress_with_tainted_input"],
  "rationale": "web_fetch has no side effect and total egress; the URL host came from the page"
}
```

The runner checks `required.every(r => response.reasons.includes(r))`. Extra reasons are fine -
reasons are additive and more precision is never penalised. Missing ones are not.

Two structural supports:

- `checkCorpus` emits `REFUSAL_WITHOUT_REQUIRED_REASONS` if a refusing case names no reasons, so a
  case cannot silently opt out of being graded on mechanism.
- The reporter counts wrong-reason refusals separately and prints them as a warning block rather than
  folding them into the blocked total.

## It caught the engine in this repository, on the first run

Six holdout cases named `taint_exceeds_ceiling`. The engine emitted only the more specific
`egress_with_tainted_input`, having **substituted** the specific mechanism for the general fact
rather than reporting both:

```ts
// before - one reason, chosen by a ternary
reason(egress ? "egress_with_tainted_input" : "taint_exceeds_ceiling", ...)
```

Every one of those six refusals was correct. A verdict-only grader passes all six. What it hid was a
real defect in the audit trail: a downstream consumer filtering on `taint_exceeds_ceiling` - a
dashboard, an alerting rule, a compliance query - would have seen nothing for six genuine ceiling
breaches. The fix was to emit both, general fact first.

## And it caught a hole in the corpus

The same mechanism cuts the other way, which is the part worth trusting.

Holdout case `tool-h-002` argues at length that a model summary of a hostile page must inherit its
taint, and it is the only holdout case aimed at laundering. It does not discriminate. `payment`'s
`sink_identity` ceiling is `USER_CONTROLLED`, so an engine that treats model output as clean rates
the value `TOOL_DERIVED`, which still exceeds the ceiling, and refuses **for a reason the case did
not name**.

So mutant `M4 model_launders` is invisible to the entire frozen holdout. The case looked like
coverage and was not.

**The holdout was not edited.** Instead:

- `packages/conformance/test/holdout.test.ts` asserts the blind set is exactly `["M4 model_launders"]`.
  If someone later fixes the gap, that test fails and forces them to update the record deliberately.
- A discriminating case (`tool-t-001`) went into the tuning corpus, sitting exactly on the
  `read_only_tool` boundary where the `derivedFrom` edge changes the answer, with `tool-t-002` as its
  clean-ancestry control.
- The gap is stated in the README, in `EVALS.md`, and in `LIMITATIONS.md`.

Recording a coverage gap you cannot currently close is worth more than quietly closing it by
loosening the thing that revealed it.

## Where this comes from

A previous project of mine - a Terminal-Bench task on durable side effects - shipped with a clean
245/245 solve. Reading the solving engine's source afterwards showed it carried the exact bug the
hidden coverage existed to detect. The coverage graded outcomes, the engine produced the right
outcomes, and the mechanism underneath was wrong. That solve was retracted in writing.

`requiredReasons` is that lesson, moved one project earlier: grade the mechanism, not the verdict,
because an engine that is right by accident is an engine that will be wrong on the case you did not
write.
