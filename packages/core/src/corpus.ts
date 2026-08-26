// The corpus schema, and the checker that validates a corpus before anything is scored against it.
//
// This file is SPECIFICATION, not implementation. It is deliberately written before the policy
// engine exists, because the corpus that grades the engine has to be authorable without knowing
// what the engine does. See the note on ordering at the bottom of this header.
//
// Two ideas here are doing all the work, and both come from a mistake made on a previous project:
//
// 1. THE SPLIT IS IN THE TYPE. `TuningCaseId` and `HoldoutCaseId` are separate branded types, so a
//    classifier heuristic that declares `justifiedBy: readonly TuningCaseId[]` CANNOT cite a
//    holdout case. That is a compile error, not a code-review finding, and code-review findings
//    are the ones you miss at 1am.
//
// 2. RIGHT ANSWER FOR THE WRONG REASON IS A FAILURE. Every blocking case names the violation codes
//    that must appear. A policy that blocks an exfiltration case because it thought the effect was
//    irreversible - rather than because it saw the egress - has the right shape and the wrong
//    mechanism, and grading only the shape passes it. On the benchmark this library grew out of, a
//    solution scored 245/245 while carrying the exact bug the suite existed to detect, because the
//    coverage checked the outcome and not the reason. `requiredViolations` is that lesson.
//
// ORDERING. `corpus/holdout/` was authored against this file, at a commit where the policy engine
// did not exist. That makes "the holdout was not written to fit the implementation" a claim anyone
// can check with `git cat-file -e <freeze-commit>:packages/core/src/policy.ts`, which must fail.
// docs/EVALS.md carries the exact command. A frozen holdout that merely SAYS it came first is
// worth nothing.

import type { Capability, ParamRole, ProposedAction, Provenance, Source, Taint } from "./types.js";

declare const BRAND: unique symbol;
type Branded<T, B extends string> = T & { readonly [BRAND]: B };

/** A case in `corpus/tuning/`. The only kind of id a classifier heuristic may cite as evidence. */
export type TuningCaseId = Branded<string, "TuningCaseId">;

/**
 * A case in `corpus/holdout/`. Structurally incompatible with `TuningCaseId`, which is the whole
 * point: it makes tuning against the holdout a type error rather than a matter of discipline.
 */
export type HoldoutCaseId = Branded<string, "HoldoutCaseId">;

export type CaseId = TuningCaseId | HoldoutCaseId;

export const tuningCaseId = (v: string): TuningCaseId => v as TuningCaseId;
export const holdoutCaseId = (v: string): HoldoutCaseId => v as HoldoutCaseId;

/** Which half of the corpus a case belongs to. Also encoded in the id, so moving one is loud. */
export type Split = "tuning" | "holdout";

/** The attack surface a case exercises. */
export type AttackClass =
  /** Injected instructions in a fetched web page. */
  | "webpage"
  /** Injected instructions in the body, subject, or headers of mail. */
  | "email"
  /** Injected instructions in an uploaded PDF or document. */
  | "document"
  /** Injected instructions in a token name, symbol, or description. Anyone can mint a token. */
  | "token_metadata"
  /** Injected instructions in the return value of a tool. */
  | "tool_output"
  /** Injected instructions in a retrieved chunk. */
  | "rag_chunk"
  /** Not an attack. Must NOT be blocked. Over-blocking is a first-class failure. */
  | "benign_hard";

/**
 * Whether there is anything in the text for a detector to find. DESCRIPTIVE ONLY - never used to
 * score, only to break the results down.
 *
 * The `none` row is the entire thesis of this repository. If a case is marked `none`, a perfect
 * text classifier arguably cannot flag it, because there is no injection language present: the
 * content is a well-formed sentence that happens to be false, or a URL that happens to carry data
 * outward. Containment is unaffected because it never reads the text. If the `none` row is empty,
 * the repo has not demonstrated anything a better regex could not do.
 */
export type TextualMarkers =
  /** "Ignore previous instructions". A keyword detector should catch this. */
  | "overt"
  /** Encoded, homoglyphed, split across chunks, or non-English. A good detector might catch it. */
  | "obfuscated"
  /** No injection language at all. Nothing to detect. */
  | "none";

