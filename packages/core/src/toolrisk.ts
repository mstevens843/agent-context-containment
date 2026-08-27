// A SEMANTIC risk audit for tool bindings, and a very careful claim about what it is worth.
//
// `validatePolicy` catches a manifest inconsistent with ITSELF. It cannot catch one that is
// consistently wrong: a tool that mails your inbox to a stranger, declared `read_only_tool`. Nothing
// inside such a declaration contradicts anything else inside it, and that hole is measured at 17 of
// 17 on the imported data-stealing corpus split.
//
// This file does not close that hole. NOTHING CLOSES IT FROM INSIDE THE DECLARATION. What it does is
// narrower and still worth having: it reads the NAMES - the tool's name, its parameters' names - and
// asks whether they look like the capability they were bound to. `sendEmail` filed under
// `read_only_tool` is a sentence that reads oddly, and reading oddly is evidence, not proof.
//
// THREE RULES I HELD MYSELF TO, because a lint that gets disabled protects nothing:
//
//   1. ADVISORY, ALWAYS. Not one finding here is a contradiction and none fails a build. A rule that
//      blocks a release on a naming heuristic will be suppressed within a week, and a suppressed rule
//      is worse than an absent one because the suppression looks like a decision.
//   2. NO RULE THAT FIRES ON HONEST MANIFESTS. Each predicate is deliberately narrow, and where I
//      could not make one narrow I left it out. The rejected ones are listed at the bottom of this
//      file with the reason, so the omissions are a record rather than an oversight.
//   3. ZERO FINDINGS IS NOT A CLEAN BILL. The formatter says so on every run, because the failure
//      mode here is not a missed lie - it is a reader seeing "0 risks" and concluding the manifest is
//      honest. That conversion of a known unknown into a felt certainty is the actual danger of
//      shipping this at all.

import type { CapabilityPolicy } from "./policy.js";
import type { Capability, ParamRole } from "./types.js";

/**
 * A tool, and the capability row somebody bound it to.
 *
 * THIS BINDING IS WHERE THE LIE LIVES. The capability table can be perfect and the mapping from
 * tools to rows still wrong, and `decide()` never sees a tool at all - it reads
 * `action.capability` and looks up a row. Everything in this file is about the arrow between them.
 */
export interface ToolBinding {
  readonly name: string;
  readonly capability: Capability;
  /** Parameter name to the role it was declared as. */
  readonly params: Readonly<Record<string, ParamRole>>;
  /** Optional prose the author wrote. Read only for contradictions with the binding. */
  readonly description?: string;
}

export interface ToolRisk {
  readonly tool: string;
  readonly code: string;
  /** Always "advisory". Present so the field is impossible to misread as a gate. */
  readonly severity: "advisory";
  readonly detail: string;
  /** What would settle it - the artifact or question that turns this guess into a fact. */
  readonly resolvedBy: string;
}

// Word lists, kept deliberately short, and matched against TOKENS rather than by regex over the raw
// name. The first version used `\b(send|post|...)\b` and missed `gmail.sendMessage` outright, because
// camelCase puts no word boundary between `send` and `Message` - so it caught the tidy names and let
// the ordinary ones through, which is the worst possible failure for a lint: it looks like it works.
//
// Each word names an EFFECT or an EGRESS in ordinary developer English, across the domains this
// library is for - email, support and admin, DevOps and shell, browsing and research, code agents.
const ACTS = new Set([
  "send",
  "post",
  "put",
  "patch",
  "delete",
  "remove",
  "drop",
  "purge",
  "create",
  "update",
  "write",
  "execute",
  "exec",
  "run",
  "deploy",
  "revoke",
  "grant",
  "transfer",
  "pay",
  "refund",
  "merge",
  "publish",
  "terminate",
  "restart",
  "rotate",
  "insert",
  "upsert",
  "invoke",
  "trigger",
  "apply",
]);
const SENDS_OUTWARD = new Set([
  "send",
  "email",
  "mail",
  "post",
  "upload",
  "export",
  "publish",
  "share",
  "forward",
  "webhook",
  "notify",
  "sync",
  "push",
  "transmit",
  "dispatch",
]);
const IRREVERSIBLE_SHAPED = new Set([
  "delete",
  "remove",
  "drop",
  "purge",
  "terminate",
  "revoke",
  "transfer",
  "pay",
  "refund",
  "wipe",
  "destroy",
  "force",
  "truncate",
]);
const NAMES_A_DESTINATION = new Set([
  "to",
  "url",
  "uri",
  "href",
  "endpoint",
  "recipient",
  "recipients",
  "dest",
  "destination",
  "target",
  "path",
  "address",
  "account",
  "host",
  "hostname",
  "channel",
  "queue",
  "topic",
  "repo",
  "bucket",
  "key",
  "filename",
  "file",
]);

