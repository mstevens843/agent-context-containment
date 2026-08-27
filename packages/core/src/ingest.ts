// Declaring where content came from, with fewer ways to get it wrong.
//
// WHAT THIS IS NOT, first, because the name invites the wrong reading. Nothing here INFERS anything.
// It does not sniff a string and decide it looks like an email; it does not read a URL and conclude
// the bytes are untrusted. **You declare the provenance. This makes the declaration harder to
// mistype and impossible to leave dangling** - and if you declare a web page as SYSTEM, every ceiling
// in the table is calibrated for a lie and the engine will permit accordingly.
//
// That distinction is the whole trust boundary. See docs/TRUST_BOUNDARIES.md.
//
// WHAT IT ACTUALLY BUYS. Three failures that a hand-written `{ id, provenance }` literal makes easy
// and this makes impossible:
//
//   1. A DANGLING EDGE. `derivedFrom: [sourceId("summary")]` where no source is called "summary".
//      The engine treats an unresolvable edge as contributing nothing, so the value silently reads as
//      CLEAN - a laundering path that looks like a typo. `checkCorpus` catches this in the corpus and
//      nothing caught it at run time.
//   2. A DUPLICATE ID. Two sources with the same id: the second is shadowed, and an argument derived
//      from it inherits the wrong label. Silent in both directions.
//   3. A MISTYPED PROVENANCE. `"WEBPAGE"` instead of `"WEB"` is a type error at compile time and a
//      runtime string from a config file. The named constructors give one spelling.
//
// The whole module is pure, allocates nothing the caller cannot see, and never throws except on the
// three structural mistakes above - which are caller bugs at wiring time, not decisions.

import { type Provenance, type Source, type SourceId, sourceId } from "./types.js";

/**
 * One piece of content, with where it came from and what it was derived from.
 *
 * `content` is carried for the caller's own use - a reviewer needs the bytes, an audit log wants
 * them. The ENGINE never sees it: `decide()` takes `Source`, which is `{ id, provenance,
 * derivedFrom }` and no text at all. That asymmetry is deliberate and is what makes the decision
 * independent of how innocent or alarming the content reads.
 */
export interface Ingested {
  readonly id: string;
  readonly provenance: Provenance;
  readonly content: string;
  readonly derivedFrom: readonly string[];
}

const make =
  (provenance: Provenance) =>
  (id: string, content: string, derivedFrom: readonly string[] = []): Ingested => ({
    id,
    provenance,
    content,
    derivedFrom,
  });

/** The developer's own prompt, config and code. The only genuinely trusted origin. */
export const fromSystem = make("SYSTEM");
/** Typed by the human principal this session. Trusted to express intent, not to be safe. */
export const fromUser = make("USER");
/** A chunk returned by retrieval. Whoever wrote the corpus chose these bytes. */
export const fromRetrieval = make("RETRIEVED");
/** Fetched from a web page. Fully attacker-controlled in the general case. */
export const fromWeb = make("WEB");
/** The body, subject or headers of an email. Anyone can send the user one. */
export const fromEmail = make("EMAIL");
/** Extracted from an uploaded PDF, spreadsheet or document. */
export const fromDocument = make("DOCUMENT");
/** A third-party API response. The channel people most reliably forget. */
export const fromExternalApi = make("EXTERNAL_API");
/** The return value of one of our own tools. Trusted structurally, not in its free-text fields. */
export const fromToolOutput = make("TOOL_OUTPUT");

/**
 * Something one of our own tools produced FROM other content.
 *
 * The single most useful constructor here, and the one whose absence causes the most damage. A
 * summary of a hostile page is our own model's output and is still hostile: the `derivedFrom` edge is
 * what carries that forward, and a caller who writes `fromToolOutput("summary", text)` with no edge
 * has laundered the page in one line.
 */
export const derivedOutput = (
  id: string,
  content: string,
  from: readonly string[],
  provenance: Provenance = "TOOL_OUTPUT",
): Ingested => ({ id, provenance, content, derivedFrom: from });

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestError";
  }
}

/**
 * Turn declared content into what the engine takes, refusing the three structural mistakes.
 *
 * Throws rather than returns, and only here. This runs at WIRING time - assembling the context before
 * a decision - where the only thing a caller could do with a caught error is proceed with a context
 * they know is malformed. Compare `decide()`, which never throws for any input - asserted by
 * `packages/core/test/total.test.ts` - because a policy decision with a caller's try/catch around it
 * has a bypass in the catch block.
 */
export function contextOf(items: readonly Ingested[]): {
  readonly sources: readonly Source[];
  readonly content: Readonly<Record<string, string>>;
} {
  const seen = new Set<string>();
  for (const i of items) {
    if (i.id.trim() === "") throw new IngestError("a source has an empty id");
    if (seen.has(i.id)) {
      throw new IngestError(
        `two sources are called "${i.id}"; the second shadows the first, and any argument derived from it inherits the wrong provenance`,
      );
    }
    seen.add(i.id);
  }
  for (const i of items) {
    for (const from of i.derivedFrom) {
      if (!seen.has(from)) {
        throw new IngestError(
          `"${i.id}" is derived from "${from}", which is not declared. An unresolvable edge contributes nothing, so the value would read as CLEAN - a laundering path that looks like a typo`,
        );
      }
    }
  }
  return {
    sources: items.map((i) => ({
      id: sourceId(i.id),
      provenance: i.provenance,
      ...(i.derivedFrom.length > 0
        ? { derivedFrom: i.derivedFrom.map((f) => sourceId(f)) as readonly SourceId[] }
        : {}),
    })),
    content: Object.fromEntries(items.map((i) => [i.id, i.content])),
  };
}

/**
 * How much of a context was declared through these helpers rather than by hand.
 *
 * Reported rather than enforced. A hand-built `Source` is legitimate - a replay harness, a test, an
 * adapter over somebody else's context object - and forbidding it would be theatre. What is worth
 * knowing is the PROPORTION, because a codebase where most provenance is hand-typed has more places
 * for a dangling edge to hide, and this is the number that says so.
 */
export const ingestionCoverage = (
  declaredHere: number,
  total: number,
): { readonly declared: number; readonly total: number; readonly note: string } => ({
  declared: declaredHere,
  total,
  note:
    declaredHere === total
      ? "every source in this context was declared through the ingestion helpers"
      : `${total - declaredHere} source(s) were built by hand; each is a place a dangling or duplicate edge can hide`,
});