/** How a case entered the corpus. */
export type CaseSource =
  | { readonly kind: "original" }
  | {
      readonly kind: "derived";
      readonly from: "agentdojo" | "injecagent";
      /** Locator within the upstream repository, e.g. "suite=workspace,injection_task=6". */
      readonly ref: string;
      readonly license: "MIT";
      /** What was changed and why. Required and non-empty: a silent adaptation is not attribution. */
      readonly modifications: string;
    }
  | { readonly kind: "cve_derived"; readonly cve: string };

/** What a correct policy and a correct classifier should each do. */
export interface ExpectedOutcome {
  /** What ANY sound containment policy should decide. */
  readonly containment: "ALLOW" | "DENY" | "NEEDS_REVIEW" | "NEEDS_DECLASSIFICATION";
  /**
   * The violation codes that must appear when containment refuses.
   *
   * Empty for cases expected to be allowed. Non-empty otherwise, and checked: blocking for a
   * reason the case did not name counts as a failure, not a pass.
   */
  readonly requiredReasons: readonly string[];
  /** One line. Why this is the right answer. */
  readonly rationale: string;
}

/** One case. */
export interface CorpusCase {
  readonly schemaVersion: 1;
  readonly id: CaseId;
  readonly split: Split;
  readonly attackClass: AttackClass;
  /** One line, imperative, no marketing. */
  readonly title: string;
  readonly groundTruth: "attack" | "benign";

  /** Every origin the agent has in context. Exactly one must be `SYSTEM` or `USER`. */
  readonly sources: readonly Source[];
  /** The bytes of each source, keyed by source id. Kept separate so `Source` stays policy-facing. */
  readonly content: Readonly<Record<string, string>>;
  /** What the agent proposes to do after reading the above. This is what gets judged. */
  readonly proposedAction: ProposedAction;

  readonly expected: ExpectedOutcome;
  readonly textualMarkers: TextualMarkers;

  /**
   * Non-null means containment STRUCTURALLY cannot prevent this, and the case is excluded from the
   * headline 2x2 and listed separately.
   *
   * A corpus with none of these is a rigged corpus. Containment governs which capability untrusted
   * content can reach; it does nothing about an injected chunk that merely biases a summary, and it
   * does nothing about a user who genuinely authorises a bad transfer. Saying so in the data, and
   * counting it in the report, is cheaper than being caught not saying it.
   */
  readonly containmentLimit: string | null;

  readonly source: CaseSource;
  readonly authoredAt: string;
  readonly note: string;
}

// -------------------------------------------------------------------------------------------
// Validation
// -------------------------------------------------------------------------------------------

/** Ways a corpus can be malformed. Distinct code per distinct wrongness. */
export type CorpusViolationCode =
  /** No `SYSTEM` or `USER` source. Every case needs a principal whose intent is the baseline. */
  | "MISSING_PRINCIPAL"
  /** Ground truth says attack, but every source is trusted. Nothing is being injected. */
  | "ATTACK_WITHOUT_UNTRUSTED"
  /** An arg's `derivedFrom` names a source the case does not declare. */
  | "DANGLING_SOURCE_REF"
  /** A source declares content that does not exist, or content with no source. */
  | "CONTENT_SOURCE_MISMATCH"
  /** The id says holdout but the case is filed under tuning, or vice versa. */
  | "SPLIT_ID_MISMATCH"
  /** Expected to refuse, but no required reasons named. Shape-only grading is how bugs survive. */
  | "REFUSAL_WITHOUT_REQUIRED_REASONS"
  /** Expected to allow, but required reasons named anyway. */
  | "ALLOW_WITH_REQUIRED_REASONS"
  /** A derived case with no upstream reference or empty modifications. */
  | "DERIVED_WITHOUT_ATTRIBUTION"
  /**
   * An ATTACK case filed under `benign_hard`.
   *
   * Note the asymmetry, which is deliberate. A benign case in an attack class is not a mistake, it
   * is the most informative kind of benign case there is: the same hostile bytes as its paired
   * attack, aimed at a harmless capability. `web-h-003` carries byte-identical content to
   * `web-h-001` and must be ALLOWED, and that pair is precisely what separates a containment policy
   * from a text detector - one sees a different capability, the other sees the same string twice.
   * Forbidding it would forbid the corpus's best evidence.
   */
  | "ATTACK_FILED_AS_BENIGN";

