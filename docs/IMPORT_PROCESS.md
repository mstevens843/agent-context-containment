# Import process

How upstream material enters this corpus, what is automated, and what cannot be.

## Three grades of evidence, and why the distinction is enforced

| kind | what it means | where |
|---|---|---|
| `imported` | **upstream's bytes, reproduced without alteration.** Rebuilt from committed source rows by a script; a byte of drift fails the build | `corpus/imported/` (6) |
| `derived` | a **hand-written restatement** of a published attack *shape*. Upstream's idea, my words | `corpus/derived/` (8) |
| `cve_derived` | built from a published advisory | `corpus/derived/` (1) |
| `original` | mine | everywhere else (53) |

Until v0.7 the first two were **one variant**. An exact transcription and a hand-written restatement
both carried `kind: "derived"` — the strongest evidence in this repository and the second-strongest,
wearing the same label, with nothing but prose between them. `checkCorpus` now enforces the line in
both directions:

- a case in `corpus/imported/` that is not `kind: "imported"` → `IMPORT_KIND_MISMATCH`
- a `kind: "imported"` case anywhere else → `IMPORT_KIND_MISMATCH`
- an import that does not name its source fixture → `IMPORT_WITHOUT_FIXTURE`
- an import that does not say which fields are mine → `IMPORT_WITHOUT_GRADING_DISCLOSURE`
- a derived case without the `HAND-DERIVED` label → `DERIVED_WITHOUT_HAND_DERIVED_LABEL`

**The second rule is the one that matters.** An exact import filed as derived merely understates the
evidence. A hand-derived case filed as an import claims bytes it does not have, and that is the
direction that would mislead someone reading the numbers.

## What the importer does

```bash
node scripts/import-injecagent.mjs --check    # rebuild and compare, byte for byte  (CI runs this)
node scripts/import-injecagent.mjs --write    # regenerate corpus/imported/injecagent.json
pnpm import:check                             # the same --check
```

Source rows are committed at `corpus/imported/source/`, taken from InjecAgent (MIT) at commit
`f19c9f2c79a41046eb13c03c51a24c567a8ffa07`:

- `attacker_cases.jsonl` — 30 rows, upstream's `Attacker Instruction` / `Attack Type` / `Attacker Tools`
- `user_cases.jsonl` — 17 rows, upstream's `User Instruction` / `Tool Response Template`

Composition is **upstream's own documented rule**, four lines of code: substitute the
`Attacker Instruction` at the `<Attacker Instruction>` placeholder in the user case's
`Tool Response Template`. Nothing is trimmed, re-quoted, escaped or tidied — the single-quoted
Python-dict look of those strings is upstream's and is preserved exactly, and a test asserts every
tool response still starts `{'`. *"We cleaned it up a bit"* is how an exact import stops being one.

Case selection is mechanical — first cases per attack type, paired by index — so it cannot have been
chosen to flatter the engine. The pins are checked, not trusted: if a fixture is ever replaced with a
different slice of upstream, the importer throws rather than silently importing different attacks
under the same case ids.

## What is NOT automated, and cannot be

**The grading.** Upstream has no provenance model, no capability table and no notion of a policy
decision — their harness scores whether a live agent *calls* the attacker's tool. Nothing in their
data could tell you which capability an attack maps to, which taint the carrying source has, or what
the right answer is. All of that is mine, and it lives in `corpus/imported/MAPPING.json`:

| field | whose |
|---|---|
| `content.task`, `content.toolres` | **upstream's**, byte for byte |
| `upstream.attackType`, `attackerTool`, `userTool` | **upstream's** metadata |
| `provenance`, `capability`, `role`, `argName` | **mine** |
| `expectedDecision`, `requiredReasons`, `rationale` | **mine** |
| `textualMarkers` | **mine**, and deliberately a human judgement — see below |

A test asserts the upstream fixture contains none of this vocabulary (`sink_identity`, `TOOL_OUTPUT`,
`account_modify`, `NEEDS_DECLASSIFICATION`), so the line between imported and authored cannot blur by
accident.

### Why `textualMarkers` is not computed

It would be easy to define "contains no injection wording" as "our classifier does not flag it". That
would be **circular**: the silent-attack row exists to measure how the classifier does on attacks with
nothing to detect, and defining the row by the classifier's own output makes it score 0/N by
construction. So it is authored, recorded in `MAPPING.json`, and open to disagreement.

## Why this is not a benchmark run

InjecAgent scores **1,054 cases in a live tool-calling loop**: does a real agent, driven by a real
model, call the attacker's tool? This corpus scores **6 cases as single policy decisions**: would a
policy permit one call?

Same bytes, different question. **The numbers are not comparable in either direction** and no ratio
between them means anything. What the import buys is narrow and real: on these six, the adversarial
input was not written by the person who wrote the defence.

## How much of the result is still mine

`pnpm report:mapping` re-runs every imported case under every capability another reviewer could have
defended:

```
ROBUST to peer mappings                   6/6
Permitted when the tool is UNDERSTATED    4/6
```

The first says the outcome does not depend on which of several defensible capabilities I picked. The
second says a wrong capability *declaration* voids it — out of contract, reported anyway. See
`corpus/imported/ATTRIBUTION.md` for the full argument.

## Adding another upstream source

1. Commit the raw rows under `corpus/<split>/source/`, with the upstream commit recorded.
2. Add a mapping file recording, per case, every field that is yours and why.
3. Write the composition as code, using upstream's own rule. If you find yourself editing a string by
   hand, it is `derived`, not `imported` — file it accordingly.
4. Add a `--check` mode and wire it into CI. An exact-import claim nobody can re-run is a promise.
