// The ledger's cross-host limitation, made executable.
//
// It was already written down. `jsonFileLedger` says "NOT SAFE ACROSS PROCESSES" in its own doc
// comment and `LIMITATIONS.md` has a row for it. Neither stops the failure, because the failure does
// not happen when someone reads the comment - it happens months later when the same code is deployed
// onto three pods, and nothing in the running system notices. A lost spend record is a permitted
// replay, and it is silent: no throw, no log, the receipt simply works twice.
//
// So these tests do three things prose cannot. They pin what each adapter CLAIMS, so a claim cannot
// drift without a test failing. They demonstrate the cross-host loss concretely, with two hosts and
// a receipt that gets spent twice. And they check that a deployment can state its requirement in
// code and get a startup failure rather than a quiet regression.

import type { ReceiptId } from "@agent-context-containment/core";
import {
  checkLedger,
  createGuard,
  formatLedgerChecks,
  jsonFileLedger,
  lockingFileLedger,
  memoryLedger,
  twoHostSimulation,
} from "@agent-context-containment/ledger";
import { describe, expect, it } from "vitest";

/** An in-memory `LockingFs`, so the locking adapter can be exercised with no disk. */
const fakeFs = () => {
  const files = new Map<string, string>();
  const created = new Map<string, number>();
  let clock = 1_000;
  return {
    fs: {
      readFile: (p: string) => files.get(p),
      writeAtomic: (p: string, c: string) => {
        files.set(p, c);
      },
      tryCreateExclusive: (p: string, c: string) => {
        if (files.has(p)) return false;
        files.set(p, c);
        created.set(p, clock);
        return true;
      },
      remove: (p: string) => {
        files.delete(p);
        created.delete(p);
      },
      ageMs: (p: string) => {
        const at = created.get(p);
        return at === undefined ? undefined : clock - at;
      },
    },
    now: () => clock++,
  };
};

const adapters = () => {
  const disk = new Map<string, string>();
  const { fs, now } = fakeFs();
  return [
    { name: "memoryLedger", make: () => memoryLedger() },
    {
      name: "jsonFileLedger",
      make: () =>
        jsonFileLedger({
          path: "/l.json",
          readFile: (p: string) => disk.get(p),
          writeFile: (p: string, c: string) => {
            disk.set(p, c);
          },
        }),
    },
    { name: "lockingFileLedger", make: () => lockingFileLedger({ path: "/lock.json", fs, now }) },
  ];
};

describe("ledger guarantees", () => {
  it("every adapter passes the conformance suite it ships with", () => {
    for (const { name, make } of adapters()) {
      const checks = checkLedger(make);
      const failed = checks.filter((c) => !c.passed);
      expect(failed.map((f) => f.name).join(", "), `${name}:\n${formatLedgerChecks(checks)}`).toBe(
        "",
      );
    }
  });

  it("each adapter's claims are pinned, so a claim cannot drift unnoticed", () => {
    // Written out one adapter at a time rather than derived, because the whole value of the field is
    // that changing it is a deliberate act somebody has to justify.
    expect(memoryLedger().guarantees).toEqual({
      singleProcess: true,
      singleHost: false,
      crossHostSafe: false,
      crashSafe: false,
      staleLockReclaim: false,
      caveat: "lost on restart: every receipt becomes spendable again the moment the process exits",
    });
    const disk = new Map<string, string>();
    const json = jsonFileLedger({
      path: "/l.json",
      readFile: (p) => disk.get(p),
      writeFile: (p, c) => {
        disk.set(p, c);
      },
    });
    expect(json.guarantees.crashSafe, "a file-backed ledger should survive a restart").toBe(true);
    expect(json.guarantees.singleHost, "one JSON file is not safe for concurrent writers").toBe(
      false,
    );
    const { fs, now } = fakeFs();
    const locking = lockingFileLedger({ path: "/lock.json", fs, now });
    expect(
      locking.guarantees.singleHost,
      "the locking adapter is what multi-process callers use",
    ).toBe(true);
    expect(locking.guarantees.staleLockReclaim).toBe(true);
    expect(locking.guarantees.crossHostSafe, "nothing in this package is cross-host safe").toBe(
      false,
    );
  });

  it("nothing in this package claims cross-host safety", () => {
    // If an adapter ever does claim it, that is a claim about NFS or a network store, and it should
    // not be possible to make it by accident.
    for (const { name, make } of adapters()) {
      expect(make().guarantees.crossHostSafe, `${name} claims cross-host safety`).toBe(false);
    }
  });

  it("across hosts the same receipt is spent twice, and nothing complains", () => {
    // The demonstration. This is what "not cross-host safe" actually costs, in eight lines.
    const { hostA, hostB, sync } = twoHostSimulation();
    const receipt = "receipt-1" as unknown as ReceiptId;

    hostA.spend({ receipt, spentAt: 1, actionId: "pay-once" });
    expect(hostA.isSpent(receipt), "host A recorded the spend").toBe(true);

    // Host B has never heard of it, so a guard on host B permits the action a second time. No
    // exception is thrown here and no log line is produced - that silence IS the vulnerability.
    expect(
      hostB.isSpent(receipt),
      "host B has not seen host A's spend, so the receipt replays",
    ).toBe(false);
    hostB.spend({ receipt, spentAt: 2, actionId: "pay-twice" });

    sync();
    // After convergence both hosts agree, which is exactly what makes this hard to notice after the
    // fact: the ledger looks consistent once the dust settles, and the second action already ran.
    expect(hostA.isSpent(receipt) && hostB.isSpent(receipt)).toBe(true);
    expect(
      hostA.entries().find((e) => e.receipt === receipt)?.actionId,
      "convergence keeps the first record, so the audit trail never shows the replay",
    ).toBe("pay-once");
  });

  it("a deployment can require a guarantee and fail at startup instead of silently", () => {
    expect(() =>
      createGuard({
        clock: () => 1,
        ledger: memoryLedger(),
        requireGuarantees: { crossHostSafe: true },
      }),
    ).toThrow(/crossHostSafe/);
    // The message has to be actionable, not just correct.
    try {
      createGuard({
        clock: () => 1,
        ledger: memoryLedger(),
        requireGuarantees: { crashSafe: true },
      });
      expect.unreachable("construction should have thrown");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg, "the error does not repeat the adapter's own caveat").toContain(
        "lost on restart",
      );
      expect(msg, "the error does not say what to do instead").toContain("ReceiptLedger interface");
    }
  });

  it("requiring something the adapter does claim constructs normally", () => {
    const { fs, now } = fakeFs();
    const guard = createGuard({
      clock: () => 1,
      ledger: lockingFileLedger({ path: "/lock.json", fs, now }),
      requireGuarantees: { singleHost: true, crashSafe: true },
    });
    expect(guard.ledger.guarantees.singleHost).toBe(true);
  });

  it("requiring false asks for nothing, since a stronger adapter is never a problem", () => {
    expect(() =>
      createGuard({
        clock: () => 1,
        ledger: memoryLedger(),
        requireGuarantees: { crossHostSafe: false },
      }),
    ).not.toThrow();
  });
});