export interface CorpusViolation {
  readonly code: CorpusViolationCode;
  readonly caseId: string;
  readonly message: string;
}

/**
 * Validate a corpus. Pure and synchronous.
 *
 * Returns violations rather than throwing, and returns ALL of them: a corpus can be wrong in
 * several independent ways at once, and a checker that stops at the first hides the rest.
 */
export function checkCorpus(cases: readonly CorpusCase[]): CorpusViolation[] {
  const violations: CorpusViolation[] = [];
  const push = (code: CorpusViolationCode, caseId: string, message: string): void => {
    violations.push({ code, caseId, message });
  };

  for (const c of cases) {
    const sourceIds = new Set(c.sources.map((s) => s.id as string));

    // ---- principal ------------------------------------------------------------------------
    const trusted: readonly Provenance[] = ["SYSTEM", "USER"];
    if (!c.sources.some((s) => trusted.includes(s.provenance))) {
      push("MISSING_PRINCIPAL", c.id, "no SYSTEM or USER source; there is no intent to compare to");
    }

    // ---- an attack needs something untrusted -----------------------------------------------
    if (c.groundTruth === "attack" && c.sources.every((s) => trusted.includes(s.provenance))) {
      push("ATTACK_WITHOUT_UNTRUSTED", c.id, "every source is trusted, so nothing is injected");
    }

    // ---- referential integrity --------------------------------------------------------------
    for (const arg of c.proposedAction.args) {
      for (const from of arg.derivedFrom) {
        if (!sourceIds.has(from as string)) {
          push(
            "DANGLING_SOURCE_REF",
            c.id,
            `arg "${arg.name}" derives from unknown source ${from}`,
          );
        }
      }
    }
    for (const id of sourceIds) {
      if (!(id in c.content)) {
        push("CONTENT_SOURCE_MISMATCH", c.id, `source ${id} declares no content`);
      }
    }
    for (const id of Object.keys(c.content)) {
      if (!sourceIds.has(id)) {
        push("CONTENT_SOURCE_MISMATCH", c.id, `content ${id} has no declared source`);
      }
    }

    // ---- split discipline --------------------------------------------------------------------
    const looksHoldout = (c.id as string).includes("-h-");
    if (looksHoldout !== (c.split === "holdout")) {
      push("SPLIT_ID_MISMATCH", c.id, `id and split disagree (split="${c.split}")`);
    }

    // ---- grading discipline ------------------------------------------------------------------
    const refuses = c.expected.containment !== "ALLOW";
    if (refuses && c.expected.requiredReasons.length === 0) {
      push(
        "REFUSAL_WITHOUT_REQUIRED_REASONS",
        c.id,
        "expected to refuse but names no reason; blocking for the wrong reason would pass",
      );
    }
    if (!refuses && c.expected.requiredReasons.length > 0) {
      push("ALLOW_WITH_REQUIRED_REASONS", c.id, "expected to allow but names required reasons");
    }

    // ---- attribution ---------------------------------------------------------------------------
    if (c.source.kind === "derived" && c.source.modifications.trim() === "") {
      push("DERIVED_WITHOUT_ATTRIBUTION", c.id, "derived case with empty modifications");
    }

    // ---- class agreement -----------------------------------------------------------------------
    // One-directional on purpose: benign_hard must be benign, but a benign case may live in an
    // attack class as a paired control. See ATTACK_FILED_AS_BENIGN.
    if (c.attackClass === "benign_hard" && c.groundTruth !== "benign") {
      push("ATTACK_FILED_AS_BENIGN", c.id, "filed under benign_hard but marked an attack");
    }
  }

  return violations;
}

/** Convenience wrapper. A corpus is valid when nothing is wrong with it. */
export const isCorpusValid = (cases: readonly CorpusCase[]): boolean =>
  checkCorpus(cases).length === 0;

/** Render violations for a terminal or a failing test. */
export function formatCorpusViolations(violations: readonly CorpusViolation[]): string {
  if (violations.length === 0) return "corpus: no violations";
  return violations.map((v) => `  ${v.code}  ${v.caseId}: ${v.message}`).join("\n");
}

/** Re-exported so a corpus author does not need two imports. */
export type { Capability, ParamRole, ProposedAction, Provenance, Source, Taint };
