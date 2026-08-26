// The cross-domain demos, pinned.
//
// A demo is documentation that runs, which makes it the kind of documentation that rots silently: a
// ceiling changes, a demo starts printing ALLOW where its own comment says REFUSED, and nothing
// fails. So the outcomes are asserted here, by running the same scripts a reader runs.
//
// The claim being defended is specific. Four domains - email, DevOps, support, payments - with
// nothing in common at the level of tools, vocabulary or consequence, and no domain logic anywhere in
// the engine. If containment were a wallet-safety idea wearing a general name, three of the four
// would need special cases. These tests fail if any of them starts to.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");
const AGENTS = join(REPO, "examples", "agents");

const run = (file: string): string =>
  execFileSync("npx", ["tsx", join(AGENTS, file)], { cwd: REPO, encoding: "utf8" });

const out = run("all.ts");

describe("cross-domain agent demos", () => {
  it("all four domains run and report", () => {
    for (const domain of ["EMAIL", "DEVOPS", "SUPPORT", "CODE", "PAYMENTS"]) {
      expect(out, `the ${domain} demo did not run`).toContain(domain);
    }
  });

  it("the outcomes are what the demos claim, per domain", () => {
    // Pinned exactly. A change here is either a policy change worth explaining or a demo whose prose
    // has drifted from what it prints - and both should stop a build.
    const line = (name: string) =>
      out
        .split("\n")
        .find((l) => l.trimStart().startsWith(name))
        ?.trim()
        .split(/\s+/) ?? [];
    const rows: readonly [string, number, number, number, number][] = [
      // demo prefix, done, review, refused, receipts burned
      ["An inbox message", 2, 0, 2, 1],
      ["A log line", 3, 0, 2, 0],
      ["A ticket tries", 2, 0, 3, 2],
      ["An issue and a vendored README", 4, 0, 3, 0],
      ["Token metadata", 3, 1, 2, 1],
    ];
    for (const [prefix, done, review, refused, burned] of rows) {
      const cells = line(prefix).slice(-4).map(Number);
      expect(cells, `${prefix}: outcome drifted`).toEqual([done, review, refused, burned]);
    }
  });

  it("every domain both stops something and completes something", () => {
    // The property that distinguishes a policy from an off switch, checked per domain rather than in
    // aggregate - a total can hide a domain where nothing useful survives.
    const summary = out.slice(out.indexOf("ACROSS ALL DOMAINS"));
    const rows = summary
      .split("\n")
      .filter((l) => /\s\d+\s+\d+\s+\d+\s+\d+\s*$/.test(l))
      .map((l) => l.trim().split(/\s+/).slice(-4).map(Number));
    // Five domains since v1.0 added the code agent. Pinned rather than derived, because the point of
    // this test is that a DOMAIN did not silently disappear from the demo set.
    expect(rows.length, "the summary table lost a row").toBe(5);
    for (const [done, review, refused] of rows) {
      expect(done ?? 0, "a domain completed no useful work at all").toBeGreaterThan(0);
      expect((review ?? 0) + (refused ?? 0), "a domain stopped nothing").toBeGreaterThan(0);
    }
  });

  it("the ledger actually refuses a replay, it is not just described", () => {
    expect(
      out,
      "no demo shows a burned receipt being refused on retry - the replay claim is unillustrated",
    ).toContain("receipt_already_consumed");
  });

  it("a tuple receipt is exercised, not just documented", () => {
    expect(out, "no demo reaches the tuple gate").toContain("tuple_confirmed");
  });

  it("all four decisions appear across the demo set", () => {
    // If a demo set never produces NEEDS_REVIEW, the prepare/broadcast split is being asserted rather
    // than shown.
    for (const mark of ["ALLOW", "DENY", "REVIEW", "DECLASS"]) {
      expect(out, `no demo produces ${mark}`).toContain(mark);
    }
  });

  it("no demo reaches for the raw engine", () => {
    // They must model the path docs/INTEGRATION.md recommends. A demo that called `advanced.decide`
    // would be documentation of a thing nobody should copy.
    for (const f of readdirSync(AGENTS)) {
      if (!f.endsWith(".ts")) continue;
      const src = readFileSync(join(AGENTS, f), "utf8");
      expect(src.includes("advanced.decide"), `${f} uses the raw engine instead of the guard`).toBe(
        false,
      );
    }
    expect(
      readFileSync(join(AGENTS, "harness.ts"), "utf8"),
      "the harness does not route through createGuard",
    ).toContain("createGuard");
  });

  it("the engine contains no domain vocabulary", () => {
    // The load-bearing test for the generality claim. If the policy table ever learns what a refund
    // or a deploy is, the four demos stop being evidence of anything.
    const policy = readFileSync(join(REPO, "packages", "core", "src", "policy.ts"), "utf8");
    const code = policy
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
      .join("\n");
    // WHAT THIS LIST IS AND IS NOT. These are business-domain terms whose presence would mean the
    // engine branches on a domain. `wallet` is deliberately NOT here: `wallet_sign` is a capability
    // name, it appears four times in policy.ts, and the claim is about the engine not special-casing
    // a domain rather than about the absence of a substring. Its BEHAVIOUR is domain-independent -
    // irreversible, full egress, nothing lifts it - and only its name references a domain.
    //
    // An adversarial audit caught `docs/claims.json` asserting "no wallet" against a list that never
    // scanned for it. The test was right; the claim about the test was not. See DEFECTS_FOUND.md §17.
    for (const word of ["refund", "ticket", "deploy", "kubernetes", "invoice", "solana", "USDC"]) {
      expect(
        new RegExp(word, "i").test(code),
        `the policy engine's code mentions "${word}" - it has learned a domain`,
      ).toBe(false);
    }
  });

  it("the demos are deterministic: two runs print the same bytes", () => {
    // No clock, no randomness, no network. A demo whose output moves cannot be pinned, and a reader
    // could not tell a policy change from the time of day.
    expect(run("all.ts")).toBe(out);
  });
});
