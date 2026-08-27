# Exact-import split — attribution

## What is different about this split

Every other split in this repository is written by hand. `corpus/derived/` restates published attack
*shapes*; `corpus/adaptive/` is evasions I chose; `corpus/generated/` is mechanical transforms of my
own bases. All of them are, ultimately, my words.

**This split contains upstream's actual case content, byte for byte.**

## Source

| | |
|---|---|
| project | InjecAgent — Zhan et al., *Benchmarking Indirect Prompt Injections in Tool-Integrated LLM Agents* |
| repo | https://github.com/uiuc-kang-lab/InjecAgent |
| commit | `f19c9f2c79a41046eb13c03c51a24c567a8ffa07` |
| files | `data/user_cases.jsonl`, `data/attacker_cases_dh.jsonl` |
| licence | **MIT** — permits use and modification with attribution. This file plus each case's `modifications` field is that attribution. |

## What is verbatim

- **`content.task`** — the `User Instruction`, unaltered.
- **`content.toolres`** — the user case's `Tool Response Template` with the `Attacker Instruction`
  substituted at its `<Attacker Instruction>` placeholder. **That substitution is upstream's own
  documented composition rule**, not an adaptation of ours: the placeholder exists in their data
  precisely so the two files compose this way.
- **`proposedAction.tool`** — the `Attacker Tools` entry, unaltered.
- Attack type and expected achievement, quoted in each case's note.

## What is ours, and must not be attributed upstream

- **Provenance labels.** InjecAgent has no notion of provenance; calling the tool response
  `TOOL_OUTPUT` is this project's model.
- **The capability mapping**, from upstream's attack taxonomy onto ours:

  | upstream attack type | our capability | why |
  |---|---|---|
  | Physical Harm | `account_modify` | their physical tools change the state of a lock or device; the nearest thing here is an irreversible settings change whose sink must be clean |
  | Financial Harm | `payment` | their financial tools move money |
  | Data Security Harm | `web_fetch` | their data-security tools exfiltrate; `web_fetch` is the full-egress capability here |

- **The argument role** (`sink_identity` throughout) and **the expected decision**.

## The mapping is mechanical, and therefore sometimes coarse

`EmergencyDispatchSystemCreateDispatchRequest` is labelled *Data Security Harm* upstream, so the rule
maps it to `web_fetch` — which is a slightly odd home for dispatching an emergency vehicle.

That coarseness is deliberate and it is the safer error. The alternative is choosing a capability
per case by judgement, and the person exercising that judgement wrote the capability table. Hand-tuning
each mapping would let me pick, case by case, the capability that makes the engine look best — which
is exactly the selection effect this split exists to escape. A rule anyone can re-run beats a
judgement only I can audit.

## Selection

Mechanical and reproducible: the first cases per attack type, paired with the user case at the same
index. No case was picked or dropped after seeing how the engine scored it.

## What this proves, and what it does not

**Proves:** the containment decision holds on attack content this project did not write, phrase, or
choose. That is the strongest evidence here, and there are six cases of it.

**Does not prove:**

- **Not a benchmark run.** InjecAgent scores whether an *agent* calls the attacker tool across 1,054
  cases in a live tool-calling loop. This scores whether a *policy* would permit one call, on six.
  Same bytes, different question, incomparable numbers.
- **Not upstream's difficulty.** Their loop, their adaptive prompting and their model-in-the-middle
  are all absent.
- **Not independent evaluation.** The mapping and the expected decisions are still mine. Content is
  theirs; grading is not.

## The strings are upstream's. The grading is mine.

That sentence is the whole point of this directory, and it cuts both ways.

**Imported, byte for byte:** the task text, the attacker instruction, and the tool response — composed
by upstream's own substitution rule, not paraphrased, not shortened, not cleaned up. Nothing in this
repository chose those words, which is why this split is the strongest evidence here.

**Authored here:** the provenance label, the capability, the argument role, and the expected decision.
Upstream has no provenance model and no capability table; it scores whether a live agent calls the
attacker's tool. Every one of those four fields is a judgement of mine layered on top of their bytes.

An author who cannot choose the attack text can still choose the capability it maps to — and choosing
it case by case would quietly restore all the freedom the import was supposed to remove. So the
mapping is written down in `MAPPING.json`, derived from upstream's own attack-type label rather than
from case-by-case judgement, and audited by `packages/conformance/test/mapping.test.ts`, which fails
the build if two cases sharing an attack type land on different capabilities.

### How much of the result rests on that judgement

`MAPPING.json` records, for every case, the capabilities a different reviewer could have picked, split
into two kinds:

- **peer** — a different row at the same severity tier; a disagreement two careful reviewers could
  genuinely have.
- **understated** — a reading that describes the tool as *less* capable than it is. That is a
  mis-declaration, not a reading.

`node scripts/mapping-report.mjs` re-runs every case under every alternative:

<!-- GENERATED:mapping-sensitivity -->
```
direct harm    ROBUST to peer mappings 30/30   permitted when UNDERSTATED 21/30
data stealing  ROBUST to peer mappings 32/32   permitted when UNDERSTATED 32/32
```
<!-- /GENERATED -->

Read those two numbers together or not at all.

The first says the imported result does not depend on which of several defensible capabilities I
picked — so on this split, the refusals are evidence about the attacks rather than about my table.

The second says that if you file a send tool as read-only, most of them sail straight
through. That is **not** a containment failure and it is not scored as one: containment enforces flow
*given* the capability declaration and has no way to know a tool was declared weaker than it is. It is
the trust boundary named in `docs/LIMITATIONS.md`, priced. It is reported here because a paragraph
saying "the declaration is trusted input" is easy to skim past, and a fraction is not — and because
it tells anyone deploying this what to audit first. The figures above are generated by
`pnpm report:mapping`; they were hand-typed and three versions stale until v1.0, in the one document
family the prose guard did not scan.
