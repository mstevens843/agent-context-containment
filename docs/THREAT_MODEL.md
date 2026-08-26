# Threat model

## The attacker

Anyone who can get bytes into the agent's context without being the principal. That is a much larger
set than it first appears:

- **Anyone who can send an email.** No relationship with the user required.
- **Anyone who can publish a web page** the agent might fetch.
- **Anyone who can get one document into a RAG corpus** - a shared drive, a wiki, a support ticket,
  an uploaded PDF.
- **Anyone who can mint a token** or list an entry in a third-party registry. Token metadata is
  attacker-authored by construction, and it is the channel people most reliably forget.
- **Any third-party API** whose response fields the agent reads.

We assume the attacker knows the system prompt, the tool list, and this library's source. We assume
they can write fluent, plausible, well-formatted business prose - not the crude "IGNORE PREVIOUS
INSTRUCTIONS" that shows up in demos. That assumption is the one that matters, because it is what
makes text detection insufficient.

This is not hypothetical. Production prompt-injection CVEs in 2025-26 include Microsoft Copilot
(CVSS 9.3), GitHub Copilot (9.6) and Cursor (9.8).

## What is in scope

An untrusted source influencing **which capability is invoked, or with what arguments**. Concretely:

- a fetched page choosing the destination of an egress call
- an inbound email choosing the recipient of an outbound one
- a retrieved chunk choosing a payment destination
- token metadata choosing a broadcast target
- a tool response supplying a value that fills a sensitive argument
- data leaving via a URL, a memo, or a mail body

## What is explicitly out of scope

- **Truth.** An injected chunk that makes the answer wrong crosses no capability boundary. The corpus
  counts these (`containmentLimit`) rather than hiding them.
- **A compromised tool.** If an MCP server returns a value labelled `SYSTEM`, we believe it. Labels
  are asserted by the integration layer and trusted.
- **A compromised system prompt.** It is the trust root. If it is attacker-controlled, nothing here
  helps.
- **The principal.** A user who genuinely authorises a bad transfer is not an injection.
- **Implicit flows.** Branching on a tainted boolean leaks a bit per branch and is unbounded over a
  loop. Tracking it would make the system unusable and would still not work. Accepted, permanently.
- **Side channels** - timing, resource exhaustion, ordering.
- **Confidentiality of what is read.** An untrusted-directed read pulls data into context, and that
  is not gated. The exfiltration is gated instead, which is the point of containment rather than
  detection: reading is free, sending is not.

## The trust boundary

```
  SYSTEM ─────────────────┐
  USER ───────────────────┤
                          ├──> the agent ──> decide() ──> a capability
  WEB / EMAIL / DOCUMENT ─┤                     ^
  RETRIEVED / EXTERNAL ───┤                     │
  TOOL_OUTPUT ────────────┘          reads only: which source,
                                     which capability, which role.
                                     Never the bytes.
```

`decide()` is the boundary. Everything above it may be arbitrarily hostile. The security property is
not that hostile content is detected - it is that hostile content cannot reach an argument whose role
and capability it is not permitted to reach.

## Assumptions the ratings depend on

Each of these makes a row in `CAPABILITY_POLICY` true, and breaks it if false:

- **`text_response` has no egress.** True only if the rendering surface does not auto-fetch. A
  markdown client that resolves remote image URLs has turned `text_response` into `web_fetch`, and
  that row is then wrong.
- **`file_write` has no egress.** True only if the write root is not synced. A write into a web root
  or a shared folder is full egress with extra steps.
- **`transaction_prepare` has no effect.** True only if preparation does not itself authorise
  anything, and only if the prepared artifact carries the taint of its inputs forward to the
  broadcast. Otherwise the two rows compose into a laundering pipeline.
