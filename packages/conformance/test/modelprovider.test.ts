// The model-provider layer, driven entirely by a MOCKED exec.
//
// NOT ONE TEST HERE CALLS A LIVE MODEL. A test that needed Codex or Claude Code installed and signed
// in is a test that is skipped on every other machine and in CI, which makes it a test nobody runs.
// The `exec` function is injected, so every branch - a CLI that is absent, one that fails, one that
// answers with prose, one that answers with broken JSON - is reachable deterministically.
//
// What this file is protecting is narrow and worth stating: the providers exist so the OPTIONAL model
// modes can use a local plan/OAuth session instead of a raw API key. Nothing they return is ever test
// truth, and no number in this repository depends on any of it. See DEFECTS_FOUND.md section 42.

import { describe, expect, it } from "vitest";
// @ts-expect-error - a plain .mjs script helper, deliberately not part of any package's build
// biome-ignore format: the ts-expect-error must apply to the module import line
import { PROVIDERS, askJson, firstJsonObject, makeProviders, resolveProvider } from "../../../scripts/lib/model-provider.mjs";

/** A fake CLI. `replies` maps a binary name to what running it should look like. */
const fakeExec =
  (replies: Record<string, { stdout?: string; failed?: boolean; code?: number }>) =>
  async (file: string, args: readonly string[]) => {
    const r = replies[file];
    if (r === undefined) {
      return { code: 127, stdout: "", stderr: "", failed: true, message: "not found" };
    }
    // `--version` is the availability probe; a present CLI answers it.
    if (args[0] === "--version") {
      return { code: 0, stdout: "1.0.0", stderr: "", failed: false, message: "" };
    }
    return {
      code: r.code ?? 0,
      stdout: r.stdout ?? "",
      stderr: "",
      failed: r.failed ?? false,
      message: r.failed === true ? "boom" : "",
    };
  };

describe("pulling JSON out of a model's reply", () => {
  it("takes the first BALANCED object, not everything up to the last brace", () => {
    // THE BUG THIS REPLACED. The original judge used /\{[\s\S]*\}/, which spans to the LAST brace
    // anywhere in the reply - so a model that answered and then showed an example produced a string
    // that parses as neither. Depth counting stops at the first complete object.
    expect(firstJsonObject('here you go {"a":1} and for example {"b":2}')).toBe('{"a":1}');
  });

  it("handles nesting", () => {
    expect(firstJsonObject('x {"a":{"b":[1,2]}} y')).toBe('{"a":{"b":[1,2]}}');
  });

  it("ignores braces inside strings, including escaped quotes", () => {
    expect(firstJsonObject('{"a":"}"}')).toBe('{"a":"}"}');
    expect(firstJsonObject('{"a":"\\"}"}')).toBe('{"a":"\\"}"}');
  });

  it("returns undefined rather than throwing when there is no object", () => {
    expect(firstJsonObject("no json here")).toBeUndefined();
    expect(firstJsonObject("{unclosed")).toBeUndefined();
    expect(firstJsonObject(undefined as never)).toBeUndefined();
  });
});

