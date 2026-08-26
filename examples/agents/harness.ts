// A tiny shared harness for the cross-domain agent demos.
//
// The four demos exist to answer one objection: that this is wallet-safety infrastructure with a
// general-sounding name. It is not. Provenance and capability are domain-independent - an untrusted
// ticket body steering a refund is the SAME SHAPE as an untrusted webpage steering a transfer, and
// the demos are written so the shape is visible across email, DevOps, support and payments without a
// single line of domain logic in the engine.
//
// Every demo runs through the GUARDED path - `createGuard`, a real ledger, receipts burned on use -
// rather than calling the raw engine. That is what `docs/INTEGRATION.md` tells an integrator to do,
// so a demo that did otherwise would be documentation of a thing nobody should copy.
//
// No network, no model, no randomness. The clock is injected and monotonic.

import {
  type Capability,
  type ParamRole,
  type Provenance,
  type ReceiptEvidence,
  type Source,
  type Verdict,
  actionId,
  sourceId,
} from "@agent-containment/core";
import { type Guard, createGuard, memoryLedger } from "@agent-containment/ledger";

export interface Step {
  readonly name: string;
  readonly capability: Capability;
  readonly tool: string;
  readonly args: readonly {
    readonly name: string;
    readonly role: ParamRole;
    readonly from: string;
    /** The concrete value, when a receipt has to be matched against it byte for byte. */
    readonly value?: string;
  }[];
  readonly receipts?: readonly ReceiptEvidence[];
  readonly confirmed?: boolean;
  /** What this step produces if it runs, so a later step can draw on it and inherit its taint. */
  readonly produces?: { readonly id: string; readonly provenance: Provenance };
  /** One line saying what a reader should notice. Printed under the verdict. */
  readonly point: string;
}

export interface Demo {
  readonly title: string;
  readonly domain: string;
  /** The user's own request, and every piece of content that arrives from elsewhere. */
  readonly sources: readonly {
    readonly id: string;
    readonly provenance: Provenance;
    readonly text: string;
  }[];
  readonly steps: readonly Step[];
}

const DECISION_MARK: Readonly<Record<string, string>> = {
  ALLOW: "ALLOW  ",
  DENY: "DENY   ",
  NEEDS_REVIEW: "REVIEW ",
  NEEDS_DECLASSIFICATION: "DECLASS",
};

export interface DemoResult {
  readonly title: string;
  readonly completed: number;
  readonly escalated: number;
  readonly refused: number;
  readonly spent: number;
}

