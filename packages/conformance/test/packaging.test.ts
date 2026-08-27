// What actually ships, asserted against the manifests rather than against intent.
//
// `npm pack --dry-run` at v1.0 finalization showed all five packages shipping **without a LICENSE
// file** — MIT declared in every `package.json`, MIT nowhere in any tarball. `PUBLISHING.md` had
// carried "LICENSE at the root and in each published package" as a checklist line since the first
// release pass, and a checklist line is a thing somebody reads once. npm auto-includes `LICENSE`
// only when it sits in the package directory, and it sat only at the repo root.
//
// So the packaging rules are tests now. Each one is a property of the tarball a stranger installs,
// and each was watched to fail. See DEFECTS_FOUND.md §22.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");
const PKG_DIR = join(REPO, "packages");
const PACKAGES = readdirSync(PKG_DIR).filter((d) => existsSync(join(PKG_DIR, d, "package.json")));

interface Manifest {
  readonly name?: string;
  readonly version?: string;
  readonly license?: string;
  readonly files?: readonly string[];
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly publishConfig?: { readonly access?: string };
  readonly repository?: unknown;
  readonly private?: boolean;
}

const manifest = (p: string): Manifest =>
  JSON.parse(readFileSync(join(PKG_DIR, p, "package.json"), "utf8")) as Manifest;

describe("every published package ships what its manifest promises", () => {
  it("declares MIT and ships the LICENSE that says so", () => {
    // The defect this file was written for. A package declaring a licence it does not include is a
    // legal claim with no artifact behind it - the packaging equivalent of a PROVEN claim with no
    // test, which is what this whole repository is about.
    for (const p of PACKAGES) {
      const m = manifest(p);
      if (m.private === true) continue;
      expect(m.license, `${p} declares no license`).toBe("MIT");
      expect(
        existsSync(join(PKG_DIR, p, "LICENSE")),
        `${p} declares MIT and has no LICENSE file - npm only auto-includes one from the package directory, and the root LICENSE does not travel`,
      ).toBe(true);
      expect(
        m.files?.includes("LICENSE"),
        `${p} has a LICENSE file but does not list it in "files" - it ships only by npm's implicit rule, which is not a thing to rely on`,
      ).toBe(true);
    }
  });

  it("ships a README a stranger can read before installing", () => {
    for (const p of PACKAGES) {
      if (manifest(p).private === true) continue;
      expect(existsSync(join(PKG_DIR, p, "README.md")), `${p} ships no README`).toBe(true);
    }
  });

  it("ships dist and nothing else", () => {
    // `files` is the allowlist. Corpus, tests and sources must never travel: the frozen holdout is an
    // instrument, and an instrument that ships loses the property that makes it one.
    for (const p of PACKAGES) {
      const m = manifest(p);
      if (m.private === true) continue;
      expect(
        m.files,
        `${p} has no "files" allowlist - it would ship the whole directory`,
      ).toBeDefined();
      for (const entry of m.files ?? []) {
        expect(
          ["dist", "LICENSE", "README.md"].includes(entry),
          `${p} ships "${entry}", which is not dist, LICENSE or README`,
        ).toBe(true);
      }
    }
  });

  it("carries no database driver, or any other runtime dependency outside the scope", () => {
    // `pg` is a ROOT devDependency and must stay one. "No driver in the path of a policy decision"
    // is a claim several documents make; this is what makes it checkable.
    for (const p of PACKAGES) {
      const m = manifest(p);
      for (const dep of Object.keys(m.dependencies ?? {})) {
        expect(
          dep.startsWith("@agent-context-containment/"),
          `${p} takes a runtime dependency on "${dep}". The published surface is meant to be this workspace and nothing else - "pg" in particular must stay a root devDependency`,
        ).toBe(true);
      }
    }
  });

  it("is published under the one agreed scope, publicly, with a repository", () => {
    for (const p of PACKAGES) {
      const m = manifest(p);
      if (m.private === true) continue;
      expect(
        m.name?.startsWith("@agent-context-containment/"),
        `${p} is named "${m.name}", outside the agreed scope`,
      ).toBe(true);
      expect(
        m.publishConfig?.access,
        `${p} does not set publishConfig.access - a scoped package defaults to restricted and the publish fails or goes private`,
      ).toBe("public");
      expect(m.repository, `${p} names no repository`).toBeDefined();
    }
  });

  it("all five packages carry the same version", () => {
    // They are released together and depend on each other by `workspace:*`. A version skew means a
    // consumer can resolve a combination that was never tested as a set.
    const versions = new Map<string, string>();
    for (const p of PACKAGES) {
      const m = manifest(p);
      if (m.private === true) continue;
      versions.set(p, m.version ?? "(none)");
    }
    const distinct = new Set(versions.values());
    expect(
      distinct.size,
      `the packages are on different versions: ${[...versions].map(([p, v]) => `${p}@${v}`).join(", ")}`,
    ).toBe(1);
  });
});

