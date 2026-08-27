// Where a live model comes from, for the OPTIONAL and NON-AUTHORITATIVE model runs.
//
// Nothing in this file affects a single number this repository publishes. It exists so that the two
// supplementary model modes can run against a local CLI the developer has already signed into,
// rather than requiring a raw API key and a billing relationship to try them. See
// DEFECTS_FOUND.md section 42.
//
// THREE PROVIDERS, chosen by MODEL_JUDGE_PROVIDER:
//
//   codex         `codex exec`, using the local Codex plan/session auth in CODEX_HOME.
//   claude-code   `claude -p`, using Claude Code's own auth (plan or CLAUDE_CODE_OAUTH_TOKEN).
//   anthropic-api the original path. Requires ANTHROPIC_API_KEY and bills the API directly.
//
// THE CLI PROVIDERS ARE OPT-IN, and that is deliberate. With no `MODEL_JUDGE_PROVIDER` set, only
// `anthropic-api` is considered - so a machine with no key skips, exactly as it did before this file
// existed. Auto-selecting an installed CLI would mean `pnpm judge:model`, which has been inert on
// every developer machine for its whole life, silently starting to spend plan quota the day someone
// installed Codex. A script that was free yesterday and bills today is a bad surprise even when the
// output is useful. Asking for a provider by name is one environment variable.
//
// WHY THE CLI PATHS ARE SANDBOXED AND EPHEMERAL. These providers hand a model a prompt built from
// UNTRUSTED CORPUS CONTENT - the attack strings are the input. A coding agent with write access and a
// persisted session is the wrong thing to point at that. So:
//
//   - codex runs `-s read-only` with `--ephemeral`, no session files and no writes
//   - codex runs `--skip-git-repo-check` and `--ignore-user-config`, so a developer's own config
//     cannot change what the run does
//   - claude runs with `--allowed-tools ""`, so it answers rather than acts
//
// That is defence for the DEVELOPER's machine, not evidence about the engine. It is worth stating
// because this repository's whole subject is what happens when untrusted text reaches something that
// can act, and it would be absurd to be careless about it here.
//
// NO SECRETS ARE READ FROM OR WRITTEN TO ANY FILE. The CLIs hold their own auth; this module never
// sees it, never logs it, and never passes a token on a command line.

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PROVIDERS = ["codex", "claude-code", "anthropic-api"];

/**
 * Pull the first balanced JSON object out of a model's reply.
 *
 * BALANCED, NOT GREEDY. The original judge used `/\{[\s\S]*\}/`, which spans from the first brace to
 * the LAST one anywhere in the reply - so a model that answered with its JSON and then added a second
 * example, or wrapped the answer in prose containing a brace, produced a string that parses as
 * neither. Depth-counting takes the first complete object and stops.
 *
 * Returns `undefined` rather than throwing. A reply this cannot read is an `error` row, never a
 * silent skip - which is the rule the whole file exists to keep.
 */
export const firstJsonObject = (text) => {
  if (typeof text !== "string") return undefined;
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
};

/** Run a command, capture stdout, and never throw. Injectable so tests need no live model. */
const runner = (timeoutMs) => (file, args, stdin) =>
  new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" },
      (err, stdout, stderr) => {
        resolve({
          code: err?.code ?? 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          failed: Boolean(err),
          message: err?.message ?? "",
        });
      },
    );
    if (stdin !== undefined && child.stdin) {
      child.stdin.end(stdin);
    }
  });

/** Is a CLI on PATH? Asked with `--version`, which every one of them answers cheaply. */
const cliPresent = async (exec, file) => {
  const r = await exec(file, ["--version"], undefined);
  return !r.failed;
};

/**
 * Build the provider set.
 *
 * `exec` and `env` are injected so the tests can drive every branch - including a provider that
 * returns prose, one that returns broken JSON, and one that is not installed - without a live model.
 * A test that needed a real model would be a test nobody runs.
 */