describe("choosing a provider", () => {
  it("uses the one that is asked for", async () => {
    const providers = makeProviders({ exec: fakeExec({ codex: {}, claude: {} }) });
    const r = await resolveProvider({ env: { MODEL_JUDGE_PROVIDER: "codex" }, providers });
    expect(r.provider?.name).toBe("codex");
  });

  it("does NOT auto-select an installed CLI when none was asked for", async () => {
    // THE SURPRISE THIS AVOIDS. `pnpm judge:model` has been inert on every developer machine for its
    // whole life. If it auto-selected an installed CLI, the day someone installed Codex it would
    // silently begin spending plan quota - a script that was free yesterday and bills today. Asking
    // for a provider is one environment variable. See DEFECTS_FOUND.md section 42.
    const providers = makeProviders({ exec: fakeExec({ codex: {}, claude: {} }), env: {} });
    const r = await resolveProvider({ env: {}, providers });
    expect(r.provider, "an installed CLI was selected without being asked for").toBeUndefined();
    expect(r.skip).toMatch(/MODEL_JUDGE_PROVIDER/);
  });

  it("but uses one the moment it IS asked for, even with no key in the environment", async () => {
    const providers = makeProviders({ exec: fakeExec({ claude: {} }), env: {} });
    const r = await resolveProvider({ env: { MODEL_JUDGE_PROVIDER: "claude-code" }, providers });
    expect(r.provider?.name).toBe("claude-code");
  });

  it("skips, rather than throwing, when nothing is usable", async () => {
    // THE STATE EVERY CI RUN IS IN, and the reason the caller exits 0. A pipeline that calls the
    // model runs unconditionally must stay green on a machine with no model.
    const providers = makeProviders({ exec: fakeExec({}), env: {} });
    const r = await resolveProvider({ env: {}, providers });
    expect(r.provider).toBeUndefined();
    expect(r.skip).toMatch(/ANTHROPIC_API_KEY is not set/);
  });

  it("skips when the requested provider is not installed, and says which", async () => {
    const providers = makeProviders({ exec: fakeExec({ claude: {} }) });
    const r = await resolveProvider({ env: { MODEL_JUDGE_PROVIDER: "codex" }, providers });
    expect(r.skip).toMatch(/codex/);
  });

  it("refuses a provider name it does not have", async () => {
    const providers = makeProviders({ exec: fakeExec({ codex: {} }) });
    const r = await resolveProvider({
      env: { MODEL_JUDGE_PROVIDER: "gpt5-by-carrier-pigeon" },
      providers,
    });
    expect(r.skip).toMatch(/unknown provider/);
  });

  it("never requires ANTHROPIC_API_KEY for the CLI providers", async () => {
    // The whole point of this layer: asked for by name, with an entirely empty environment, a CLI
    // provider resolves and its auth story mentions no API key.
    const providers = makeProviders({ exec: fakeExec({ codex: {} }), env: {} });
    const r = await resolveProvider({ env: { MODEL_JUDGE_PROVIDER: "codex" }, providers });
    expect(r.provider?.name).toBe("codex");
    expect(r.provider?.auth).not.toMatch(/ANTHROPIC_API_KEY/);
  });

  it("the anthropic-api provider is available only with a key", async () => {
    const withKey = makeProviders({ exec: fakeExec({}), env: { ANTHROPIC_API_KEY: "sk-test" } });
    expect(await withKey["anthropic-api"].available()).toBe(true);
    const without = makeProviders({ exec: fakeExec({}), env: {} });
    expect(await without["anthropic-api"].available()).toBe(false);
  });

  it("every advertised provider exists in the set", () => {
    const providers = makeProviders({ exec: fakeExec({}) });
    for (const name of PROVIDERS)
      expect(providers[name], `${name} is advertised but absent`).toBeDefined();
  });
});

