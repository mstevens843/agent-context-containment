// Tests for the lexical retriever.
//
// The ranking is not the contribution here - carrying provenance through retrieval is - so the
// tests that matter are the provenance one and the honest recall measurement.

import { sourceId } from "@agent-containment/core";
import { describe, expect, it } from "vitest";
import { buildIndex, recallAt, tokenize } from "../src/index.js";

const chunks = [
  {
    id: sourceId("c1"),
    provenance: "RETRIEVED" as const,
    text: "Refunds are processed within 5 business days.",
  },
  {
    id: sourceId("c2"),
    provenance: "RETRIEVED" as const,
    text: "Shipping is free on orders above $50.",
  },
  {
    id: sourceId("c3"),
    provenance: "WEB" as const,
    text: "Returns require an RMA number from support.",
  },
  {
    id: sourceId("c4"),
    provenance: "SYSTEM" as const,
    text: "Internal: the refund clearing account is 0001.",
  },
];

describe("retrieval", () => {
  it("carries provenance through ranking - the reason this package exists", () => {
    const hits = buildIndex(chunks).search("refund", 4);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      const original = chunks.find((c) => c.id === h.chunk.id);
      expect(h.chunk.provenance).toBe(original?.provenance);
    }
  });

  it("ranks deterministically, so downstream evals are reproducible", () => {
    const index = buildIndex(chunks);
    expect(index.search("refund", 3).map((h) => h.chunk.id)).toEqual(
      index.search("refund", 3).map((h) => h.chunk.id),
    );
  });

  it("strips one plural s, and does not pretend to be a stemmer", () => {
    expect(tokenize("refunds")).toEqual(["refund"]);
    expect(tokenize("running")).toEqual(["running"]); // NOT "run"
    expect(tokenize("policies")).toEqual(["policie"]); // NOT "policy" - a real miss
  });

  it("measures recall rather than asserting quality", () => {
    const index = buildIndex(chunks);
    const r = recallAt(
      index,
      [
        { query: "refund processing time", relevant: [sourceId("c1")] },
        { query: "shipping cost", relevant: [sourceId("c2")] },
        { query: "return authorisation", relevant: [sourceId("c3")] },
      ],
      2,
    );
    // Quoted with its denominator. Three queries over four chunks is a smoke test, not an
    // evaluation, and the number should never be repeated without that sentence attached.
    expect(r.total).toBe(3);
    expect(r.recall).toBeGreaterThan(0.5);
  });

  it("returns nothing rather than noise when no term matches", () => {
    expect(buildIndex(chunks).search("quantum chromodynamics", 5)).toEqual([]);
  });
});
