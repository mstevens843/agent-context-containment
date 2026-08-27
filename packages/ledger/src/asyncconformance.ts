// A conformance suite for async ledgers, and the concurrency it actually interleaves.
//
// The sync suite in `conformance.ts` can check idempotence and durability by calling methods in
// order. None of that reaches the property an async ledger exists for: that two callers who overlap
// IN TIME cannot both win. Calling `reserve` twice in sequence proves nothing, because a store that
// reads-then-writes also passes when the read and the write cannot interleave.
//
// So these scenarios launch overlapping promises and only then await them. That is a real
// interleaving in one event loop - enough to catch a `has() then set()` adapter, which is the
// commonest way to get this wrong - and it is NOT enough to prove anything about two operating-system
// processes or two machines. `proveCrossHost` in `durable.ts` covers the shape of that argument; a
// real database covers the rest, and nothing in this repository can cover your deployment topology.
// Each of those three is a different claim and this file only makes the first.

import type { ReceiptId } from "@agent-context-containment/core";
import type { AsyncReceiptLedger } from "./async.js";

export interface AsyncCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

const id = (s: string): ReceiptId => s as unknown as ReceiptId;

/**
 * Run every scenario against a freshly-connected ledger.
 *
 * `connect` must return a handle to the SAME underlying store, as another process would see it. A
 * `connect` that hands back an isolated copy fails the shared-state scenarios, which is correct: that
 * is what a non-shared store is.
 */
