// Same capability, same taint level, opposite answers - decided entirely by WHICH ARGUMENT the
// untrusted bytes reached.
//
//   pnpm build && npx tsx examples/email-assistant.ts
//
// This is the case a per-capability ceiling cannot express. Forced to pick one ceiling for
// `email_send`, you must refuse the first call - which means refusing "summarise this thread and
// send it to Alice", the ordinary use of an email assistant. That is how a containment library gets
// deleted in week three.

import { actionId, decide, sourceId } from "@agent-containment/core";

const sources = [
  { id: sourceId("task"), provenance: "USER" as const },
  { id: sourceId("msg"), provenance: "EMAIL" as const },
];

const ordinary = decide({
  action: {
    id: actionId("mail-1"),
    capability: "email_send",
    tool: "gmail.send",
    args: [
      { name: "to", role: "sink_identity", derivedFrom: [sourceId("task")] },
      { name: "body", role: "payload", derivedFrom: [sourceId("msg")] },
    ],
  },
  sources,
});

const attack = decide({
  action: {
    id: actionId("mail-2"),
    capability: "email_send",
    tool: "gmail.send",
    args: [
      { name: "to", role: "sink_identity", derivedFrom: [sourceId("msg")] },
      { name: "body", role: "payload", derivedFrom: [sourceId("task")] },
    ],
  },
  sources,
});

console.log("untrusted BODY, user-chosen recipient :", ordinary.decision);
console.log("clean body, untrusted RECIPIENT       :", attack.decision);
for (const r of attack.reasons) console.log(`  - ${r.code}: ${r.message}`);
