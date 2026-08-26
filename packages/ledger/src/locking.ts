// A durable ledger that is safe across processes.
//
// `jsonFileLedger` is not. Two processes read the same file, each adds a receipt, each writes back,
// and one record is lost - and a lost record is a PERMITTED REPLAY. That failure is silent, it needs
// concurrency to show up, and it therefore does not appear in development and does appear in
// production.
//
// WHY NOT SQLITE. Node 22 ships `node:sqlite` as experimental, and `better-sqlite3` is a native
// module with a build step. Either would put a compiled dependency in the path of a policy decision
// to store a set of short strings. The access pattern here is append-mostly over a few thousand ids,
// so the honest amount of machinery is a lock and an atomic rename - both of which the filesystem
// already provides.
//
// HOW IT IS SAFE:
//
//   MUTUAL EXCLUSION comes from `open(lock, "wx")`, which fails if the file exists. That flag maps
//   to O_CREAT|O_EXCL, and the create-if-absent test is atomic in the kernel, so exactly one process
//   wins the race regardless of how many are trying.
//
//   DURABILITY comes from writing a temp file and renaming it over the target. `rename` within a
//   filesystem is atomic, so a reader sees the old file or the new one and never a half-written one.
//   A crash mid-write leaves the original intact.
//
//   STALE LOCKS are reclaimed by age. A process that dies holding the lock would otherwise wedge
//   every other process forever, which converts a crash into an outage.
//
// WHERE IT IS STILL NOT SAFE, stated rather than discovered later:
//
//   NFS and most network filesystems, where O_EXCL and rename atomicity are not reliable.
//   Across hosts, for the same reason - this is single-machine mutual exclusion.
//   Against a stale-lock reclaim racing a slow-but-alive holder. The window is the timeout, and the
//   fix is a real store, not a longer timeout.

import type { ReceiptLedger, SpentRecord } from "./index.js";
import { memoryLedger } from "./index.js";

/**
 * The filesystem operations this needs, injected.
 *
 * Injected rather than importing `node:fs` so the ledger can be driven deterministically in a test -
 * including the concurrency cases, which are the entire reason this file exists and which cannot be
 * exercised reliably against a real disk.
 */
export interface LockingFs {
  readFile(path: string): string | undefined;
  /** Write via a temp file and rename. Implementations MUST make the rename atomic. */
  writeAtomic(path: string, contents: string): void;
  /**
   * Create `path` exclusively. MUST fail if it already exists - `open(..., "wx")`.
   *
   * Returning true when the file existed defeats the whole mechanism, so an implementation that
   * cannot offer O_EXCL should throw rather than approximate it.
   */
  tryCreateExclusive(path: string, contents: string): boolean;
  remove(path: string): void;
  /** Milliseconds since the file was created, or undefined if it is gone. For stale reclaim. */
  ageMs(path: string): number | undefined;
}

export interface LockingLedgerOptions {
  readonly path: string;
  readonly fs: LockingFs;
  /** Injected so a test can drive the retry loop without sleeping. */
  readonly now: () => number;
  /** How many acquisition attempts before giving up. */
  readonly maxAttempts?: number;
  /** A lock older than this is presumed abandoned by a dead process. */
  readonly staleAfterMs?: number;
}

/** Raised when the lock cannot be taken. Deliberately not swallowed - see the note on `spend`. */
export class LedgerLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerLockError";
  }
}

/**
 * A ledger that takes a lock around every mutation.
 *
 * READS ARE UNLOCKED and that is deliberate. `isSpent` returning a stale `false` cannot admit a
 * replay on its own, because the write path re-reads under the lock before deciding - so the
 * authoritative check happens where the mutual exclusion is. Locking reads would double the
 * contention to protect an answer that is re-derived anyway.
 */
