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
