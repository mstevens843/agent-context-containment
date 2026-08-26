# @agent-containment/conformance

The evaluation harness. Point it at **your** policy, not just this one.

```ts
import { runCorpus, loadSplit } from "@agent-containment/conformance"

const report = runCorpus({
  cases: loadSplit("./corpus/holdout", "holdout"),
  policy: { name: "mine", decide: (request) => ({ decision, reasons }) },
})
```

`ContainmentRequest` deliberately carries **no case id, no split, no attack class and no expected
outcome**. An implementation cannot look up the answer, because the answer is not in the room — a
structural property rather than a rule, and it exists because on the benchmark this project grew out
of, two of three discovered verifier bypasses were engines reading the ground truth they were graded
against.

## What it measures

| | |
|---|---|
| `run.ts` | per-case grading, including **reason-level** grading — a refusal whose reason the case did not name is a failure, not a pass |
| `mutants.ts` | 8 deliberately broken engines. They must **discriminate**, not blanket-fail |
| `compare.ts` | classifier baseline vs containment, per split, never pooled |
| `crosspolicy.ts` | five policy profiles × six splits. No cell is an average |
| `frontier.ts` | the safety/utility tradeoff, with escalation as its own column |
| `planner.ts` | 48 generated agent runs, six plan shapes × every acting capability |
| `mapping.ts` | how much of the imported result depends on the author's capability mapping |
| `generate.ts` | 648 mechanical laundering variants, and an exhaustive probe of all 400 policy cells |

## The rules it enforces on itself

- **Splits are never pooled.** They are not samples from one population: one was frozen before the
  engine existed, one after, one is freely editable by the person being graded.
- **No report may claim optimality** unless the arithmetic supports it. A test checks the rendered
  text line by line.
- **Model judgment never gates anything.** The optional judge is supplementary and no test reads its
  output.
