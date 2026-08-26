# Prior art

**The core idea in this repository is not novel.** Capability-based containment for prompt injection
is established research with a clear lineage, and this document exists so that is the first thing a
reader learns rather than something they discover later and hold against the project.

## The lineage

**Dual LLM pattern** - Simon Willison. A privileged LLM orchestrates and holds the tools; a
quarantined LLM processes untrusted text with no tool access and returns symbolic variables. The
ancestor of everything below.

**CaMeL** - [arXiv:2503.18813](https://arxiv.org/abs/2503.18813), Debenedetti, Carlini, Tramer et al.,
Google DeepMind. The direct intellectual parent. Extracts control and data flow from the trusted
query, then runs the plan in a custom sandboxed Python interpreter that propagates capability tags
through every operation, so *"the untrusted data retrieved by the LLM can never impact the program
flow"*. Reports **77% of AgentDojo tasks solved with provable security, against 84% undefended** -
note that they publish the utility cost.

**Design Patterns for Securing LLM Agents against Prompt Injections** -
[arXiv:2506.08837](https://arxiv.org/abs/2506.08837). Six patterns: Action-Selector,
Plan-Then-Execute, LLM Map-Reduce, Dual LLM, Code-Then-Execute, Context-Minimization. Two findings
this library is built on: once an agent ingests untrusted input it must be *"impossible for that
input to trigger any consequential actions"*; and general-purpose agents cannot obtain meaningful
guarantees, so application-specific constraints are essential. It also names the residual risk this
library's declassification design is organised around - control-flow protection stops injections
forcing *new actions* while leaving them able to modify *action parameters*.

**Prompt Flow Integrity** - [arXiv:2503.15547](https://arxiv.org/abs/2503.15547). DataGuard and
CtrlGuard, information-flow guardrails against privilege escalation. Adjacent.

**AgentArmor** - [arXiv:2508.01249](https://arxiv.org/abs/2508.01249). Program analysis over agent
runtime traces. Adjacent.

## Where this sits

| | CaMeL | Reversec code samples | this |
|---|---|---|---|
| Language | Python | Python | TypeScript |
| Propagation | sandboxed interpreter, automatic | per-pattern demo | cooperative wrapper + boundary check |
| Soundness | provable for its threat model | illustrative | **not sound** - see LIMITATIONS.md |
| Form | research code | Chainlit demo scripts, *"not production-ready"* per their README | library + corpus + eval harness |

The gap is the last row. There is no reusable TypeScript implementation of capability containment,
and the existing reference implementations say themselves that they are teaching aids. That is the
whole contribution: **an implementation, an attack corpus, and a harness**, not an insight.

Our primitives map onto the six patterns as a substrate rather than a rival: the capability table is
Action-Selector's allowed-set made explicit; the `transaction_prepare` / `transaction_broadcast`
split is Plan-Then-Execute at the level of one action; and per-role ceilings are what let a Dual-LLM
arrangement pass untrusted text into a body while refusing it a recipient.

## Adjacent npm packages

**`@kernel.chat/agent-os`** (Apache-2.0, `0.2.0-alpha`) - *"POSIX for AI agents: permissions,
namespaces, resource quotas, content-addressed audit, downscoped handoff"*, with an `/acap`
capability export. The closest neighbour on npm. Different altitude - it is an OS-level substrate,
not an injection defence - but it is real, it overlaps, and omitting it would suggest we had not
looked.

Detection-based TypeScript agent-security tools exist and are not competitors so much as the thing
this positions against: they are the classifier family, and the argument in the README is about that
family's failure mode rather than about any product in it.

## Benchmarks

**AgentDojo** (97 tasks, 629 security cases, MIT), **InjecAgent** (1,054 cases, MIT), **BIPIA** (250
attacker objectives, NOASSERTION - excluded on licensing).

Our corpus is not one of these and does not claim to be. AgentDojo and InjecAgent are the standard
instruments, they are dynamic and adversarial in ways a static hand-written corpus is not, and this
repo's derived subset is intended to make the corpus less self-selected rather than to replace them.

## On adaptive attacks

**Adaptive Attacks Break Defenses Against Indirect Prompt Injection**
([arXiv:2503.00061](https://arxiv.org/abs/2503.00061)) breaks detection-based, input-level and
model-level defences under adaptation - which is the classifier family.

Do not over-read this. It is **not** evidence that containment is safe from adaptive attackers. It
says the broken defences are in a different class from structural ones. An adaptive attacker against
*this* library would not try to evade a pattern; they would look for a capability whose ceiling is
too permissive, an allowlist member with more authority than the rest, or an integration that labels
model output as clean. Those attacks are wide open and untested here.

## On this repository's own vocabulary

`chat_text_alone` in the author's `agentPlans.ts` is an existing name for "tainted" and this library
supersedes it deliberately. ConfigPilot's `verbatim | parsed | missing | inferred` ladder is the
direct ancestor of the taint lattice - `INFERRED` there is structurally unproducible by the
deterministic pipeline, which already makes it a taint bit. The four-way decision descends from
Agentic's two-tier `pass | block | needs_input` gate and `approve | deny | needs_input` validator,
not from ConfigPilot's terminal `Verdict`.
