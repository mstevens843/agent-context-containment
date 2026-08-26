// Receipt replay, expiry, and binding.
//
// Until v0.3 a receipt was a claim about a SLOT: capability, role, argument name. Three things it was
// not, all of them documented as open in LIMITATIONS.md and all of them closed here:
//
//   it did not bind the VALUE, so a receipt for one address admitted any address in that slot;
//   it did not bind the SOURCE, so a receipt obtained for one email's address admitted the same
//     address arriving from a different email;
//   it could not be SPENT, so one confirmation authorised a retry loop.
//
// The engine is pure, which decides the shape of all three. It reads no clock and holds no state, so
// `now` and the spent-ledger arrive as arguments. A caller who omits them gets no expiry checking and
// unlimited reuse - stated in the field docs, and the reason the ledger is threaded through the call
// signature rather than hidden in a module: forgetting it should be visible at the call site.

import { describe, expect, it } from "vitest";
import {
  type ReceiptId,
  actionId,
  admitUserConfirmedValue,
  decide,
  receiptId,
  sourceId,
} from "../src/index.js";

const AT_ISSUE = 1_000;
const scope = (
  over: Partial<{ nonce: string; expiresAt: number | null; source: string }> = {},
) => ({
  nonce: over.nonce ?? "n-1",
  issuedAt: AT_ISSUE,
  expiresAt: over.expiresAt === undefined ? AT_ISSUE + 60_000 : over.expiresAt,
  source: over.source !== undefined ? sourceId(over.source) : null,
});

/** A confirmation for the address the user was actually shown. */
const receiptFor = (
  candidate: string,
  over: Parameters<typeof scope>[0] = {},
  argName = "to",
  capability: "email_send" | "payment" = "email_send",
) =>
  admitUserConfirmedValue({
    candidate,
    presented: `Send to ${candidate}?`,
    capability,
    role: "sink_identity",
    argName,
    lifts: "UNTRUSTED_EXTERNAL",
    scope: scope(over),
  });

const send = (over: {
  readonly value?: string;
  readonly receipts?: readonly ReturnType<typeof receiptFor>[];
  readonly spent?: ReadonlySet<ReceiptId>;
  readonly now?: number;
  readonly from?: string;
  readonly argName?: string;
}) =>
  decide({
    action: {
      id: actionId("a"),
      capability: "email_send",
      tool: "gmail.send",
      args: [
        {
          name: over.argName ?? "to",
          role: "sink_identity",
          derivedFrom: [sourceId(over.from ?? "msg1")],
          ...(over.value !== undefined ? { value: over.value } : {}),
        },
      ],
    },
    sources: [
      { id: sourceId("msg1"), provenance: "EMAIL" },
      { id: sourceId("msg2"), provenance: "EMAIL" },
    ],
    receipts: (over.receipts ?? []).filter((r) => r !== undefined),
    ...(over.spent !== undefined ? { spentReceipts: over.spent } : {}),
    ...(over.now !== undefined ? { now: over.now } : {}),
  });

const codes = (v: ReturnType<typeof decide>) => v.reasons.map((r) => r.code);

describe("a receipt admits the value it was issued for", () => {
  const r = receiptFor("alice@ourcorp.com");

  it("admits that value", () => {
    const v = send({ value: "alice@ourcorp.com", receipts: [r], now: AT_ISSUE });
    expect(v.decision).toBe("ALLOW");
    expect(codes(v)).toContain("declassified");
  });

  it("does not admit a different value in the same slot", () => {
    // The check-versus-use gap, closed. Before the value was bound, a receipt was a claim about a
    // slot, and any value could be dropped into a slot that had one.
    const v = send({ value: "mallory@evil.tld", receipts: [r], now: AT_ISSUE });
    expect(v.decision).not.toBe("ALLOW");
    expect(codes(v)).toContain("receipt_value_mismatch");
  });

  it("reports the mismatch rather than silently not matching", () => {
    // "No receipt covered this" and "a receipt was rejected" are very different events, and the
    // second one is sometimes an adversary. A predicate that just fails to match loses that.
    const v = send({ value: "mallory@evil.tld", receipts: [r], now: AT_ISSUE });
    const mismatch = v.reasons.find((x) => x.code === "receipt_value_mismatch");
    expect(mismatch?.message).toContain("alice@ourcorp.com");
    expect(mismatch?.message).toContain("mallory@evil.tld");
  });
});

describe("a receipt can be spent", () => {
  const r = receiptFor("alice@ourcorp.com");

  it("names the receipt it consumed, so the shell knows what to burn", () => {
    const v = send({ value: "alice@ourcorp.com", receipts: [r], now: AT_ISSUE });
    expect(v.spends).toEqual([r?.id]);
  });

  it("refuses a receipt the ledger says was already spent", () => {
    // Replay. One confirmation authorising a retry loop is the attack this closes.
    const v = send({
      value: "alice@ourcorp.com",
      receipts: [r],
      now: AT_ISSUE,
      spent: new Set([r?.id as ReceiptId]),
    });
    expect(v.decision).not.toBe("ALLOW");
    expect(codes(v)).toContain("receipt_already_consumed");
  });

  it("spends nothing on a refusal", () => {
    // Burning evidence that did no work is how a single-use human confirmation gets exhausted ten
    // minutes before the action that needed it.
    const v = send({ value: "mallory@evil.tld", receipts: [r], now: AT_ISSUE });
    expect(v.spends).toEqual([]);
  });

  it("is idempotent when the same receipt is delivered twice", () => {
    // Duplicate delivery is ordinary - a retried request, a doubled queue message - and is not an
    // attack. It admits once and spends once.
    const v = send({ value: "alice@ourcorp.com", receipts: [r, r], now: AT_ISSUE });
    expect(v.decision).toBe("ALLOW");
    expect(v.spends).toEqual([r?.id]);
  });
});

