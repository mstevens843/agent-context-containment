// Concurrency, restarts, and crashes.
//
// The failure this file is about needs two processes to show up, which means it does not appear in
// development and does appear in production. So the filesystem is simulated rather than real: a fake
// lets a test interleave two writers at an exact instruction, which is the only way to reproduce the
// lost-update deterministically. A test against a real disk would pass whether the lock worked or not.

import {
  type ReceiptId,
  actionId,
  admitUserConfirmedValue,
  sourceId,
} from "@agent-containment/core";
import { describe, expect, it } from "vitest";
import {
  LedgerLockError,
  type LockingFs,
  type SpentRecord,
  createGuard,
  jsonFileLedger,
  lockingFileLedger,
} from "../src/index.js";

/** A shared "disk" two ledgers can both see, with the atomicity guarantees the real one provides. */
function fakeDisk() {
  const files = new Map<string, string>();
  const created = new Map<string, number>();
  let clock = 0;
  const fs: LockingFs = {
    readFile: (p) => files.get(p),
    writeAtomic: (p, c) => void files.set(p, c),
    tryCreateExclusive: (p, c) => {
      if (files.has(p)) return false;
      files.set(p, c);
      created.set(p, clock);
      return true;
    },
    remove: (p) => {
      files.delete(p);
      created.delete(p);
    },
    ageMs: (p) => (created.has(p) ? clock - (created.get(p) ?? 0) : undefined),
  };
  return {
    fs,
    files,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

const rec = (id: string, at = 1): SpentRecord => ({
  receipt: id as ReceiptId,
  spentAt: at,
  actionId: "a",
});

describe("the failure a single-process ledger has", () => {
  it("jsonFileLedger loses a record when two writers interleave", () => {
    // The lost update, shown rather than asserted about. Both instances loaded the file when it was
    // empty; each writes back what it knows; the second overwrites the first. A lost record is a
    // PERMITTED REPLAY - the receipt still looks unspent.
    const files = new Map<string, string>();
    const io = {
      path: "/l.json",
      readFile: (p: string) => files.get(p),
      writeFile: (p: string, c: string) => void files.set(p, c),
    };
    const processA = jsonFileLedger(io);
    const processB = jsonFileLedger(io);

    processA.spend(rec("r1"));
    processB.spend(rec("r2"));

    const survived = jsonFileLedger(io)
      .entries()
      .map((e) => e.receipt);
    expect(survived).not.toContain("r1");
    expect(survived).toEqual(["r2"]);
  });
});

describe("the locking ledger", () => {
  it("keeps both records when two writers interleave", () => {
    // Same interleaving, opposite outcome. Each `spend` re-reads INSIDE the lock, so the check and
    // the write are one critical section and neither writer can act on a stale view.
    const disk = fakeDisk();
    const opts = { path: "/l.json", fs: disk.fs, now: disk.now };
    const processA = lockingFileLedger(opts);
    const processB = lockingFileLedger(opts);

    processA.spend(rec("r1"));
    processB.spend(rec("r2"));

    const survived = lockingFileLedger(opts)
      .entries()
      .map((e) => e.receipt);
    expect(survived.sort()).toEqual(["r1", "r2"]);
  });

  it("does not double-record a receipt two processes both try to spend", () => {
    const disk = fakeDisk();
    const opts = { path: "/l.json", fs: disk.fs, now: disk.now };
    lockingFileLedger(opts).spend(rec("r1", 1));
    lockingFileLedger(opts).spend(rec("r1", 2));
    const entries = lockingFileLedger(opts).entries();
    expect(entries.length).toBe(1);
    expect(entries[0]?.spentAt, "a duplicate rewrote when the spend happened").toBe(1);
  });

  it("survives a restart", () => {
    const disk = fakeDisk();
    const opts = { path: "/l.json", fs: disk.fs, now: disk.now };
    lockingFileLedger(opts).spend(rec("r1"));
    expect(lockingFileLedger(opts).isSpent("r1" as ReceiptId)).toBe(true);
  });

  it("survives a crash mid-write, because the rename is atomic", () => {
    // A crash between writing the temp file and renaming it leaves the original intact. A reader sees
    // the old file or the new one, never a half-written one - so the worst case is a lost spend that
    // was never acknowledged, not a corrupt ledger nobody can read.
    const disk = fakeDisk();
    const opts = { path: "/l.json", fs: disk.fs, now: disk.now };
    lockingFileLedger(opts).spend(rec("r1"));
    disk.files.set("/l.json.tmp", "{ this is a half-written");
    expect(
      lockingFileLedger(opts)
        .entries()
        .map((e) => e.receipt),
    ).toEqual(["r1"]);
  });

  it("releases the lock even when the write throws", () => {
    // A lock held by a dead operation wedges every other process. `finally` is what stops one bad
    // write becoming an outage.
    const disk = fakeDisk();
    const exploding: LockingFs = {
      ...disk.fs,
      writeAtomic: () => {
        throw new Error("disk full");
      },
    };
    const ledger = lockingFileLedger({ path: "/l.json", fs: exploding, now: disk.now });
    expect(() => ledger.spend(rec("r1"))).toThrow("disk full");
    expect(disk.files.has("/l.json.lock"), "the lock was left behind").toBe(false);
  });

  it("reclaims a lock abandoned by a dead process", () => {
    const disk = fakeDisk();
    disk.fs.tryCreateExclusive("/l.json.lock", "held by a process that died");
    disk.advance(60_000);
    const ledger = lockingFileLedger({
      path: "/l.json",
      fs: disk.fs,
      now: disk.now,
      staleAfterMs: 10_000,
    });
    ledger.spend(rec("r1"));
    expect(ledger.isSpent("r1" as ReceiptId)).toBe(true);
  });

  it("throws rather than silently skipping a spend it could not record", () => {
    // The one place this package prefers an exception. A ledger that quietly fails to record a spend
    // has permitted a replay, and a caller who never learns about it cannot compensate.
    const disk = fakeDisk();
    disk.fs.tryCreateExclusive("/l.json.lock", "held");
    const ledger = lockingFileLedger({
      path: "/l.json",
      fs: disk.fs,
      now: disk.now,
      maxAttempts: 3,
      staleAfterMs: Number.POSITIVE_INFINITY,
    });
    expect(() => ledger.spend(rec("r1"))).toThrow(LedgerLockError);
  });
});

describe("a guard on a locking ledger", () => {
  const receipt = admitUserConfirmedValue({
    candidate: "alice@ourcorp.com",
    presented: "Send to alice@ourcorp.com?",
    capability: "email_send",
    role: "sink_identity",
    argName: "to",
    lifts: "UNTRUSTED_EXTERNAL",
    scope: { nonce: "n", issuedAt: 0, expiresAt: null, source: null },
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
    receipts: [receipt].filter((r) => r !== undefined),
  };

  it("refuses a replay from a DIFFERENT process", () => {
    // The property that matters in deployment: two workers behind a load balancer, one confirmation.
    const disk = fakeDisk();
    const opts = { path: "/l.json", fs: disk.fs, now: disk.now };
    const workerOne = createGuard({ clock: () => 1, ledger: lockingFileLedger(opts) });
    const workerTwo = createGuard({ clock: () => 1, ledger: lockingFileLedger(opts) });

    expect(workerOne.decide(call).decision).toBe("ALLOW");
    const replay = workerTwo.decide(call);
    expect(replay.decision).not.toBe("ALLOW");
    expect(replay.reasons.map((r) => r.code)).toContain("receipt_already_consumed");
  });

  it("refuses a replay across a restart", () => {
    const disk = fakeDisk();
    const opts = { path: "/l.json", fs: disk.fs, now: disk.now };
    expect(
      createGuard({ clock: () => 1, ledger: lockingFileLedger(opts) }).decide(call).decision,
    ).toBe("ALLOW");
    expect(
      createGuard({ clock: () => 1, ledger: lockingFileLedger(opts) }).decide(call).decision,
    ).not.toBe("ALLOW");
  });
});
