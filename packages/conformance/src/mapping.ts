// Auditing the grading layer on imported cases.
//
// `corpus/imported/` carries upstream's strings byte for byte, and that is the strongest evidence in
// this repository. It is also only half of a case. The other half - which provenance the bytes carry,
// which capability the action maps to, which argument role, and therefore which decision is correct -
// is entirely mine, and a reader who trusts the imports has no reason to trust the grading.
//
// So rather than asserting the mapping is right, this module asks a narrower and answerable question:
//
//   WHERE DOES THE RESULT DEPEND ON MY CHOICE?
//
// For every imported case, `MAPPING.json` records the capability I chose and the alternatives a
// different reviewer could defend. Re-running each case under every alternative separates two very
// different situations:
//
//   ROBUST   every PEER mapping refuses it. My choice did not decide the outcome, so the case
//            survives disagreement about which row fits.
//   FRAGILE  some peer mapping allows it. The case is then evidence about my capability table rather
//            than about the attack, and it should be read that way or not at all.
//
// The alternatives come in two kinds and the distinction is load-bearing. A PEER alternative is a
// different capability at the same severity tier - the kind of disagreement two careful reviewers
// could have. An UNDERSTATED alternative describes the tool as less capable than it is, and that is
// a mis-declaration rather than a reading. Only peers count against robustness, because containment
// is explicitly conditional on the capability declaration being accurate; understated mappings are
// run anyway and reported on their own line, since the size of the hole a mis-declaration opens is
// worth knowing even though it is out of contract.
//
// Averaging the two kinds together would produce a number that means nothing: it would either flatter
// the engine by dropping the mis-declaration result, or condemn it for a failure it never claimed to
// prevent. A case being fragile is not a bug to fix by picking a friendlier mapping - it is a fact
// about how much weight the case can carry.

import {
  type Capability,
  type CorpusCase,
  type Decision,
  actionId,
  advanced,
  sourceId,
} from "@agent-context-containment/core";

/** One case's grading, as recorded in MAPPING.json. */
export interface CaseMapping {
  readonly id: string;
  readonly upstream: {
    readonly attackType: string;
    readonly attackerTool: string;
    readonly userTool: string;
    readonly expectedAchievement: string;
  };
  readonly ourMapping: {
    readonly provenance: string;
    readonly capability: Capability;
    readonly role: string;
    readonly argName: string;
    readonly expectedDecision: Decision;
    readonly rationale: string;
  };
  readonly alternativeMappings: readonly {
    readonly capability: Capability;
    readonly kind: AlternativeKind;
    readonly why: string;
  }[];
}

/** See the module header: only `peer` counts against robustness. */
export type AlternativeKind = "peer" | "understated";

export interface MappingFile {
  readonly about: string;
  readonly alternativeKinds: Readonly<Record<AlternativeKind, string>>;
  readonly mappingRules: Readonly<Record<string, string>>;
  readonly cases: readonly CaseMapping[];
}

export interface SensitivityResult {
  readonly id: string;
  readonly chosen: { readonly capability: Capability; readonly decision: Decision };
  readonly alternatives: readonly {
    readonly capability: Capability;
    readonly kind: AlternativeKind;
    readonly decision: Decision;
    readonly why: string;
  }[];
  /** Every PEER mapping refuses it. The outcome does not rest on my judgement. */
  readonly robust: boolean;
  /** An understated mapping permits it. Out of contract, reported anyway. */
  readonly permittedByUnderstating: readonly Capability[];
}

/**
 * Re-run one imported case under its chosen mapping and every alternative.
 *
 * Uses the raw engine deliberately - this probes the POLICY under substituted inputs rather than
 * integrating with it, which is one of the three cases `docs/INTEGRATION.md` names as legitimate.
 */