export function lockingFileLedger(options: LockingLedgerOptions): ReceiptLedger {
  const { path, fs, now } = options;
  const maxAttempts = options.maxAttempts ?? 50;
  const staleAfterMs = options.staleAfterMs ?? 10_000;
  const lockPath = `${path}.lock`;

  const read = (): SpentRecord[] => {
    const raw = fs.readFile(path);
    if (raw === undefined || raw.trim() === "") return [];
    return JSON.parse(raw) as SpentRecord[];
  };

  const withLock = <T>(fn: () => T): T => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (fs.tryCreateExclusive(lockPath, String(now()))) {
        try {
          return fn();
        } finally {
          fs.remove(lockPath);
        }
      }
      // Somebody holds it. If they have held it implausibly long they are probably dead, and leaving
      // the lock in place would turn one crashed process into a permanent outage for every other.
      const age = fs.ageMs(lockPath);
      if (age !== undefined && age > staleAfterMs) fs.remove(lockPath);
    }
    // Deliberately thrown rather than returned as a silent no-op. A ledger that quietly fails to
    // record a spend has permitted a replay, and that is the one outcome worse than an exception.
    throw new LedgerLockError(
      `could not acquire ${lockPath} after ${maxAttempts} attempts; refusing to record a spend unrecorded, because an unrecorded spend is a permitted replay`,
    );
  };

  return {
    guarantees: {
      singleProcess: true,
      singleHost: true,
      // NOT claimed, and the reason is specific rather than cautious. `tryCreateExclusive` rests on
      // O_EXCL, which is atomic on a local filesystem and famously not on NFS - and stale reclaim
      // makes it worse across hosts, not better: two machines with clocks a few seconds apart can
      // each decide the other's live lock is stale and remove it. Cross-host callers want a store
      // with real transactions behind the `ReceiptLedger` interface.
      crossHostSafe: false,
      crashSafe: true,
      staleLockReclaim: true,
      caveat: `safe for several processes on one machine; over NFS or across hosts the O_EXCL lock is not atomic and stale reclaim can drop a live lock (stale after ${staleAfterMs}ms)`,
    },
    isSpent: (receipt) => read().some((r) => r.receipt === receipt),
    spend: (record) =>
      withLock(() => {
        // Re-read INSIDE the lock. Anything read before acquiring it may already be stale, and this
        // re-read is what makes the whole thing correct: the check and the write are one critical
        // section, so two processes cannot both observe "not spent" and both append.
        //
        // The re-read is also what makes the RETURN VALUE trustworthy - it is decided inside the same
        // critical section as the write, so exactly one process is told "recorded". Reporting that
        // outward is defect §10's fix; the lock was already correct and the answer was thrown away.
        const current = read();
        if (current.some((r) => r.receipt === record.receipt)) return "already_spent" as const;
        fs.writeAtomic(path, `${JSON.stringify([...current, record], null, 2)}\n`);
        return "recorded" as const;
      }),
    entries: () => read(),
  };
}

/**
 * `LockingFs` over `node:fs`, wired for real use.
 *
 * Kept as a factory taking the module rather than importing it, so this file has no I/O import of
 * its own and a caller decides what "the filesystem" means.
 */
export function nodeLockingFs(nodeFs: {
  readFileSync: (p: string, e: string) => string;
  writeFileSync: (p: string, c: string, o?: unknown) => void;
  renameSync: (a: string, b: string) => void;
  unlinkSync: (p: string) => void;
  statSync: (p: string) => { birthtimeMs: number };
  existsSync: (p: string) => boolean;
}): LockingFs {
  return {
    readFile: (p) => (nodeFs.existsSync(p) ? nodeFs.readFileSync(p, "utf8") : undefined),
    writeAtomic: (p, contents) => {
      const tmp = `${p}.tmp`;
      nodeFs.writeFileSync(tmp, contents, "utf8");
      nodeFs.renameSync(tmp, p);
    },
    tryCreateExclusive: (p, contents) => {
      try {
        // "wx" is O_CREAT|O_EXCL. The whole mutual-exclusion guarantee is this one flag.
        nodeFs.writeFileSync(p, contents, { flag: "wx" });
        return true;
      } catch {
        return false;
      }
    },
    remove: (p) => {
      try {
        nodeFs.unlinkSync(p);
      } catch {
        // Already gone. Removing a lock that is not there is the desired end state either way.
      }
    },
    ageMs: (p) => {
      try {
        return Date.now() - nodeFs.statSync(p).birthtimeMs;
      } catch {
        return undefined;
      }
    },
  };
}

/** Re-exported for callers building their own ledger stack. */
export { memoryLedger };
