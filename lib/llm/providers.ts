import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Model providers. "claude" and "codex" run the locally installed CLIs, so they use
 * your existing Claude / ChatGPT logins (no API keys). "anthropic-api" uses ANTHROPIC_API_KEY.
 */
export const PROVIDERS = ["claude", "codex", "anthropic-api"] as const;
export type ProviderId = (typeof PROVIDERS)[number];
export type Effort = "low" | "medium" | "high";

export class ProviderError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

// Showstopper arrangements written in parallel can take 6–8 minutes each; give them room.
const TIMEOUT_MS = 15 * 60_000;
const HOME = os.homedir();
const SEARCH_DIRS = [
  ...(process.env.PATH ?? "").split(path.delimiter),
  path.join(HOME, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", path.join(HOME, ".npm-global/bin"),
].filter(Boolean);

async function findBinary(name: string): Promise<string | null> {
  for (const dir of SEARCH_DIRS) {
    const p = path.join(dir, name);
    try {
      await access(p, constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

export async function availableProviders(): Promise<Record<ProviderId, boolean>> {
  const [claude, codex] = await Promise.all([findBinary("claude"), findBinary("codex")]);
  return { claude: !!claude, codex: !!codex, "anthropic-api": !!process.env.ANTHROPIC_API_KEY };
}

/** Strict structured-output modes (Codex/OpenAI) reject numeric bounds; zod adds safe-int bounds to .int(). */
function sanitizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchema);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "minimum" || k === "maximum" || k === "$schema") continue;
      out[k] = sanitizeSchema(v);
    }
    return out;
  }
  return node;
}

function run(bin: string, args: string[], input: string, cwd?: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: { ...process.env, PATH: SEARCH_DIRS.join(path.delimiter) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new ProviderError(`${path.basename(bin)} timed out after ${TIMEOUT_MS / 60000} minutes`, 504));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => { clearTimeout(timer); reject(new ProviderError(`Failed to start ${bin}: ${e.message}`, 500)); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
    child.stdin.end(input);
  });
}

export type StructuredRequest = { system: string; prompt: string; schema: object; effort: Effort };

/** Run one structured-output request and return the raw JSON value (validated by the caller). */
/** At most this many model calls run at once (sections × alternatives can fan out widely). */
const MAX_CONCURRENT = 6;
const g = globalThis as unknown as { __llmSlots?: { active: number; queue: (() => void)[] } };
const slots = (g.__llmSlots ??= { active: 0, queue: [] });

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (slots.active >= MAX_CONCURRENT) await new Promise<void>((r) => slots.queue.push(r));
  slots.active++;
  try {
    return await fn();
  } finally {
    slots.active--;
    slots.queue.shift()?.();
  }
}

export async function runStructured(provider: ProviderId, req: StructuredRequest): Promise<unknown> {
  const schema = sanitizeSchema(req.schema) as Record<string, unknown>;
  return withSlot(() => {
    if (provider === "claude") return runClaudeCli(req, schema);
    if (provider === "codex") return runCodexCli(req, schema);
    return runAnthropicApi(req, schema);
  });
}

async function runClaudeCli(req: StructuredRequest, schema: object): Promise<unknown> {
  const bin = await findBinary("claude");
  if (!bin) throw new ProviderError("Claude Code CLI not found. Install it and run `claude` once to log in.", 503);
  const args = [
    "-p", "--output-format", "json",
    "--json-schema", JSON.stringify(schema),
    "--system-prompt", req.system,
    "--model", "opus",
    "--effort", req.effort,
    "--tools", "",
    "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence",
  ];
  const { stdout, stderr, code } = await run(bin, args, req.prompt, os.tmpdir());
  let parsed: { is_error?: boolean; result?: string; structured_output?: unknown; subtype?: string };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ProviderError(`Claude CLI failed (exit ${code}): ${(stderr || stdout).slice(0, 400)}`, 502);
  }
  if (parsed.is_error) {
    const msg = parsed.result ?? parsed.subtype ?? "unknown error";
    const status = /log ?in|auth|credential/i.test(msg) ? 401 : 502;
    throw new ProviderError(status === 401 ? `Claude login needed: run \`claude\` in a terminal and log in. (${msg})` : `Claude CLI error: ${msg}`, status);
  }
  if (parsed.structured_output === undefined) throw new ProviderError("Claude CLI returned no structured output.", 502);
  return parsed.structured_output;
}

async function runCodexCli(req: StructuredRequest, schema: object): Promise<unknown> {
  const bin = await findBinary("codex");
  if (!bin) throw new ProviderError("Codex CLI not found. Install it and run `codex login`.", 503);
  const dir = await mkdtemp(path.join(os.tmpdir(), "woodshed-codex-"));
  try {
    const schemaFile = path.join(dir, "schema.json");
    const outFile = path.join(dir, "out.json");
    await writeFile(schemaFile, JSON.stringify(schema));
    const args = [
      "exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only",
      "-c", `model_reasoning_effort="${req.effort}"`,
      "--output-schema", schemaFile, "-o", outFile, "-",
    ];
    const prompt = `${req.system}\n\n---\n\n${req.prompt}\n\nDo not run any commands. Answer only with the JSON object.`;
    const { stdout, stderr, code } = await run(bin, args, prompt, dir);
    let text = "";
    try {
      text = await readFile(outFile, "utf8");
    } catch {
      const log = (stderr || stdout).slice(-600);
      const status = /log ?in|auth|unauthori[sz]ed|401/i.test(log) ? 401 : 502;
      throw new ProviderError(status === 401 ? "Codex login needed: run `codex login` in a terminal." : `Codex CLI failed (exit ${code}): ${log}`, status);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError("Codex returned output that isn't JSON.", 502);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

let apiClient: Anthropic | null = null;

async function runAnthropicApi(req: StructuredRequest, schema: Record<string, unknown>): Promise<unknown> {
  if (!process.env.ANTHROPIC_API_KEY) throw new ProviderError("ANTHROPIC_API_KEY is not set in .env.local.", 401);
  apiClient ??= new Anthropic();
  try {
    const response = await apiClient.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      output_config: { effort: req.effort, format: { type: "json_schema", schema } },
    });
    if (response.stop_reason === "refusal") throw new ProviderError("Claude declined this request.", 422);
    if (response.stop_reason === "max_tokens") throw new ProviderError("Output was too long — try fewer bars.", 422);
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return JSON.parse(text);
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new ProviderError("Anthropic API key is invalid.", 401);
    if (e instanceof Anthropic.RateLimitError) throw new ProviderError("Rate limited by the Anthropic API — try again shortly.", 429);
    if (e instanceof Anthropic.APIError) throw new ProviderError(`Anthropic API error: ${e.message}`, e.status ?? 500);
    if (e instanceof SyntaxError) throw new ProviderError("Claude returned output that isn't JSON.", 502);
    throw e;
  }
}