/**
 * Split an identifier into lowercase words.
 *
 * `gmail.sendMessage` -> [gmail, send, message]; `admin.delete_account` -> [admin, delete, account];
 * `HTTPGetURL` -> [http, get, url]. Handles the four conventions a real tool name uses: dots,
 * underscores, hyphens and camel or Pascal case, including runs of capitals.
 */
function tokens(name: string): readonly string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== "")
    .map((w) => w.toLowerCase());
}

const anyToken = (name: string, words: ReadonlySet<string>): boolean =>
  tokens(name).some((w) => words.has(w));

const STEERING: readonly ParamRole[] = ["sink_identity", "magnitude", "control"];

/**
 * Read the names and ask whether they match the binding.
 *
 * Pure, and total over well-formed bindings: it returns advisories and gates nothing.
 *
 * NOT total over malformed input, and the comment here previously said it was. A binding list that
 * is not iterable throws, like `contextOf` and for the same reason - this runs at WIRING time,
 * where the only thing a caller could do with a caught error is proceed with a manifest they know
 * is malformed. `decide()` makes the opposite trade deliberately, because it is on the decision
 * path and a throw there would put a bypass in somebody's catch block. Nothing here gates anything,
 * so there is no bypass to create. See DEFECTS_FOUND.md section 26.
 */
export function semanticRisks(
  bindings: readonly ToolBinding[],
  policy: CapabilityPolicy,
): readonly ToolRisk[] {
  const out: ToolRisk[] = [];
  const push = (tool: string, code: string, detail: string, resolvedBy: string): void => {
    out.push({ tool, code, severity: "advisory", detail, resolvedBy });
  };

  for (const t of bindings) {
    const row = policy[t.capability];
    if (row === undefined) continue;

    // ---- the binding ---------------------------------------------------------------------------
    if (row.effect === "none" && anyToken(t.name, ACTS)) {
      push(
        t.name,
        "ACTS_BUT_DECLARED_INERT",
        `named like it changes something, and bound to "${t.capability}" whose effect is "none". If it does act, every ceiling on this row is calibrated for an action that cannot go wrong`,
        "the tool's own implementation, or its schema's side-effect annotation",
      );
    }
    if (row.egress !== "full" && anyToken(t.name, SENDS_OUTWARD)) {
      push(
        t.name,
        "SENDS_BUT_NOT_FULL_EGRESS",
        `named like it moves data outward, and bound to "${t.capability}" whose egress is "${row.egress}". This is the shape that lets 32 of 32 imported data-stealing attacks through: the attack IS the send, so a row that says nothing leaves has nothing to refuse`,
        "where the tool's output actually goes - a network call, a webhook, a message bus",
      );
    }
    if (
      row.effect === "irreversible" &&
      !row.requiresConfirmation &&
      anyToken(t.name, IRREVERSIBLE_SHAPED)
    ) {
      push(
        t.name,
        "IRREVERSIBLE_SHAPED_NO_CONFIRMATION",
        "named like it cannot be undone, on an irreversible row that asks for no confirmation. Defensible - confirmation fatigue is real and a queue nobody reads is worse than no queue - but it should be a decision somebody made",
        "whether an operator is actually on the other end of an escalation",
      );
    }

    // ---- the parameters ------------------------------------------------------------------------
    const steeringParams: string[] = [];
    for (const [param, role] of Object.entries(t.params)) {
      if (STEERING.includes(role)) steeringParams.push(param);
      if (role === "payload" && anyToken(param, NAMES_A_DESTINATION)) {
        push(
          t.name,
          "DESTINATION_LABELLED_PAYLOAD",
          `parameter "${param}" is named like it chooses WHERE the action goes and is declared "payload" - the role with the loosest ceiling on most rows. A destination filed as content is the single cheapest way to disable containment for a tool`,
          "the tool's parameter schema, or one call with a hostile value in that slot",
        );
      }
    }

    // ---- the combination -----------------------------------------------------------------------
    if (
      steeringParams.length > 1 &&
      (row.effect !== "none" || row.egress !== "none") &&
      (row.tuplePolicies ?? []).length === 0 &&
      row.liftableBy.size > 0
    ) {
      push(
        t.name,
        "PAIRED_STEERING_WITHOUT_TUPLE",
        `carries ${steeringParams.length} steering parameters (${steeringParams.join(", ")}) on an acting row with no tuple policy. Each can be admitted separately by its own receipt while the PAIR is the attack - an allowlisted destination plus an in-policy amount are two correct answers to two questions nobody asked together`,
        "whether any two of these arguments are dangerous as a combination rather than individually",
      );
    }

    // ---- the author's own words ------------------------------------------------------------------
    // Only fires when the DESCRIPTION contradicts the binding, which is a narrower and much more
    // reliable signal than reading a description on its own.
    if (
      t.description !== undefined &&
      row.effect === "none" &&
      anyToken(t.description, SENDS_OUTWARD)
    ) {
      push(
        t.name,
        "DESCRIPTION_CONTRADICTS_BINDING",
        `its own description mentions sending or exporting, and it is bound to a row with no effect and egress "${row.egress}". The author described one thing and declared another`,
        "reading the description next to the row - this one is usually settled in a minute",
      );
    }
  }
  return out;
}

