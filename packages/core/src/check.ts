// The checker. Runnable against ANY implementation's decision log, not only this library's.
//
// This exists because a library that grades its own homework is worth very little. The checker
// reads the same CAPABILITY_POLICY the engine reads, re-derives what each logged decision should
// have been, and reports every disagreement. Hand it a log emitted by a competitor, a research
// prototype, or a Python service, and it works, because a `DecisionRecord` is plain JSON.
//
// TWO CHOICES HERE ARE NOT OBVIOUS AND ARE BOTH LOAD-BEARING.
//
// 1. THE RECORD'S VOCABULARY FIELDS ARE `string`, NOT THE BRANDED UNIONS. A checker whose input
//    type admits only values from its own enum cannot report "you performed a capability we have
//    never heard of" - the value fails to parse and the finding surfaces as a crash in the harness
//    rather than as a violation in the report. Unknown vocabulary is a FINDING, not a parse error,
//    so the parse boundary is permissive and the check is strict. That is the inverse of the usual
//    advice and it is right here.
//
// 2. `EFFECT_WITHOUT_DECISION` EXISTS. A log with zero records, paired with a set of actions the
//    shell says it performed, must produce one violation per action - never a clean bill of health.
//    On the benchmark this library grew out of, a candidate scored a perfect 113/113 by never
//    writing to the ledger it was graded against. A checker that only inspects the rows it was
//    given cannot see the rows that were never written, and "no evidence of wrongdoing" is not the
//    same statement as "evidence of no wrongdoing".
//
// It returns violations rather than throwing, and returns ALL of them: a log can be wrong in six
// independent ways at once, and a checker that stops at the first hides the other five.

import { CAPABILITY_POLICY, type CapabilityPolicy, type ceilingFor, decide } from "./policy.js";
import {
  type Capability,
  type ParamRole,
  type Provenance,
  type Source,
  type Taint,
  actionId,
  sourceId,
} from "./types.js";

/** One row of a decision log, in the shape any implementation can emit. */
export interface DecisionRecord {
  readonly seq: number;
  readonly actionId: string;
  /** Plain string: a foreign log may name a capability this policy has never heard of. */
  readonly capability: string;
  readonly tool: string;
  readonly decision: string;
  readonly reasons: readonly string[];
  readonly sources: readonly {
    readonly id: string;
    readonly provenance: string;
    readonly derivedFrom?: readonly string[];
  }[];
  readonly args: readonly {
    readonly name: string;
    readonly role: string;
    readonly derivedFrom: readonly string[];
  }[];
  /** Did the shell actually perform the side effect? Without this the log proves nothing. */
  readonly performed: boolean;
  readonly confirmed?: boolean;
}

/** Ways a decision log can be wrong. States, so `SCREAMING_SNAKE`. */
export type ViolationCode =
  /** Performed, and the policy re-derives to a refusal. The finding this library exists for. */
  | "CONTAINMENT_BREACH"
  /** Performed, and the implementation's OWN recorded decision was not ALLOW. */
  | "PERFORMED_WITHOUT_ALLOW"
  /** The engine decided differently from the table. Nothing was performed. */
  | "DECISION_DISAGREEMENT"
  /** A refusal with no reason. A refusal nobody can audit or argue with is not a control. */
  | "MISSING_REASONS"
  /** An action the shell reports as performed with no decision record at all. */
  | "EFFECT_WITHOUT_DECISION"
  /** A capability not in the policy table. */
  | "UNKNOWN_CAPABILITY"
  /** A provenance not in the vocabulary. */
  | "UNKNOWN_PROVENANCE"
  /** A decision word that is not one of the four. */
  | "UNKNOWN_DECISION"
  /** Sequence numbers must increase. Out-of-order rows mean the log is not a log. */
  | "NON_MONOTONIC_SEQ";

export interface Violation {
  readonly code: ViolationCode;
  /** Plain string: this came from a foreign log and may not be a valid id. */
  readonly actionId?: string;
  readonly seq?: number;
  readonly message: string;
}

export interface CheckOptions {
  /** Defaults to the shipped table. Pass a substitute to audit against a different policy. */
  readonly policy?: CapabilityPolicy;
  /**
   * Actions the implementation says it performed. Supplying this enables the orphan check, which is
   * the only check that can catch an implementation that simply never wrote a record.
   */
  readonly performedActions?: ReadonlySet<string>;
}

const DECISIONS = new Set(["ALLOW", "DENY", "NEEDS_REVIEW", "NEEDS_DECLASSIFICATION"]);
const PROVENANCES = new Set<string>([
  "SYSTEM",
  "USER",
  "RETRIEVED",
  "WEB",
  "EMAIL",
  "DOCUMENT",
  "EXTERNAL_API",
  "TOOL_OUTPUT",
]);
const ROLES = new Set<string>(["sink_identity", "magnitude", "selector", "payload", "control"]);

