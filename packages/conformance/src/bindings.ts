// Example tool bindings across five general domains, honest and dishonest.
//
// The point of the dishonest set is not that these are clever lies - they are the LAZY ones, which is
// what makes them realistic. Nobody writes a capability manifest intending to disable containment.
// They bind a tool to the row that was already there, or the one whose name sounded closest, and the
// binding outlives the five seconds of thought that produced it.
//
// General domains on purpose: email, support and admin, DevOps and shell, browsing and research, code
// agents. Payments appear as ONE high-risk row among many and are not the centre of anything here -
// a containment model that only worked on money would not be containment.

import type { ToolBinding } from "@agent-context-containment/core";

/** What a careful author writes. Every one of these should produce no advisory. */
export const HONEST_BINDINGS: readonly ToolBinding[] = [
  // ---- email ----------------------------------------------------------------------------------
  {
    name: "gmail.readMessage",
    capability: "read_only_tool",
    params: { messageId: "selector" },
    description: "Fetch one message by id.",
  },
  {
    name: "gmail.sendMessage",
    capability: "email_send",
    params: { to: "sink_identity", subject: "payload", body: "payload" },
    description: "Send a message. Irreversible; it leaves.",
  },
  // ---- support and admin ----------------------------------------------------------------------
  {
    name: "zendesk.classifyTicket",
    capability: "text_response",
    params: { body: "payload" },
    description: "Label a ticket. Produces text and calls nothing.",
  },
  {
    name: "admin.updateUserRole",
    capability: "account_modify",
    params: { userId: "sink_identity", role: "control" },
    description: "Change a role. Irreversible in practice; the target must be clean.",
  },
  // ---- DevOps and shell -------------------------------------------------------------------------
  {
    name: "logs.query",
    capability: "read_only_tool",
    params: { service: "selector", since: "selector" },
    description: "Read logs.",
  },
  {
    name: "fs.writeFile",
    capability: "file_write",
    params: { path: "sink_identity", content: "payload" },
    description: "Write a file. The path steers; the content does not.",
  },
  // ---- browsing and research --------------------------------------------------------------------
  {
    name: "browser.extractText",
    capability: "read_only_tool",
    params: { url: "selector" },
    description: "Fetch a page the user named and return its text.",
  },
  {
    name: "http.get",
    capability: "web_fetch",
    params: { url: "sink_identity" },
    description: "Fetch a URL. Changes nothing and can carry anything outward in the query string.",
  },
  // ---- code agent -------------------------------------------------------------------------------
  {
    name: "repo.readFile",
    capability: "read_only_tool",
    params: { path: "selector" },
    description: "Read a file from the checkout.",
  },
  {
    name: "assistant.explain",
    capability: "text_response",
    params: { body: "payload" },
    description: "Answer the user.",
  },
];

/**
 * What a hurried author writes. Each is a real mistake shape, not a contrived one.
 *
 * Note what is NOT here: a tool whose name is honest and whose behaviour is not. `fetchStatus` that
 * quietly POSTs your inbox somewhere produces no finding from any of these rules and never will,
 * because nothing about its declaration reads oddly. That case is the hole, and no naming heuristic
 * reaches it.
 */
export const DISHONEST_BINDINGS: readonly ToolBinding[] = [
  {
    // The commonest one. The exfiltration tool bound to the read row, because "it's just an API call".
    name: "gmail.sendMessage",
    capability: "read_only_tool",
    params: { to: "selector", body: "payload" },
    description: "Send a message to a recipient.",
  },
  {
    // A destination filed as content - the cheapest possible way to disable containment for a tool,
    // and it looks like a typo.
    name: "slack.postMessage",
    capability: "email_send",
    params: { channel: "payload", text: "payload" },
    description: "Post to a channel.",
  },
  {
    // Shell access bound to the row that answers the user. `text_response` has no effect and no
    // egress, so every ceiling on it is calibrated for something that cannot go wrong.
    name: "shell.runCommand",
    capability: "text_response",
    params: { command: "payload" },
    description: "Run a command and return its output.",
  },
  {
    // Irreversible and asks nobody. Named exactly like what it is.
    name: "admin.deleteAccount",
    capability: "email_send",
    params: { userId: "sink_identity" },
    description: "Delete an account permanently.",
  },
  {
    // DELIBERATELY PRODUCES NO ADVISORY, and it is in this list to show where the rules stop.
    //
    // Two steering parameters on an acting row is the paired-argument shape - each individually
    // defensible, the pair being the attack. `PAIRED_STEERING_WITHOUT_TUPLE` is written for exactly
    // this, and it does not fire, because the SHIPPED table already declares `recipient_and_amount`
    // on `payment`. The binding is fine. The rule is for a custom table that has not thought about
    // combinations, and against this one it correctly says nothing.
    //
    // Which means the dishonest set is 4 findings over 5 bindings, not 5 over 5 - and a rule that
    // fired here anyway would be measuring nothing.
    name: "billing.issueRefund",
    capability: "payment",
    params: { destination: "sink_identity", amount: "magnitude" },
    description: "Refund an order.",
  },
];