export function sensitivity(mapping: CaseMapping, base: CorpusCase): SensitivityResult {
  const run = (capability: Capability): Decision =>
    advanced.decide({
      action: {
        id: actionId(mapping.id),
        capability,
        tool: mapping.upstream.attackerTool,
        args: base.proposedAction.args.map((a) => ({ ...a })),
      },
      sources: base.sources,
    }).decision;

  const chosen = {
    capability: mapping.ourMapping.capability,
    decision: run(mapping.ourMapping.capability),
  };
  const alternatives = mapping.alternativeMappings.map((alt) => ({
    capability: alt.capability,
    kind: alt.kind,
    decision: run(alt.capability),
    why: alt.why,
  }));
  return {
    id: mapping.id,
    chosen,
    alternatives,
    robust:
      chosen.decision !== "ALLOW" &&
      alternatives.filter((a) => a.kind === "peer").every((a) => a.decision !== "ALLOW"),
    permittedByUnderstating: alternatives
      .filter((a) => a.kind === "understated" && a.decision === "ALLOW")
      .map((a) => a.capability),
  };
}

export function formatSensitivity(results: readonly SensitivityResult[]): string {
  const rule = "=".repeat(112);
  const lines = [
    rule,
    "imported-case mapping audit - where the result depends on my judgement",
    rule,
    "",
  ];
  lines.push(
    `  ${"case".padEnd(13)}${"chosen".padEnd(26)}${"peer alternatives".padEnd(52)}understated`,
  );
  lines.push(`  ${"-".repeat(108)}`);
  for (const r of results) {
    const of = (k: AlternativeKind) =>
      r.alternatives
        .filter((a) => a.kind === k)
        .map((a) => `${a.capability}=${short(a.decision)}`)
        .join(" ");
    lines.push(
      `  ${r.id.padEnd(13)}${`${r.chosen.capability}=${short(r.chosen.decision)}`.padEnd(26)}${of("peer").padEnd(52)}${of("understated")}`,
    );
  }
  const robust = results.filter((r) => r.robust).length;
  lines.push("");
  lines.push(`  ROBUST to peer mappings   ${robust}/${results.length}`);
  const fragile = results.filter((r) => !r.robust);
  if (fragile.length === 0) {
    lines.push(
      "    Every case is refused under every capability a reviewer could defend at the same",
    );
    lines.push(
      "    severity tier. That is the only condition under which an imported case is evidence",
    );
    lines.push("    about the ATTACK rather than about my capability table.");
  } else {
    for (const r of fragile) {
      const permitting = r.alternatives
        .filter((a) => a.kind === "peer" && a.decision === "ALLOW")
        .map((a) => a.capability);
      lines.push(`    ${r.id}: allowed under peer mapping ${permitting.join(", ")}`);
    }
  }
  const understated = results.filter((r) => r.permittedByUnderstating.length > 0);
  lines.push("");
  lines.push(`  Permitted when the tool is UNDERSTATED   ${understated.length}/${results.length}`);
  if (understated.length > 0) {
    for (const r of understated) {
      lines.push(`    ${r.id}: allowed if declared ${r.permittedByUnderstating.join(", ")}`);
    }
    lines.push(
      "    Out of contract, not a containment failure: the engine enforces flow GIVEN the",
    );
    lines.push("    declaration, and cannot know a tool was declared weaker than it is. Reported");
    lines.push(
      "    because it sizes the hole a wrong declaration opens, and because that declaration",
    );
    lines.push("    is the first thing to audit in a real deployment. See docs/LIMITATIONS.md.");
  }
  lines.push("");
  lines.push(
    "  The strings in these cases are upstream's, byte for byte. Everything above is not:",
  );
  lines.push(
    "  provenance, capability, argument role and expected decision are all authored here.",
  );
  lines.push(
    "  This table exists so the two halves can be judged separately rather than as one number.",
  );
  lines.push(rule);
  return lines.join("\n");
}

const short = (d: Decision): string =>
  d === "NEEDS_DECLASSIFICATION" ? "declass" : d === "NEEDS_REVIEW" ? "review" : d.toLowerCase();