describe("what comes back from a provider", () => {
  const codexOnly = (stdout: string, failed = false) =>
    makeProviders({ exec: fakeExec({ codex: { stdout, failed } }) }).codex;

  it("parses a clean JSON reply", async () => {
    const out = await askJson(codexOnly('{"label":"benign","why":"fine"}'), "prompt");
    expect(out).toEqual({ label: "benign", why: "fine" });
  });

  it("digs the JSON out of a reply wrapped in prose", async () => {
    const out = await askJson(
      codexOnly('Sure!\n\n{"label":"attack","why":"x"}\n\nHope that helps.'),
      "p",
    );
    expect(out).toEqual({ label: "attack", why: "x" });
  });

  it("records a reply with no JSON as an ERROR, never as a silent skip", async () => {
    // THE RULE THIS LAYER EXISTS TO KEEP. A judge that drops the replies it cannot read reports a
    // denominator that means nothing - the vacuity this repository keeps finding in its own checks.
    const out = await askJson(codexOnly("I would rather not answer that."), "p");
    expect(out.error).toMatch(/no JSON object/);
  });

  it("records malformed JSON as an error, with the reason", async () => {
    const out = await askJson(codexOnly('{"label": "benign", }'), "p");
    expect(out.error).toMatch(/unparseable JSON/);
  });

  it("records a failed CLI as an error rather than throwing", async () => {
    const out = await askJson(codexOnly("", true), "p");
    expect(out.error).toMatch(/codex exited/);
  });

  it("unwraps the claude-code envelope and finds the result", async () => {
    const p = makeProviders({
      exec: fakeExec({
        claude: {
          stdout: JSON.stringify({ is_error: false, result: '{"label":"benign","why":"ok"}' }),
        },
      }),
    })["claude-code"];
    expect(await askJson(p, "prompt")).toEqual({ label: "benign", why: "ok" });
  });

  it("treats a claude-code error envelope as an error", async () => {
    const p = makeProviders({
      exec: fakeExec({
        claude: { stdout: JSON.stringify({ is_error: true, result: "rate limited" }) },
      }),
    })["claude-code"];
    expect((await askJson(p, "prompt")).error).toMatch(/rate limited/);
  });

  it("falls back to the raw text when the envelope is not what was expected", async () => {
    // A CLI that changes its output shape must degrade to "try to read it" rather than to a crash.
    const p = makeProviders({
      exec: fakeExec({ claude: { stdout: 'not an envelope {"label":"benign","why":"ok"}' } }),
    })["claude-code"];
    expect(await askJson(p, "prompt")).toEqual({ label: "benign", why: "ok" });
  });
});

describe("the CLI invocations are the safe ones", () => {
  // These providers hand a model a prompt built from UNTRUSTED CORPUS CONTENT - the attack strings
  // are the input. A coding agent with write access pointed at that is the wrong shape, and this
  // repository would be a strange place to be careless about it.
  const captured: { file: string; args: readonly string[]; stdin?: string }[] = [];
  const recorder = async (file: string, args: readonly string[], stdin?: string) => {
    captured.push({ file, args, stdin });
    if (args[0] === "--version") {
      return { code: 0, stdout: "1", stderr: "", failed: false, message: "" };
    }
    return { code: 0, stdout: '{"ok":true}', stderr: "", failed: false, message: "" };
  };

  it("codex runs read-only, ephemeral, and ignoring local config", async () => {
    captured.length = 0;
    await makeProviders({ exec: recorder }).codex.ask("hello", undefined);
    const call = captured.find((c) => c.args[0] === "exec");
    expect(call, "codex was never invoked").toBeDefined();
    expect(call?.args).toContain("--ephemeral");
    expect(call?.args).toContain("--ignore-user-config");
    expect(call?.args.join(" ")).toContain("-s read-only");
    expect(call?.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("codex takes the prompt on stdin, not on the command line", async () => {
    // The prompt carries attack strings and can be long. argv is the wrong place for either.
    captured.length = 0;
    await makeProviders({ exec: recorder }).codex.ask("PROMPT-BODY", undefined);
    const call = captured.find((c) => c.args[0] === "exec");
    expect(call?.stdin).toBe("PROMPT-BODY");
    expect(call?.args.join(" ")).not.toContain("PROMPT-BODY");
  });

  it("claude runs with no tools enabled", async () => {
    captured.length = 0;
    await makeProviders({ exec: recorder })["claude-code"].ask("hello");
    const call = captured.find((c) => c.args.includes("-p"));
    expect(call?.args).toContain("--allowed-tools");
    expect(call?.args[call.args.indexOf("--allowed-tools") + 1]).toBe("");
    expect(call?.stdin).toBe("hello");
  });

  it("no provider puts a credential on a command line", async () => {
    captured.length = 0;
    const set = makeProviders({ exec: recorder, env: { ANTHROPIC_API_KEY: "sk-secret-value" } });
    await set.codex.ask("hello", undefined);
    await set["claude-code"].ask("hello");
    for (const c of captured) {
      expect(c.args.join(" "), "a credential reached argv").not.toContain("sk-secret-value");
      expect(c.args.join(" ")).not.toMatch(/CLAUDE_CODE_OAUTH_TOKEN/);
    }
  });
});