export function formatToolRisks(risks: readonly ToolRisk[], toolCount: number): string {
  const lines: string[] = [];
  if (risks.length === 0) {
    lines.push(`  No naming advisories across ${toolCount} tool binding(s).`);
  } else {
    lines.push(`  ${risks.length} advisory finding(s) across ${toolCount} tool binding(s):`);
    lines.push("");
    for (const r of risks) {
      lines.push(`    ${r.tool.padEnd(30)}${r.code}`);
      lines.push(`      ${r.detail}`);
      lines.push(`      settled by: ${r.resolvedBy}`);
    }
  }
  lines.push("");
  lines.push("  ADVISORY ONLY, and this line is the important one.");
  lines.push("");
  lines.push(
    "  Everything above is read off NAMES. A tool called `fetchStatus` that quietly POSTs your",
  );
  lines.push(
    "  inbox to a stranger is honest-looking English and produces no finding at all. ZERO",
  );
  lines.push(
    "  FINDINGS IS NOT A CLEAN BILL - it means nothing was named oddly, which is a fact about",
  );
  lines.push("  vocabulary, not about behaviour.");
  lines.push("");
  lines.push(
    "  The danger of this report is not a lie it misses. It is a reader who sees a clean run",
  );
  lines.push(
    "  and stops auditing the bindings, converting a known unknown into a felt certainty.",
  );
  lines.push("  What actually settles these is in the `settled by` line: a schema, a call, an");
  lines.push("  implementation. See docs/CAPABILITY_MANIFESTS.md.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// Rules considered and DELIBERATELY NOT SHIPPED
// ---------------------------------------------------------------------------------------------
//
// Recorded rather than dropped, so the omissions are a decision on the record. Each of these looks
// useful and would fire on honest manifests often enough to be switched off, and a switched-off rule
// is worse than an absent one - the suppression reads as a considered exemption.
//
//   PAYLOAD_SHAPED_STEERING - a parameter called `body`, `text` or `content` declared as
//     `sink_identity`. Sounds like a mislabel and usually is not: `content` is a perfectly ordinary
//     name for the thing a file_write writes TO a path, and `message` is a legitimate control value
//     in several queueing APIs. The false-positive rate is high and the true positives are already
//     caught by DESTINATION_LABELLED_PAYLOAD from the other direction.
//
//   READ_TOOL_WITH_MANY_PARAMS - "a read-only tool with five parameters is probably doing more than
//     reading". Search APIs take a dozen parameters and read nothing else. Pure noise.
//
//   CAPABILITY_USED_ONCE - "only one tool is bound to this row, so the row may be mis-scoped".
//     A perfectly normal shape for a small deployment, and it would fire on this repository's own
//     examples.
//
//   DESCRIPTION_SENTIMENT - anything that reads a description for how dangerous it SOUNDS. This is a
//     text classifier, which is the technique this entire library exists to argue against. Adding one
//     here would be an unforced contradiction of the thesis.
