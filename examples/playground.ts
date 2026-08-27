// An interactive containment playground.
//
//   npx tsx examples/playground.ts --capability payment --role sink_identity --provenance WEB
//   npx tsx examples/playground.ts --capability email_send --role payload --provenance EMAIL --content "..."
//   npx tsx examples/playground.ts --matrix
//   npx tsx examples/playground.ts --help
//
// The point is to make the policy inspectable without reading it. Paste content, label where it came
// from, pick what you want to do with it, and see the decision, the reason codes, and how the taint
// was derived. The content is accepted and echoed and is NEVER read to decide anything - watching a
// decision not change when you rewrite the text is the fastest way to understand the design.

import { detect } from "@agent-context-containment/classifier";
import {
  ALL_CAPABILITIES,
  ALL_PARAM_ROLES,
  ALL_PROVENANCES,
  CAPABILITY_POLICY,
  type Capability,
  type ParamRole,
  type Provenance,
  actionId,
  ceilingFor,
  decide,
  sourceId,
  taintOf,
} from "@agent-context-containment/core";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

const HELP = `
containment playground

  --capability <c>   ${ALL_CAPABILITIES.join(" | ")}
  --role <r>         ${ALL_PARAM_ROLES.join(" | ")}
  --provenance <p>   ${ALL_PROVENANCES.join(" | ")}
  --content "<text>" the untrusted bytes. Echoed, never read to decide.
  --derived-from <p> optional upstream provenance, to model laundering
                     (e.g. --provenance TOOL_OUTPUT --derived-from WEB)
  --confirmed        a human has confirmed this action
  --matrix           every capability x provenance for one role, as a grid
  --help
`;

if (has("help") || argv.length === 0) {
  console.log(HELP);
  process.exit(0);
}

const capability = (flag("capability") ?? "payment") as Capability;
const role = (flag("role") ?? "sink_identity") as ParamRole;
const provenance = (flag("provenance") ?? "WEB") as Provenance;
const derivedFrom = flag("derived-from") as Provenance | undefined;
const content = flag("content") ?? "(no content supplied)";

const bad = (label: string, value: string, allowed: readonly string[]): void => {
  if (allowed.includes(value)) return;
  console.error(`unknown ${label} "${value}". one of: ${allowed.join(", ")}`);
  process.exit(2);
};
bad("capability", capability, ALL_CAPABILITIES);
bad("role", role, ALL_PARAM_ROLES);
bad("provenance", provenance, ALL_PROVENANCES);
if (derivedFrom !== undefined) bad("derived-from", derivedFrom, ALL_PROVENANCES);

/** One decision, with the provenance chain the caller described. */
const run = (cap: Capability, prov: Provenance) => {
  const sources = [
    { id: sourceId("task"), provenance: "USER" as const },
    ...(derivedFrom !== undefined ? [{ id: sourceId("upstream"), provenance: derivedFrom }] : []),
    {
      id: sourceId("input"),
      provenance: prov,
      ...(derivedFrom !== undefined ? { derivedFrom: [sourceId("upstream")] } : {}),
    },
  ];
  return decide({
    action: {
      id: actionId("pg"),
      capability: cap,
      tool: "playground",
      args: [{ name: "arg", role, derivedFrom: [sourceId("input")] }],
    },
    sources,
    ...(has("confirmed") ? { confirmed: true } : {}),
  });
};

// ---- matrix mode ----------------------------------------------------------------------------
if (has("matrix")) {
  const w = 22;
  console.log(`\ncapability x provenance, role = ${role}\n`);
  console.log(
    `  ${"capability".padEnd(w)}${ALL_PROVENANCES.map((p) => p.slice(0, 9).padEnd(11)).join("")}`,
  );
  console.log(`  ${"-".repeat(w + ALL_PROVENANCES.length * 11)}`);
  const short: Record<string, string> = {
    ALLOW: "allow",
    DENY: "DENY",
    NEEDS_REVIEW: "review",
    NEEDS_DECLASSIFICATION: "declass",
  };
  for (const c of ALL_CAPABILITIES) {
    const cells = ALL_PROVENANCES.map((p) => (short[run(c, p).decision] ?? "?").padEnd(11)).join(
      "",
    );
    console.log(`  ${c.padEnd(w)}${cells}`);
  }
  console.log("\n  Read a row: what this capability accepts, by where the bytes came from.");
  console.log("  Read a column: what one source is allowed to reach.\n");
  process.exit(0);
}

// ---- single decision ------------------------------------------------------------------------
const row = CAPABILITY_POLICY[capability];
const verdict = run(capability, provenance);
const detection = detect(content);

console.log(`
CONTENT (echoed, never read to decide)
  ${JSON.stringify(content.length > 120 ? `${content.slice(0, 120)}...` : content)}

TAINT
  provenance        ${provenance}${derivedFrom !== undefined ? `  <- derived from ${derivedFrom}` : ""}
  level             ${taintOf(provenance)}${derivedFrom !== undefined ? `  joined with ${taintOf(derivedFrom)}` : ""}
  effective         ${verdict.taint}
  contributing      ${[...verdict.provenance].sort().join(", ")}

CAPABILITY
  ${capability}
  effect            ${row.effect}
  egress            ${row.egress}
  ceiling for ${role.padEnd(14)}${ceilingFor(row, role)}
  confirmation      ${row.requiresConfirmation ? "required" : "not required"}
  liftable by       ${row.liftableBy.size === 0 ? "nothing - the ceiling is absolute" : [...row.liftableBy].sort().join(", ")}

DECISION
  ${verdict.decision}
${verdict.reasons.map((r) => `  - ${r.code}\n      ${r.message}`).join("\n")}

EFFECTS
${verdict.effects.map((e) => `  - ${e.type}`).join("\n")}

FOR COMPARISON
  a text classifier on the same content: ${detection.matched ? `FLAGGED (${detection.matches.map((m) => m.id).join(", ")})` : "saw nothing"}

  Rewrite --content however you like. The decision above will not move, because nothing read it.
`);
