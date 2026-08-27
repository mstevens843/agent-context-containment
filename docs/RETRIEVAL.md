# Retrieval

## Why retrieval is the canonical injection path

Of the eight provenance classes, retrieval is the one that most deserves its own document, for four
reasons that compound.

**1. The attacker never has to reach the agent.** They write a document. Somebody else's indexer picks
it up. The content arrives in the agent's context later, on someone else's behalf, with no network
position and no relationship to the user. Compare a webpage, which the agent has to be pointed at, or
an email, which at least implies an address.

**2. Every corpus worth having is writable by more than one person.** A wiki, a shared drive, a
support desk, a ticket tracker, a docs site, a CRM a prospect types into, a Slack export. A corpus
only one person can write is a corpus that is out of date. This is the same argument that makes a
source allowlist inadmissible — see `DECLASSIFICATION.md` — arriving one layer earlier.

**3. Retrieval is targeted by construction.** The chunk that surfaces was chosen by similarity to the
user's question. An attacker who plants text near a question the user is going to ask has an
on-demand channel, not a lottery ticket. `examples/rag-pipeline.ts` shows the planted chunk
*outranking* the legitimate one, which is not a rigged demo — it ranks because it is more about
refunds than the real refund policy is.

**4. Meaning survives chunking, and scanners do not.** An instruction split across two chunks matches
nothing in either half. Retrieval reassembles it. A per-chunk scanner sees two innocuous fragments of
a policy document; the agent sees an instruction. Corpus case `rag-h-002` is exactly this, and the
demo prints both halves against the classifier to show neither fires.

## What the retrieval package is, and is not

`@agent-context-containment/retrieval` is BM25 over tokenised terms, about 150 lines, zero dependencies. It
strips one trailing plural `s` and that is the whole of its normalisation — it is **not a stemmer**,
`policies` does not match `policy`, and `running` does not match `run`. Those are real misses, stated
rather than hidden, and `recallAt` exists so the quality claim is a measured number over a named
query set instead of an adjective.

**The ranking is not the contribution.** The contribution is that a `Chunk` carries `provenance`, and
that label rides through indexing, ranking and selection into the policy check. The agent gets the
text; `decide()` gets the label. Nothing has to read the chunk to know it came from a corpus a
stranger can write to.

That is why a vector store was not imported. It would add a dependency, add nothing to the argument,
and invite a "semantic" claim the package cannot support.

## The demo

```bash
npx tsx examples/rag-pipeline.ts
```

Six sections, each pinning one behaviour:

1. **Retrieval.** Real BM25 ranking. The planted chunk wins.
2. **Benign context used safely.** An ordinary chunk answers an ordinary question.
3. **The planted chunk, two destinations.** Same bytes: `text_response` allowed, `payment` refused.
4. **Quoted attack text.** A security ticket discussing a payload string — the classifier fires,
   containment does not, and the summary is allowed. The over-blocking half of the failure mode.
5. **A tool call, argument by argument.** The same chunk into `email_send.body` (allowed) versus
   `email_send.to` (refused), `web_fetch.url`, `payment.amount`.
6. **The split-chunk case.** Both halves printed against the classifier; neither fires.

## What this does not address

Retrieval **ingestion** is where real deployments fail, and it is not modelled here. Every case in
this corpus arrives with its `Provenance` already correct. Deriving that label at ingestion — through
an HTML parser, a PDF extractor, a connector envelope, a summariser — is the hard part, and a perfect
score here is entirely consistent with a system that is trivially broken in production because its
labels are wrong. See `LIMITATIONS.md`.