export async function checkAsyncLedger(
  connect: () => AsyncReceiptLedger,
): Promise<readonly AsyncCheck[]> {
  const out: AsyncCheck[] = [];
  const check = async (name: string, fn: () => Promise<string>): Promise<void> => {
    let detail: string;
    try {
      detail = await fn();
    } catch (e) {
      detail = `threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    out.push({ name, passed: detail === "", detail });
  };

  await check("a reservation makes the receipt unavailable to anyone else", async () => {
    const a = connect();
    const b = connect();
    const first = await a.reserve([id("c1")], "act-a", 1);
    if (first.reserved.length !== 1) return "the first caller did not get the receipt";
    const second = await b.reserve([id("c1")], "act-b", 2);
    return second.alreadySpent.length === 1 && second.reserved.length === 0
      ? ""
      : "a second caller reserved a receipt the first already holds - this is a double-spend";
  });

  await check("concurrent reservations: exactly one caller wins", async () => {
    // The load-bearing scenario. Both calls are IN FLIGHT before either is awaited, so an adapter
    // that reads and then writes has a window between them. One that uses a single atomic operation
    // does not.
    const a = connect();
    const b = connect();
    const [x, y] = await Promise.all([
      a.reserve([id("c2")], "act-a", 1),
      b.reserve([id("c2")], "act-b", 1),
    ]);
    const winners = [x, y].filter((r) => r.reserved.length === 1).length;
    return winners === 1
      ? ""
      : `${winners} callers were told they reserved the same receipt; exactly one must be`;
  });

  await check("a released receipt becomes available again", async () => {
    // The invariant that makes refusals safe. A refused action must not burn a human's approval - the
    // corrected retry has to be able to use it.
    const a = connect();
    const r = await a.reserve([id("c3")], "act-a", 1);
    await a.release(r);
    const again = await connect().reserve([id("c3")], "act-b", 2);
    return again.reserved.length === 1
      ? ""
      : "a released receipt is still held - a refusal destroyed an approval it should have returned";
  });

  await check("a consumed receipt never becomes available again", async () => {
    const a = connect();
    const r = await a.reserve([id("c4")], "act-a", 1);
    await a.consume(r, 2);
    const again = await connect().reserve([id("c4")], "act-b", 3);
    return again.alreadySpent.length === 1
      ? ""
      : "a consumed receipt was reserved again - replay protection is not working";
  });

  await check("releasing a consumed receipt does nothing", async () => {
    // The mistake this catches is subtle and silent: a release guarded only by receipt id would free
    // a row another caller had already consumed, and freeing a row looks exactly like cleanup.
    const a = connect();
    const r = await a.reserve([id("c5")], "act-a", 1);
    await a.consume(r, 2);
    await a.release(r);
    const again = await connect().reserve([id("c5")], "act-b", 3);
    return again.alreadySpent.length === 1
      ? ""
      : "releasing after consuming freed the receipt - this hands out a replay";
  });

  await check("one caller cannot release another's reservation", async () => {
    const a = connect();
    const b = connect();
    const mine = await a.reserve([id("c6")], "act-a", 1);
    // A forged handle carrying somebody else's receipt id.
    await b.release({ id: "not-my-reservation", reserved: [id("c6")], alreadySpent: [] });
    const stillMine = await connect().reserve([id("c6")], "act-c", 2);
    return stillMine.alreadySpent.length === 1
      ? ""
      : `a caller released a reservation it did not hold (${mine.id})`;
  });

  await check("consume and release are safe on an unknown reservation", async () => {
    // They run in the unwind path of a decision. A throw there turns a policy refusal into an
    // exception, and the caller's catch block around it is the bypass.
    const a = connect();
    await a.consume({ id: "nope", reserved: [id("c7")], alreadySpent: [] }, 1);
    await a.release({ id: "nope", reserved: [id("c7")], alreadySpent: [] });
    return "";
  });

  await check("a partial reservation reports both halves", async () => {
    const a = connect();
    await a.consume(await a.reserve([id("c8")], "act-a", 1), 2);
    const mixed = await connect().reserve([id("c8"), id("c9")], "act-b", 3);
    if (mixed.alreadySpent.length !== 1) return "the consumed id was not reported as already spent";
    return mixed.reserved.length === 1
      ? ""
      : "the fresh id was not reserved; one unavailable receipt must not block the others";
  });

  await check("a restart sees what was consumed", async () => {
    const a = connect();
    await a.consume(await a.reserve([id("c10")], "act-a", 1), 2);
    return (await connect().isSpent(id("c10")))
      ? ""
      : "a newly-connected caller cannot see an earlier consumption - every restart resets replay protection";
  });

  await check("entries records consumptions and not reservations", async () => {
    // An audit trail listing reservations would report actions that never happened.
    const a = connect();
    await a.reserve([id("c11")], "act-reserved-only", 1);
    await a.consume(await a.reserve([id("c12")], "act-consumed", 2), 3);
    const ids = (await connect().entries()).map((e) => e.receipt as unknown as string);
    if (!ids.includes("c12")) return "a consumed receipt is missing from the audit trail";
    return ids.includes("c11")
      ? "an un-consumed reservation appears in the audit trail as if the action happened"
      : "";
  });

  await check("guarantees are declared and internally consistent", async () => {
    const g = connect().guarantees;
    if (!g.singleProcess) return "an adapter that is not single-process safe cannot be used at all";
    if (g.crossHostSafe && !g.singleHost) return "claims cross-host without single-host safety";
    if (g.crossHostSafe && !g.crashSafe) return "claims cross-host without surviving a crash";
    if (g.caveat.trim().length < 20) return "the caveat is too thin to act on";
    return "";
  });

  return out;
}

export function formatAsyncChecks(checks: readonly AsyncCheck[]): string {
  const lines = checks.map(
    (c) => `  ${c.passed ? "pass" : "FAIL"}  ${c.name}${c.passed ? "" : `\n        ${c.detail}`}`,
  );
  const failed = checks.filter((c) => !c.passed).length;
  lines.push("");
  lines.push(
    failed === 0
      ? `  ${checks.length}/${checks.length} - the adapter honours the reservation protocol.`
      : `  ${failed} of ${checks.length} FAILED. Each one is a double-spend or a destroyed approval.`,
  );
  return lines.join("\n");
}
