# @agent-containment/retrieval

BM25 over chunks that **carry their provenance**, because retrieval is the canonical indirect-injection
path: content the user never saw, selected by relevance to the user's own question, spliced into a
prompt.

```ts
import { index, search } from "@agent-containment/retrieval"
```

Every chunk keeps its source id, so a value derived from a retrieved chunk arrives at `decide()`
labelled — which is the only reason the RAG demos can refuse a poisoned chunk while still answering
from it.

**It is lexical and it is not a stemmer.** It strips one plural `s` and nothing else; `policies` does
not match `policy`. That is stated rather than discovered, because its job is carrying provenance
through retrieval, not ranking. If you need real retrieval quality, use a real retriever and keep the
provenance edge.
