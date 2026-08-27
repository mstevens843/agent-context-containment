// Two sound receipts, one unsafe transfer.
//
//   pnpm build && npx tsx examples/wallet-tuple.ts
//
// This is the failure every per-value check has by construction, and it is easiest to see with money.
// A recipient drawn from a valid payee allowlist. An amount inside a valid policy envelope. Both
// checks pass. Nobody was ever asked the question the transfer actually poses - should THIS amount go
// to THIS recipient - because each receipt answered a question about the other's business.

import {
  actionId,
  admitAllowlistMember,
  admitConfirmedTuple,
  admitNumericEnvelope,
  decide,
  sourceId,
} from "@agent-context-containment/core";

const SCOPE = { nonce: "demo", issuedAt: 0, expiresAt: null, source: null } as const;

// A payee allowlist fixed long before any of this. `treasury@` is on it because treasury genuinely
// gets paid - which is what makes it the worst member to hand an attacker.
const PAYEES = ["vendor-northwind@corp.example", "treasury@corp.example"];

const recipient = admitAllowlistMember({
  candidate: "treasury@corp.example",
  allowlist: PAYEES,
  capability: "payment",
  role: "sink_identity",
  argName: "destination",
  lifts: "UNTRUSTED_EXTERNAL",
  scope: SCOPE,
});

const amount = admitNumericEnvelope({
  candidate: 48_000,
  low: 0,
  high: 50_000,
  granularity: 1,
  capability: "payment",
  role: "magnitude",
  argName: "amount",
  lifts: "UNTRUSTED_EXTERNAL",
  scope: SCOPE,
});

const transfer = (receipts: readonly (typeof recipient)[]) =>
  decide({
    action: {
      id: actionId("t"),
      capability: "payment",
      tool: "payments.transfer",
      args: [
        {
          name: "destination",
          role: "sink_identity",
          derivedFrom: [sourceId("invoice")],
          value: "treasury@corp.example",
        },
        { name: "amount", role: "magnitude", derivedFrom: [sourceId("invoice")], value: "48000" },
      ],
    },
    sources: [{ id: sourceId("invoice"), provenance: "DOCUMENT" }],
    receipts: receipts.filter((r) => r !== undefined),
    confirmed: true,
  });

const show = (label: string, v: ReturnType<typeof decide>) => {
  console.log(`\n${label}`);
  console.log(`  decision: ${v.decision}`);
  for (const r of v.reasons) console.log(`    - ${r.code}`);
};

console.log(`
Both receipts are individually sound:

  destination  "treasury@corp.example"   allowlist member, 1 of ${PAYEES.length}  -> ${recipient !== undefined ? "issued" : "refused"}
  amount       48000                     inside [0, 50000]                -> ${amount !== undefined ? "issued" : "refused"}

The action is also confirmed by a human. Every individual check passes.`);

show("With both receipts and a human confirmation:", transfer([recipient, amount]));

console.log(`
  Neither receipt is wrong. The allowlist is correct - treasury really is a payee. The envelope is
  correct - 48,000 really is under the 50,000 limit. What nobody asked is whether forty-eight
  thousand should go to treasury on the say-so of an invoice, and that is the only question a
  transfer poses.`);

const together = admitConfirmedTuple({
  entries: [
    { argName: "destination", value: "treasury@corp.example" },
    { argName: "amount", value: "48000" },
  ],
  presented: "Send 48000 to treasury@corp.example?",
  capability: "payment",
  role: "sink_identity",
  lifts: "UNTRUSTED_EXTERNAL",
  scope: SCOPE,
});

show("After the pair is ratified as one decision:", transfer([recipient, amount, together]));

console.log(`
  What the tuple receipt does NOT do: it covers the combinations the policy table names, and nothing
  else. Enumerating every dangerous pair of every capability is the sprawling rules engine this
  design refuses to become. The table names recipient-and-amount. Everything else is a documented
  gap - see docs/DECLASSIFICATION.md.
`);
