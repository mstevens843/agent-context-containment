// The raw-engine misuse hazard, and the size of the fix.
//
// This file exists to pin BOTH halves honestly. The guard makes the accident unrepresentable, and
// nothing makes the deliberate bypass impossible - the flat `decide` export is still there and a
// caller can reach past everything. Testing only the first half would be advertising a barrier where
// there is a guard rail.

import {
  type ReceiptId,
  actionId,
  admitUserConfirmedValue,
  advanced,
  decide,
  sourceId,
} from "@agent-containment/core";
import { describe, expect, it } from "vitest";
import { createGuard } from "../src/index.js";

const AT = 1_000;
const expiredReceipt = admitUserConfirmedValue({
  candidate: "alice@ourcorp.com",
  presented: "Send to alice@ourcorp.com?",
  capability: "email_send",
  role: "sink_identity",
  argName: "to",
  lifts: "UNTRUSTED_EXTERNAL",
  scope: { nonce: "n", issuedAt: AT, expiresAt: AT + 1, source: null },
});

const call = {
  action: {
    id: actionId("a1"),
    capability: "email_send" as const,
    tool: "gmail.send",
    args: [
      {
        name: "to",
        role: "sink_identity" as const,
        derivedFrom: [sourceId("msg")],
        value: "alice@ourcorp.com",
      },
    ],
  },
  sources: [{ id: sourceId("msg"), provenance: "EMAIL" as const }],
  receipts: [expiredReceipt].filter((r) => r !== undefined),
};

describe("the accident", () => {
  it("the raw engine admits a long-expired receipt when the caller forgets a clock", () => {
    // Not a bug in `decide`. It is a pure function that was given no clock, so it did not check a
    // time. The bug is that forgetting is silent, legal, and looks exactly like working code.
    expect(decide(call).decision).toBe("ALLOW");
  });

  it("the guard refuses the same call, because it cannot be given no clock", () => {
    const guard = createGuard({ clock: () => AT + 999_999 });
    const v = guard.decideOnly(call);
    expect(v.decision).not.toBe("ALLOW");
    expect(v.reasons.map((r) => r.code)).toContain("receipt_expired");
  });

  it("the guard rejects an attempt to pass replay state at all", () => {
    const guard = createGuard({ clock: () => AT });
    // @ts-expect-error `now` belongs to the guard. This must stay a compile error.
    guard.decideOnly({ ...call, now: 0 });
    // @ts-expect-error `spentReceipts` belongs to the guard.
    guard.decideOnly({ ...call, spentReceipts: new Set<ReceiptId>() });
    expect(true).toBe(true);
  });
});

describe("the deliberate bypass", () => {
  it("is still possible, and this test says so rather than implying otherwise", () => {
    // The honest limit. `advanced.decide` is the same function as `decide`; namespacing changes how a
    // call READS in a diff, not what it can do. A reviewer skimming a pull request sees the word
    // `advanced` - that is the entire mechanism, and it is a convention rather than a barrier.
    expect(advanced.decide).toBe(decide);
    expect(advanced.decide(call).decision).toBe("ALLOW");
  });

  it("what actually stops the accident is a type, not a name", () => {
    // Worth stating as an assertion because it is the load-bearing claim of the whole package. The
    // namespace makes a bypass visible; the guard's `never`-typed fields make the accident
    // impossible. Only the second one is enforcement.
    const guard = createGuard({ clock: () => AT + 999_999 });
    expect(guard.decideOnly(call).decision).not.toBe(advanced.decide(call).decision);
  });
});