/**
 * Check a decision log.
 *
 * Pure and synchronous. Safe to run in a test, in CI, in a nightly reconciliation job, or against
 * a competitor's implementation.
 */
export function checkContainment(
  log: readonly DecisionRecord[],
  options: CheckOptions = {},
): Violation[] {
  const policy = options.policy ?? CAPABILITY_POLICY;
  const violations: Violation[] = [];
  const push = (code: ViolationCode, message: string, r?: DecisionRecord): void => {
    violations.push({
      code,
      message,
      ...(r !== undefined ? { actionId: r.actionId, seq: r.seq } : {}),
    });
  };

  let previousSeq = Number.NEGATIVE_INFINITY;
  const seenActions = new Set<string>();

  for (const r of log) {
    seenActions.add(r.actionId);

    if (r.seq <= previousSeq) {
      push("NON_MONOTONIC_SEQ", `seq ${r.seq} does not follow ${previousSeq}`, r);
    }
    previousSeq = r.seq;

    if (!DECISIONS.has(r.decision)) {
      push("UNKNOWN_DECISION", `"${r.decision}" is not one of the four decisions`, r);
    }
    for (const s of r.sources) {
      if (!PROVENANCES.has(s.provenance)) {
        push("UNKNOWN_PROVENANCE", `source ${s.id} has provenance "${s.provenance}"`, r);
      }
    }
    if (r.decision !== "ALLOW" && r.reasons.length === 0) {
      push("MISSING_REASONS", `${r.decision} with no reason attached`, r);
    }

    const row = policy[r.capability as Capability];
    if (row === undefined) {
      push("UNKNOWN_CAPABILITY", `no policy row for "${r.capability}"`, r);
      if (r.performed) {
        push("CONTAINMENT_BREACH", `performed an undeclared capability "${r.capability}"`, r);
      }
      continue;
    }

    if (r.performed && r.decision !== "ALLOW") {
      push(
        "PERFORMED_WITHOUT_ALLOW",
        `the shell performed this after the engine said ${r.decision}`,
        r,
      );
    }

    // ---- re-derive from the same table the engine reads ------------------------------------
    const sources: Source[] = r.sources
      .filter((s) => PROVENANCES.has(s.provenance))
      .map((s) => ({
        id: sourceId(s.id),
        provenance: s.provenance as Provenance,
        ...(s.derivedFrom !== undefined
          ? { derivedFrom: s.derivedFrom.map((d) => sourceId(d)) }
          : {}),
      }));

    const rederived = decide(
      {
        action: {
          id: actionId(r.actionId),
          capability: r.capability as Capability,
          tool: r.tool,
          args: r.args.map((a) => ({
            name: a.name,
            role: (ROLES.has(a.role) ? a.role : "sink_identity") as ParamRole,
            derivedFrom: a.derivedFrom.map((d) => sourceId(d)),
          })),
        },
        sources,
        ...(r.confirmed !== undefined ? { confirmed: r.confirmed } : {}),
      },
      policy,
    );

    if (r.performed && rederived.decision !== "ALLOW") {
      push(
        "CONTAINMENT_BREACH",
        `performed, but the policy re-derives to ${rederived.decision}: ${rederived.reasons.map((x) => x.message).join("; ")}`,
        r,
      );
    } else if (rederived.decision !== r.decision && DECISIONS.has(r.decision)) {
      push(
        "DECISION_DISAGREEMENT",
        `logged ${r.decision}, policy re-derives ${rederived.decision}`,
        r,
      );
    }
  }

  // ---- the orphan check ---------------------------------------------------------------------
  for (const id of options.performedActions ?? []) {
    if (!seenActions.has(id)) {
      push(
        "EFFECT_WITHOUT_DECISION",
        `action "${id}" was performed but no decision was ever recorded for it`,
      );
    }
  }

  return violations;
}

/** Convenience wrapper. A log is contained when nothing is wrong with it. */
export const isContained = (log: readonly DecisionRecord[], options?: CheckOptions): boolean =>
  checkContainment(log, options).length === 0;

/** Render violations for a terminal or a failing test. */
export function formatViolations(violations: readonly Violation[]): string {
  if (violations.length === 0) return "containment: no violations";
  return violations
    .map((v) => {
      const where = v.actionId !== undefined ? ` ${v.actionId}` : "";
      return `  ${v.code}${where}: ${v.message}`;
    })
    .join("\n");
}

/** Re-exported so a log auditor needs one import. */
export type { Capability, Taint, ceilingFor };
