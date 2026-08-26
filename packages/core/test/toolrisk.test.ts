// The semantic-risk heuristics, and the two failure modes that would make them worthless.
//
// A lint that fires on honest manifests gets suppressed, and a suppressed rule is worse than an
// absent one because the suppression reads as a considered exemption. A lint that misses the obvious
// case is worse still: it looks like it works. The first version did exactly that - `\b(send)\b`
// missed `gmail.sendMessage`, because camelCase puts no word boundary between `send` and `Message` -
// so it caught the tidily-named lies and let the ordinary ones through.
//
// Both directions are tested here, and the honest set is the one that matters more.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_POLICY,
  type ToolBinding,
  formatToolRisks,
  semanticRisks,
} from "../src/index.js";

// Deliberately duplicated from packages/conformance rather than imported: core must not depend on
// conformance, and a rule about false positives should be checked against bindings written for that
// purpose rather than against whatever another package happens to hold.
const HONEST: readonly ToolBinding[] = [
  { name: "gmail.readMessage", capability: "read_only_tool", params: { messageId: "selector" } },
  {
    name: "gmail.sendMessage",
    capability: "email_send",
    params: { to: "sink_identity", body: "payload" },
  },
  { name: "zendesk.classifyTicket", capability: "text_response", params: { body: "payload" } },
  {
    name: "admin.updateUserRole",
    capability: "account_modify",
    params: { userId: "sink_identity", role: "control" },
  },
  { name: "logs.query", capability: "read_only_tool", params: { service: "selector" } },
  {
    name: "fs.writeFile",
    capability: "file_write",
    params: { path: "sink_identity", content: "payload" },
  },
  { name: "browser.extractText", capability: "read_only_tool", params: { url: "selector" } },
  { name: "http.get", capability: "web_fetch", params: { url: "sink_identity" } },
  { name: "repo.readFile", capability: "read_only_tool", params: { path: "selector" } },
  { name: "assistant.explain", capability: "text_response", params: { body: "payload" } },
];

const risks = (b: readonly ToolBinding[]) => semanticRisks(b, CAPABILITY_POLICY);

describe("semantic risk heuristics", () => {
  it("fires on NONE of ten honest bindings across five domains", () => {
    // The load-bearing test. One false positive here and the rule gets switched off in a real
    // project, after which it protects nothing at all.
    const found = risks(HONEST);
    expect(
      found.map((r) => `${r.tool}:${r.code}`).join(", "),
      "a heuristic fired on an honest binding; it will be suppressed and then it protects nothing",
    ).toBe("");
  });

  it("catches an exfiltration tool bound to the read row", () => {
    // The shape that lets 17 of 17 imported data-stealing attacks through.
    const found = risks([
      {
        name: "gmail.sendMessage",
        capability: "read_only_tool",
        params: { to: "selector", body: "payload" },
        description: "Send a message to a recipient.",
      },
    ]);
    const codes = found.map((r) => r.code);
    expect(codes).toContain("ACTS_BUT_DECLARED_INERT");
    expect(codes).toContain("SENDS_BUT_NOT_FULL_EGRESS");
  });

  it("survives every naming convention a real tool uses", () => {
    // The bug that made version one useless. Each of these is the same lie in a different casing,
    // and a rule that catches only the snake_case one is a rule that catches nothing in a TypeScript
    // codebase.
    for (const name of [
      "sendMessage",
      "send_message",
      "send-message",
      "gmail.sendMessage",
      "GmailSendMessage",
      "SENDMessage",
    ]) {
      const found = risks([{ name, capability: "read_only_tool", params: { to: "selector" } }]);
      expect(
        found.map((r) => r.code),
        `"${name}" produced no ACTS advisory - a naming convention defeats the rule`,
      ).toContain("ACTS_BUT_DECLARED_INERT");
    }
  });

  it("catches a destination filed as content", () => {
    const found = risks([
      {
        name: "slack.postMessage",
        capability: "email_send",
        params: { channel: "payload", text: "payload" },
      },
    ]);
    expect(found.map((r) => r.code)).toContain("DESTINATION_LABELLED_PAYLOAD");
  });

  it("catches shell access bound to the row that answers the user", () => {
    const found = risks([
      { name: "shell.runCommand", capability: "text_response", params: { command: "payload" } },
    ]);
    expect(found.map((r) => r.code)).toContain("ACTS_BUT_DECLARED_INERT");
  });

  it("every finding is advisory and names what would settle it", () => {
    // A finding with no next step is a complaint. The `settled by` line is what turns a guess into a
    // question somebody can answer.
    const found = risks([
      {
        name: "admin.deleteAccount",
        capability: "email_send",
        params: { userId: "sink_identity" },
      },
    ]);
    expect(found.length).toBeGreaterThan(0);
    for (const r of found) {
      expect(r.severity, "a semantic heuristic is not allowed to be anything but advisory").toBe(
        "advisory",
      );
      expect(r.resolvedBy.length > 20, `${r.code} does not say what would settle it`).toBe(true);
    }
  });

  it("a tool whose NAME is honest and whose behaviour is not produces nothing", () => {
    // The hole, asserted rather than described. `fetchStatus` reads as a read; if it quietly POSTs
    // your inbox somewhere, no naming rule reaches it, and none ever will. This test exists so that
    // limit is a fact in the suite rather than a paragraph in a doc.
    const found = risks([
      { name: "vendor.fetchStatus", capability: "read_only_tool", params: { id: "selector" } },
    ]);
    expect(
      found.length,
      "the heuristics claimed to catch a tool whose declaration reads perfectly normally",
    ).toBe(0);
  });

  it("a clean run says loudly that it is not a clean bill", () => {
    // The real danger of shipping this: not a lie it misses, but a reader who sees zero findings and
    // stops auditing the bindings.
    const out = formatToolRisks(risks(HONEST), HONEST.length);
    expect(out).toContain("ZERO");
    expect(out).toContain("NOT A CLEAN BILL");
    expect(out).toContain("ADVISORY ONLY");
  });

  it("the rules NOT shipped are recorded with their reasons", () => {
    // An omission nobody wrote down is indistinguishable from an oversight.
    const src = readFileSync(join(import.meta.dirname, "..", "src", "toolrisk.ts"), "utf8");
    expect(src).toContain("DELIBERATELY NOT SHIPPED");
    for (const rejected of ["PAYLOAD_SHAPED_STEERING", "DESCRIPTION_SENTIMENT"]) {
      expect(src, `${rejected} was considered and its rejection is not recorded`).toContain(
        rejected,
      );
    }
  });
});
