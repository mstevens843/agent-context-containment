// A lexical retriever, in about a hundred lines and zero dependencies.
//
// IT IS LEXICAL, AND IT IS CALLED LEXICAL EVERYWHERE. BM25 over tokenised terms. No embeddings, no
// vector store, no semantic matching, and no claim to any. Importing a vector database to make this
// look more impressive would add a dependency, add nothing to the argument, and be the kind of
// overclaim the rest of this repository is written to avoid.
//
// WHY A RETRIEVER IS IN A CONTAINMENT LIBRARY AT ALL. Retrieval is the canonical injection vector -
// an attacker who can get one document into a corpus can put text into an agent's context on demand -
// and it is the case where per-chunk scanning most obviously fails, because retrieval reassembles
// meaning that no single chunk contains. So the point here is not the ranking. It is that EVERY
// CHUNK CARRIES ITS PROVENANCE THROUGH RETRIEVAL AND INTO THE POLICY CHECK. Rank the corpus, hand
// the winners to the model, and the label rides along; the policy then knows the answer was built
// from RETRIEVED bytes without anyone having to read them.
//
// `recallAt` is here so the retrieval quality claim is a measured number rather than an adjective.

import type { Provenance, SourceId } from "@agent-context-containment/core";

/** One indexed unit of text, carrying where it came from. */
export interface Chunk {
  readonly id: SourceId;
  readonly text: string;
  /** Rides through retrieval into the policy check. The reason this module exists. */
  readonly provenance: Provenance;
}

export interface Scored {
  readonly chunk: Chunk;
  readonly score: number;
}

/**
 * Lowercase, split on non-alphanumerics, drop empties, then strip one trailing plural `s`.
 *
 * The plural strip is the whole of the normalisation and it is stated rather than buried, because
 * without it `"refund"` does not match `"refunds"` and the retriever is visibly worse than it looks.
 * It is NOT a stemmer: `"running"` does not match `"run"`, `"policies"` does not match `"policy"`,
 * and `"bus"` becomes `"bu"`. Those are real misses. Porter stemming would fix them and would be a
 * dependency or a hundred more lines for a component whose ranking is not the contribution here -
 * carrying chunk provenance through retrieval is. Measured with `recallAt` rather than asserted.
 */
export const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));

/** Okapi BM25. `k1` and `b` at their conventional defaults. */
export interface Bm25Options {
  readonly k1?: number;
  readonly b?: number;
}

/**
 * Build an index over a corpus.
 *
 * Pure: the returned index holds no reference to anything mutable outside it, and `search` reads no
 * clock and no randomness, so the same query over the same corpus always ranks identically. A
 * retriever whose ranking drifts makes every downstream eval unreproducible.
 */
export function buildIndex(chunks: readonly Chunk[], options: Bm25Options = {}) {
  const k1 = options.k1 ?? 1.5;
  const b = options.b ?? 0.75;

  const docs = chunks.map((c) => ({ chunk: c, terms: tokenize(c.text) }));
  const n = docs.length;
  const avgLen = n === 0 ? 0 : docs.reduce((s, d) => s + d.terms.length, 0) / n;

  /** How many documents contain each term. */
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const t of new Set(d.terms)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const idf = (term: string): number => {
    const seen = df.get(term) ?? 0;
    // Standard BM25 idf with the +0.5 smoothing that keeps it positive for very common terms.
    return Math.log(1 + (n - seen + 0.5) / (seen + 0.5));
  };

  return {
    size: n,
    /** Rank the corpus against a query. Ties break by chunk id, so the order is total and stable. */
    search(query: string, topK = 5): Scored[] {
      const qTerms = tokenize(query);
      const scored = docs.map((d) => {
        const len = d.terms.length;
        let score = 0;
        for (const term of new Set(qTerms)) {
          let tf = 0;
          for (const t of d.terms) if (t === term) tf++;
          if (tf === 0) continue;
          const norm = tf * (k1 + 1);
          const denom = tf + k1 * (1 - b + (b * len) / (avgLen === 0 ? 1 : avgLen));
          score += idf(term) * (norm / denom);
        }
        return { chunk: d.chunk, score };
      });
      return scored
        .filter((s) => s.score > 0)
        .sort((a, b2) =>
          b2.score !== a.score
            ? b2.score - a.score
            : (a.chunk.id as string).localeCompare(b2.chunk.id as string),
        )
        .slice(0, topK);
    },
  };
}

/**
 * recall@k over a labelled query set.
 *
 * Present so "the retriever works" is a number rather than an adjective. It is a small number over
 * a small corpus and should be quoted as such.
 */
export function recallAt(
  index: ReturnType<typeof buildIndex>,
  queries: readonly { readonly query: string; readonly relevant: readonly SourceId[] }[],
  k: number,
): { readonly recall: number; readonly hits: number; readonly total: number } {
  let hits = 0;
  let total = 0;
  for (const q of queries) {
    const got = new Set(index.search(q.query, k).map((s) => s.chunk.id as string));
    for (const r of q.relevant) {
      total++;
      if (got.has(r as string)) hits++;
    }
  }
  return { recall: total === 0 ? 0 : hits / total, hits, total };
}