// ---- the task graph, because a warm cache hides the only failure mode -----------------------------
describe("the test task waits for the build it reads from", () => {
  // WHY THIS IS A TEST AND NOT A COMMENT IN turbo.json. Turbo rejects unknown keys, so the config
  // cannot carry its own reasoning, and the failure it prevents is invisible locally: on a warm
  // cache no task runs at all.
  //
  // Every package imports ITSELF by name in at least one test - `packages/ledger/test/
  // guarantees.test.ts` imports `@agent-context-containment/ledger` - so a test run reads the
  // package's own `dist`. `^build` orders UPSTREAM builds only, so each package's build was
  // scheduled concurrently with its own tests, and every `tsup.config.ts` sets `clean: true`: the
  // build empties `dist` while the tests are importing out of it.
  //
  // Measured on `turbo test --force`: three consecutive runs gave 89 passed, then
  // `Test Files 1 failed | 5 passed` with 57 tests, then `2 failed | 4 passed` with 37 - each with
  // ZERO individual test failures, because the files died at import and their tests were never
  // counted. A suite that reports every test passing and exits 1 is worse than a red one: the
  // natural response is to re-run it until it is green. See DEFECTS_FOUND.md §37.
  const turbo = JSON.parse(readFileSync(join(REPO, "turbo.json"), "utf8")) as {
    tasks: Record<string, { dependsOn?: string[] }>;
  };

  for (const task of ["test", "typecheck"]) {
    it(`\`${task}\` depends on its own package's build, not only on upstream builds`, () => {
      const deps = turbo.tasks[task]?.dependsOn ?? [];
      expect(deps, `turbo.json has no \`${task}\` task`).toBeDefined();
      expect(
        deps,
        `\`${task}\` does not wait for its own build, so it races a cleaning tsup on a cold cache`,
      ).toContain("build");
    });
  }

  it("every package's build does clean, which is what makes the ordering load-bearing", () => {
    // The near-miss: if no build cleaned, the ordering above would be a preference rather than a
    // correctness requirement, and this file would be asserting a style rule.
    const cleaning = PACKAGES.filter((p) => {
      const cfg = join(PKG_DIR, p, "tsup.config.ts");
      return existsSync(cfg) && /clean:\s*true/.test(readFileSync(cfg, "utf8"));
    });
    expect(
      cleaning.length,
      "no package cleans its dist - re-check why the ordering matters",
    ).toBeGreaterThan(0);
  });

  it("at least one test really does import its own package by name", () => {
    // The other half of the near-miss. If nothing self-imported, the race could not happen and the
    // rule above would be guarding a hazard that does not exist.
    const selfImporters = PACKAGES.filter((p) => {
      const dir = join(PKG_DIR, p, "test");
      if (!existsSync(dir)) return false;
      return readdirSync(dir).some((f) =>
        readFileSync(join(dir, f), "utf8").includes(`from "@agent-context-containment/${p}"`),
      );
    });
    expect(
      selfImporters.length,
      "no test imports its own package, so the dist race is not reachable",
    ).toBeGreaterThan(0);
  });
});