/** Run one demo and print the whole trace: taint flow, decision, reasons, ledger, what survived. */
export function runDemo(demo: Demo, guard?: Guard): DemoResult {
  let tick = 1_700_000_000_000;
  const g =
    guard ??
    createGuard({
      // Injected and monotonic: the demos must print the same bytes on every run, or a reader cannot
      // tell a policy change from the time of day.
      clock: () => tick++,
      ledger: memoryLedger(),
    });

  const sources: Source[] = demo.sources.map((s) => ({
    id: sourceId(s.id),
    provenance: s.provenance,
  }));
  // Provenance by id, INCLUDING sources produced mid-run - so the trace can show that a value drawn
  // from a step's own output is still carrying where it came from.
  const provenanceOf = new Map<string, Provenance>(demo.sources.map((s) => [s.id, s.provenance]));
  const rule = "─".repeat(96);
  console.log(`\n${rule}`);
  console.log(`${demo.domain.toUpperCase()}  ·  ${demo.title}`);
  console.log(rule);

  console.log("\n  WHAT ARRIVED, AND FROM WHERE");
  for (const s of demo.sources) {
    const flat = s.text.replace(/\s+/g, " ").trim();
    const shown = flat.length > 78 ? `${flat.slice(0, 75)}...` : flat;
    console.log(`    ${s.provenance.padEnd(12)} ${s.id.padEnd(10)} "${shown}"`);
  }

  console.log("\n  WHAT THE AGENT TRIED");
  let completed = 0;
  let escalated = 0;
  let refused = 0;
  let spent = 0;

  for (const step of demo.steps) {
    const verdict: Verdict = g.decide({
      action: {
        id: actionId(step.name),
        capability: step.capability,
        tool: step.tool,
        args: step.args.map((a) => ({
          name: a.name,
          role: a.role,
          derivedFrom: [sourceId(a.from)],
          ...(a.value !== undefined ? { value: a.value } : {}),
        })),
      },
      sources,
      ...(step.receipts !== undefined ? { receipts: step.receipts } : {}),
      ...(step.confirmed !== undefined ? { confirmed: step.confirmed } : {}),
    });

    const mark = DECISION_MARK[verdict.decision] ?? verdict.decision;
    console.log(`\n    ${mark}  ${step.name}`);
    console.log(`             ${step.capability} via ${step.tool}`);
    for (const a of step.args) {
      const from = provenanceOf.get(a.from);
      console.log(`             ${a.name} (${a.role})  <-  ${a.from} [${from ?? "unknown"}]`);
    }
    if (verdict.reasons.length > 0) {
      console.log(`             reasons: ${verdict.reasons.map((r) => r.code).join(", ")}`);
    }
    if (verdict.spends.length > 0) {
      spent += verdict.spends.length;
      console.log(
        `             ledger:  burned ${verdict.spends.length} receipt(s) - not reusable`,
      );
    }
    console.log(`             ${step.point}`);

    if (verdict.decision === "ALLOW") {
      completed++;
      if (step.produces !== undefined) {
        // The line that makes this a run rather than four independent decisions: what a step
        // produces becomes a source later steps can draw on, and it inherits the taint of its input.
        sources.push({
          id: sourceId(step.produces.id),
          provenance: step.produces.provenance,
          derivedFrom: [sourceId(step.args[0]?.from ?? "task")],
        });
        provenanceOf.set(step.produces.id, step.produces.provenance);
        console.log(
          `             produced "${step.produces.id}" [${step.produces.provenance}] - it carries its input's taint forward`,
        );
      }
    } else if (verdict.decision === "NEEDS_REVIEW") escalated++;
    else refused++;
  }

  console.log("");
  console.log(
    `  ${completed} completed · ${escalated} escalated · ${refused} refused · ${spent} receipt(s) burned`,
  );
  return { title: demo.title, completed, escalated, refused, spent };
}

export function summarise(results: readonly DemoResult[]): void {
  const rule = "═".repeat(96);
  console.log(`\n${rule}`);
  console.log("ACROSS ALL DOMAINS");
  console.log(rule);
  console.log(
    `\n  ${"demo".padEnd(46)}${"done".padEnd(7)}${"review".padEnd(9)}${"refused".padEnd(10)}receipts burned`,
  );
  console.log(`  ${"-".repeat(92)}`);
  for (const r of results) {
    console.log(
      `  ${r.title.slice(0, 44).padEnd(46)}${String(r.completed).padEnd(7)}${String(r.escalated).padEnd(9)}${String(r.refused).padEnd(10)}${r.spent}`,
    );
  }
  const done = results.reduce((n, r) => n + r.completed, 0);
  const stopped = results.reduce((n, r) => n + r.refused + r.escalated, 0);
  console.log("");
  console.log(`  ${done} safe steps completed. ${stopped} unsafe steps stopped or escalated.`);
  console.log("");
  console.log(
    `  Not one line of the engine knows what any of these ${results.length} domains is. The same two`,
  );
  console.log(
    "  questions decide every one of them: where did this value come from, and what is it being",
  );
  console.log(
    "  used for - and a test asserts the engine's source carries no word like `refund`, `deploy`",
  );
  console.log("  or `invoice`. Payments appear as ONE high-consequence domain, not the centre.");
  console.log(rule);
}