export function makeProviders({ exec, env = process.env, timeoutMs = 180_000 } = {}) {
  const run = exec ?? runner(timeoutMs);

  const codex = {
    name: "codex",
    auth: "local Codex CLI session (CODEX_HOME), not an OpenAI API key",
    available: () => cliPresent(run, "codex"),
    ask: async (prompt, schema) => {
      // A temp directory, removed in `finally`: the last-message file and the schema are the only
      // artifacts, and neither belongs in the repository. Same reasoning as CONTAINMENT_EXTRA_DOC.
      const dir = mkdtempSync(join(tmpdir(), "containment-codex-"));
      try {
        const out = join(dir, "last.txt");
        const args = [
          "exec",
          "--ephemeral", // no session files on disk
          "--skip-git-repo-check",
          "--ignore-user-config", // a local config cannot change what this run does
          "-s",
          "read-only", // it answers; it does not act
          "--color",
          "never",
          "-o",
          out,
        ];
        if (schema !== undefined) {
          const schemaPath = join(dir, "schema.json");
          writeFileSync(schemaPath, JSON.stringify(schema));
          args.push("--output-schema", schemaPath);
        }
        // The prompt arrives on stdin. It is built from untrusted corpus content and can be long;
        // argv is the wrong place for either property.
        args.push("-");
        const r = await run("codex", args, prompt);
        let text = "";
        try {
          text = readFileSync(out, "utf8");
        } catch {
          text = r.stdout;
        }
        if (r.failed && text.trim() === "") {
          return { ok: false, error: `codex exited ${r.code}: ${r.message.slice(0, 200)}` };
        }
        return { ok: true, text };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };

  const claudeCode = {
    name: "claude-code",
    auth: "Claude Code plan/OAuth session, or CLAUDE_CODE_OAUTH_TOKEN. No ANTHROPIC_API_KEY needed",
    available: () => cliPresent(run, "claude"),
    ask: async (prompt) => {
      // `--allowed-tools ""` so it answers rather than acts. The prompt carries attack strings.
      const r = await run(
        "claude",
        ["-p", "--output-format", "json", "--allowed-tools", ""],
        prompt,
      );
      if (r.failed && r.stdout.trim() === "") {
        return { ok: false, error: `claude exited ${r.code}: ${r.message.slice(0, 200)}` };
      }
      // `--output-format json` wraps the reply in an envelope; the model's text is `.result`.
      try {
        const envelope = JSON.parse(r.stdout);
        if (envelope.is_error === true) {
          return { ok: false, error: `claude reported an error: ${String(envelope.result ?? "")}` };
        }
        return { ok: true, text: String(envelope.result ?? "") };
      } catch {
        // Not the envelope we expected. Hand the raw text on rather than guessing - the JSON
        // extractor may still find the answer, and if it cannot, the row is an `error`.
        return { ok: true, text: r.stdout };
      }
    },
  };

  const anthropicApi = {
    name: "anthropic-api",
    auth: "ANTHROPIC_API_KEY, billed to the API directly",
    available: async () =>
      typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY !== "",
    ask: async (prompt) => {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: env.MODEL_JUDGE_MODEL ?? "claude-sonnet-5",
          max_tokens: 400,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const body = await res.json();
      return { ok: true, text: body.content?.map((b) => b.text ?? "").join("") ?? "" };
    },
  };

  return { codex, "claude-code": claudeCode, "anthropic-api": anthropicApi };
}

/**
 * Ask a provider and return PARSED JSON, or an error row.
 *
 * A reply this cannot read becomes `{ error }` and is counted as an error. It is never dropped and
 * never treated as agreement - a judge that silently discards the replies it cannot parse reports a
 * denominator that means nothing, which is the vacuity this repository keeps finding in its own
 * checks.
 */
export const askJson = async (provider, prompt, schema) => {
  const r = await provider.ask(prompt, schema);
  if (!r.ok) return { error: r.error };
  const raw = firstJsonObject(r.text);
  if (raw === undefined) return { error: "no JSON object in the reply" };
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { error: `unparseable JSON: ${String(e.message).slice(0, 120)}` };
  }
};

/**
 * Which provider to use, and why it is or is not usable.
 *
 * Returns `{ provider }` or `{ skip: "<reason>" }`. The caller prints the reason and exits 0: a
 * pipeline that calls the model runs unconditionally must stay green on a machine with no model.
 */
export const resolveProvider = async ({ env = process.env, providers } = {}) => {
  const set = providers ?? makeProviders({ env });
  const requested = env.MODEL_JUDGE_PROVIDER ?? env.MODEL_RUN_PROVIDER;
  if (requested !== undefined && !PROVIDERS.includes(requested)) {
    return { skip: `unknown provider "${requested}" - expected one of ${PROVIDERS.join(", ")}` };
  }
  // Only what was asked for. Unasked, this is the historical behaviour and nothing else: a key, or a
  // skip. See the note at the top of this file about why an installed CLI is not auto-selected.
  const order = requested !== undefined ? [requested] : ["anthropic-api"];
  for (const name of order) {
    const p = set[name];
    if (p === undefined) continue;
    if (await p.available()) return { provider: p };
  }
  return {
    skip:
      requested !== undefined
        ? `provider "${requested}" is not usable here - its CLI is not on PATH, or its auth is not set up`
        : "ANTHROPIC_API_KEY is not set, and no MODEL_JUDGE_PROVIDER was requested. Set MODEL_JUDGE_PROVIDER=codex or claude-code to use a local CLI session instead",
  };
};