describe("a receipt goes stale", () => {
  it("admits before its expiry and refuses after", () => {
    const r = receiptFor("alice@ourcorp.com", { expiresAt: AT_ISSUE + 60_000 });
    expect(
      send({ value: "alice@ourcorp.com", receipts: [r], now: AT_ISSUE + 59_000 }).decision,
    ).toBe("ALLOW");
    const late = send({ value: "alice@ourcorp.com", receipts: [r], now: AT_ISSUE + 61_000 });
    expect(late.decision).not.toBe("ALLOW");
    expect(codes(late)).toContain("receipt_expired");
  });

  it("does not check expiry at all when the caller supplies no clock", () => {
    // Deliberate, and stated rather than defaulted. A pure function that invents a clock is a lie
    // that only surfaces when two runs of the same input disagree. Omitting `now` disables the check
    // and that is a caller's choice, made visible by the missing argument.
    const r = receiptFor("alice@ourcorp.com", { expiresAt: 1 });
    expect(send({ value: "alice@ourcorp.com", receipts: [r] }).decision).toBe("ALLOW");
  });
});

describe("a receipt is bound to where its value came from", () => {
  it("admits a value from the source it was issued against", () => {
    const r = receiptFor("alice@ourcorp.com", { source: "msg1" });
    expect(
      send({ value: "alice@ourcorp.com", receipts: [r], now: AT_ISSUE, from: "msg1" }).decision,
    ).toBe("ALLOW");
  });

  it("refuses the identical value arriving from a different source", () => {
    // Two emails can name the same address; only one of them was confirmed. Without source binding a
    // confirmation obtained for a colleague's message admits an attacker's message that happens to
    // name the same recipient.
    const r = receiptFor("alice@ourcorp.com", { source: "msg1" });
    const v = send({ value: "alice@ourcorp.com", receipts: [r], now: AT_ISSUE, from: "msg2" });
    expect(v.decision).not.toBe("ALLOW");
    expect(codes(v)).toContain("receipt_source_mismatch");
  });
});

describe("a receipt does not travel", () => {
  it("does not admit another argument", () => {
    const r = receiptFor("alice@ourcorp.com", {}, "to");
    const v = send({ value: "alice@ourcorp.com", receipts: [r], now: AT_ISSUE, argName: "cc" });
    expect(v.decision).not.toBe("ALLOW");
  });

  it("does not admit another capability", () => {
    // Safety is capability-relative. A human who agreed to email an address did not agree to pay it.
    const r = receiptFor("alice@ourcorp.com", {}, "to", "payment");
    const v = send({ value: "alice@ourcorp.com", receipts: [r], now: AT_ISSUE });
    expect(v.decision).not.toBe("ALLOW");
    expect(codes(v)).toContain("receipt_capability_mismatch");
  });
});

describe("rejection ordering", () => {
  it("reports replay first when a receipt fails several checks at once", () => {
    // Replay is the only rejection whose reason is evidence of an adversary rather than of a bug. A
    // receipt can fail several checks together and the log keeps whichever fired first, so if the
    // capability check ran first, a replayed receipt with the wrong capability would be logged as a
    // mismatch and the attack signal would be gone.
    const r = admitUserConfirmedValue({
      candidate: "alice@ourcorp.com",
      presented: "Send to alice@ourcorp.com?",
      capability: "payment",
      role: "sink_identity",
      argName: "to",
      lifts: "UNTRUSTED_EXTERNAL",
      scope: scope({ expiresAt: 1 }),
    });
    const v = send({
      value: "mallory@evil.tld",
      receipts: [r],
      now: AT_ISSUE + 999_999,
      spent: new Set([r?.id as ReceiptId]),
    });
    expect(codes(v)[0]).toBe("receipt_already_consumed");
  });
});

describe("what this does not close", () => {
  it("a caller who passes no ledger gets unlimited reuse, and that is visible not hidden", () => {
    // Stated as a test so the limitation cannot quietly stop being true. The engine holds no state;
    // single-use is the shell's obligation, and the shell can decline it.
    const r = receiptFor("alice@ourcorp.com");
    const once = send({ value: "alice@ourcorp.com", receipts: [r], now: AT_ISSUE });
    const again = send({ value: "alice@ourcorp.com", receipts: [r], now: AT_ISSUE });
    expect(once.decision).toBe("ALLOW");
    expect(again.decision).toBe("ALLOW");
    expect(receiptId("unused")).toBeDefined();
  });
});
