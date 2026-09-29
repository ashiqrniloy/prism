import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { buildConnectOptions, type McpServerSpec } from "@arnilo/prism-agent-sdk";
import { connectMcpTools } from "@arnilo/prism-mcp";
import type { PrismCodeConfig } from "./config.js";
import { type CredentialStoreSelection, PrismCodeCredentialManager, selectCredentialStore } from "./credentials.js";
import { readState, resolvePrismHome } from "./home.js";
import { resolveMcpServers } from "./mcp.js";
import { describeProviderCredentialStatus, formatProviderCredentialStatus } from "./oauth.js";
import { enrichModelConfig, SHIPPED_PROVIDERS, type ShippedProviderDescriptor } from "./providers.js";
import { getCanonicalWorkspaceRoot, resolveSessionDbPath } from "./sessions.js";
import { inspectSkills, resolveSkillRoots } from "./skills.js";
import { resolveWebTools } from "./web.js";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  readonly name: string;
  readonly status: DoctorStatus;
  readonly detail: string;
  /** Actionable follow-up shown under a `warn`/`fail` row; never contains a secret. */
  readonly hint?: string;
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  readonly ok: boolean;
  readonly exitCode: 0 | 1;
}

export interface DoctorOptions {
  readonly config: PrismCodeConfig;
  /** Prism home; defaults to `PRISM_HOME`/`~/.prism`. */
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Test seam: provider inventory to probe; defaults to the shipped list. */
  readonly providers?: readonly ShippedProviderDescriptor[];
  /** Per-server MCP connect budget. Defaults to 5000 ms. */
  readonly mcpTimeoutMs?: number;
}

const require = createRequire(import.meta.url);

/** `bun:sqlite` typed minimally: prism-code is Bun-only and never statically imports it. */
type SqliteHandle = { query: (sql: string) => { get: () => unknown }; close: () => void };
function openSqlite(filename: string): SqliteHandle {
  const ctor = require("bun:sqlite").Database as new (file: string) => SqliteHandle;
  return new ctor(filename);
}

const MINIMUM_BUN = [1, 4, 2] as const;

function parseVersion(value: string | undefined): readonly number[] | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function lowerThan(version: readonly number[], minimum: readonly number[]): boolean {
  for (let i = 0; i < minimum.length; i++) {
    const a = version[i] ?? 0;
    const b = minimum[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

/** `@opentui/core-<platform>-<arch>[-musl]` matches the loader's dynamic import in @opentui/core. */
function nativeOpenTuiPackage(): string {
  const libc = process.env.OPENTUI_LIBC === "musl" ? "-musl" : "";
  return `@opentui/core-${process.platform}-${process.arch}${libc}`;
}

async function checkRuntime(): Promise<DoctorCheck> {
  const bun = process.versions.bun;
  const parsed = parseVersion(bun);
  if (!parsed) {
    return { name: "runtime", status: "fail", detail: "not running under Bun", hint: "Prism Code requires Bun >= 1.4.2." };
  }
  const bunText = `bun ${bun}`;
  if (lowerThan(parsed, [...MINIMUM_BUN])) {
    return {
      name: "runtime",
      status: "fail",
      detail: `${bunText} is older than the required ${MINIMUM_BUN.join(".")}`,
      hint: "Upgrade Bun (https://bun.sh/docs/installation).",
    };
  }

  // Load OpenTUI and its native library for real instead of resolving package paths: a `bun build
  // --compile` binary (plan 140 Task 3) bundles @opentui/core and embeds the native library, so
  // there is no package to resolve, and a resolvable package can still ship a broken library.
  let openTui: { resolveRenderLib: () => unknown };
  try {
    openTui = await import("@opentui/core");
  } catch (error) {
    return {
      name: "runtime",
      status: "fail",
      detail: `@opentui/core is not loadable: ${error instanceof Error ? error.message : String(error)}`,
      hint: 'Run "bun install" in the Prism Code package.',
    };
  }
  const native = nativeOpenTuiPackage();
  try {
    openTui.resolveRenderLib();
  } catch {
    return {
      name: "runtime",
      status: "warn",
      detail: `${bunText} · @opentui/core loaded, native ${native} not loaded`,
      hint: `Reinstall dependencies for ${process.platform}/${process.arch}.`,
    };
  }
  return { name: "runtime", status: "ok", detail: `${bunText} · @opentui/core + ${native}` };
}

function checkHome(home: string): DoctorCheck {
  if (!existsSync(home)) {
    return {
      name: "home",
      status: "warn",
      detail: `${home} does not exist yet`,
      hint: "Prism Code creates it with mode 0700 on first run.",
    };
  }
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(home);
  } catch (error) {
    return { name: "home", status: "fail", detail: `cannot stat ${home}: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!stat.isDirectory()) return { name: "home", status: "fail", detail: `${home} is not a directory` };

  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    return { name: "home", status: "fail", detail: `${home} is owned by uid ${stat.uid}, not ${process.getuid()}` };
  }
  const mode = stat.mode & 0o777;
  const modeText = mode.toString(8).padStart(3, "0");
  if (process.platform !== "win32" && (mode & 0o077) !== 0) {
    return {
      name: "home",
      status: "warn",
      detail: `${home} has mode ${modeText}`,
      hint: "Prism Code tightens it to 0700 on the next start.",
    };
  }
  return { name: "home", status: "ok", detail: `${home} (mode ${modeText})` };
}

function checkTerminal(env: NodeJS.ProcessEnv): DoctorCheck {
  const term = env.TERM ?? "(unset)";
  const program = env.TERM_PROGRAM ?? "";
  const colorTerm = env.COLORTERM ?? "";
  const truecolor =
    /^(truecolor|24bit)$/i.test(colorTerm) || /truecolor|24bit/i.test(term) || ["iTerm.app", "WezTerm", "ghostty"].includes(program);
  const kittyKeyboard =
    env.KITTY_WINDOW_ID !== undefined ||
    /kitty/i.test(term) ||
    ["ghostty", "WezTerm", "kitty"].includes(program) ||
    env.WEZTERM_PANE !== undefined;
  const detail = `TERM=${term}${program ? ` · TERM_PROGRAM=${program}` : ""} · truecolor: ${truecolor ? "yes" : "no"} · kitty keyboard: ${kittyKeyboard ? "yes" : "no"}`;
  if (!truecolor) {
    return { name: "terminal", status: "warn", detail, hint: "Set COLORTERM=truecolor for full-color tool cards and diffs." };
  }
  if (!kittyKeyboard) {
    return {
      name: "terminal",
      status: "warn",
      detail,
      hint: "Shift+Enter multiline needs a kitty-keyboard terminal; Alt+Enter / Ctrl+J work everywhere.",
    };
  }
  return { name: "terminal", status: "ok", detail };
}

function checkProviders(
  credentials: PrismCodeCredentialManager,
  providers: readonly ShippedProviderDescriptor[],
  env: NodeJS.ProcessEnv,
): Promise<DoctorCheck> {
  return (async () => {
    const statuses = await Promise.all(
      providers.map(async (provider) => ({
        provider,
        status: await describeProviderCredentialStatus(provider, credentials, env),
      })),
    );
    const configured = statuses.filter((entry) => entry.status.kind !== "not-configured");
    if (configured.length === 0) {
      return {
        name: "providers",
        status: "fail",
        detail: `no credentials found for any of ${providers.length} shipped providers (environment or store)`,
        hint: 'Set an API key env var (e.g. ANTHROPIC_API_KEY) or run "prism-code" to authenticate.',
      };
    }
    return {
      name: "providers",
      status: "ok",
      detail: configured.map((entry) => `${entry.provider.id} (${formatProviderCredentialStatus(entry.status)})`).join(", "),
    };
  })();
}

async function checkModel(config: PrismCodeConfig): Promise<DoctorCheck> {
  if (!config.model) {
    return {
      name: "model",
      status: "fail",
      detail: "no model selected",
      hint: 'Run "prism-code" to pick one, or set "model" in prism-code.json.',
    };
  }
  const enriched = await enrichModelConfig(config.model);
  const label = `${enriched.model.provider}/${enriched.model.model}`;
  const cap = enriched.model.limits?.contextWindow;
  const capText = cap !== undefined ? ` · ctx ${cap.toLocaleString()}` : "";
  if (enriched.usedDefaults) {
    return { name: "model", status: "warn", detail: `${label}${capText} (limits assumed; not in the shipped catalog)` };
  }
  return { name: "model", status: "ok", detail: `${label}${capText}` };
}

async function checkSkills(config: PrismCodeConfig, home: string): Promise<DoctorCheck> {
  const roots = resolveSkillRoots(config, home);
  const skills = await inspectSkills(config, { home });
  const loaded = skills.filter((skill) => skill.loaded).length;
  if (roots.length === 0) {
    return {
      name: "skills",
      status: "warn",
      detail: "no skill roots discovered",
      hint: "Add skills under <repo>/.agents/skills or configure skills.dirs.",
    };
  }
  return { name: "skills", status: "ok", detail: `${roots.length} roots · ${skills.length} skills (${loaded} loaded)` };
}

async function checkWeb(config: PrismCodeConfig, credentials: PrismCodeCredentialManager): Promise<DoctorCheck> {
  const resolution = await resolveWebTools(config, credentials);
  const noteText = resolution.notes.length > 0 ? ` — ${resolution.notes.join("; ")}` : "";
  if (resolution.enabled) {
    return { name: "web", status: "ok", detail: `mode ${resolution.mode}: ${resolution.toolNames.join(", ")}${noteText}` };
  }
  if (resolution.unavailableReason !== undefined) {
    return {
      name: "web",
      status: "warn",
      detail: `mode ${resolution.mode}: ${resolution.unavailableReason}`,
      hint: "Install the backend or set web.mode explicitly.",
    };
  }
  return {
    name: "web",
    status: "ok",
    detail: `mode ${resolution.mode} (web tools disabled${resolution.mode === "off" ? " by configuration" : ""})${noteText}`,
  };
}

async function probeMcpServer(spec: McpServerSpec, timeoutMs: number): Promise<DoctorCheck> {
  const name = `mcp:${spec.serverId}`;
  const disabledReason = (spec as { disabledReason?: string }).disabledReason;
  if (disabledReason !== undefined) {
    return { name, status: "warn", detail: `skipped — ${disabledReason}` };
  }
  const preflightError = (spec as { preflightError?: string }).preflightError;
  if (preflightError !== undefined) {
    return { name, status: "fail", detail: `not prepared — ${preflightError}` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`MCP connect timed out after ${timeoutMs}ms`)), timeoutMs);
  let bridge: Awaited<ReturnType<typeof connectMcpTools>> | undefined;
  try {
    bridge = await connectMcpTools({ ...buildConnectOptions(spec), signal: controller.signal, callTimeoutMs: timeoutMs });
    return { name, status: "ok", detail: `connected, ${bridge.tools.length} tools` };
  } catch (error) {
    return { name, status: "fail", detail: `connect failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(timer);
    await bridge?.close().catch(() => {});
  }
}

async function checkMcp(
  config: PrismCodeConfig,
  credentials: PrismCodeCredentialManager,
  home: string,
  timeoutMs: number,
): Promise<DoctorCheck[]> {
  const servers = config.mcp?.servers ?? [];
  if (servers.length === 0) return [{ name: "mcp", status: "ok", detail: "no MCP servers configured" }];

  const resolved = await resolveMcpServers({
    servers,
    // `doctor` is explicitly operator-invoked: probe what the configuration declares instead of
    // re-gating project servers here (trust prompts stay in the run path).
    mode: "allow",
    home,
    workspaceRoot: getCanonicalWorkspaceRoot(config.cwd),
    credentialManager: credentials,
  });
  const checks = await Promise.all(resolved.servers.map((spec) => probeMcpServer(spec, timeoutMs)));
  if (checks.length === 0) return [{ name: "mcp", status: "ok", detail: "no MCP servers configured" }];
  // Manifest-level notes (untrusted project servers, malformed headers) never expose values.
  if (resolved.notes.length > 0) {
    checks.push({ name: "mcp:notes", status: "warn", detail: resolved.notes.join("; ") });
  }
  return checks;
}

function checkSessionDb(config: PrismCodeConfig, home: string): DoctorCheck {
  const dbPath = resolveSessionDbPath(config, home);
  if (dbPath === ":memory:") return { name: "session-db", status: "ok", detail: "in-memory store (no database)" };
  if (!existsSync(dbPath)) {
    return {
      name: "session-db",
      status: "warn",
      detail: `${dbPath} does not exist yet`,
      hint: "The database is created on the first session.",
    };
  }
  let db: SqliteHandle | undefined;
  try {
    db = openSqlite(dbPath);
    const row = db.query("PRAGMA quick_check").get() as Record<string, unknown> | undefined;
    const value = row ? String(Object.values(row)[0] ?? "") : "";
    if (value.toLowerCase() !== "ok") {
      return {
        name: "session-db",
        status: "fail",
        detail: `${dbPath}: ${value || "quick_check failed"}`,
        hint: "Back up and delete the database to start fresh.",
      };
    }
    return { name: "session-db", status: "ok", detail: `${dbPath} (quick_check ok)` };
  } catch (error) {
    return {
      name: "session-db",
      status: "fail",
      detail: `${dbPath}: ${error instanceof Error ? error.message : String(error)}`,
      hint: "Back up and delete the database to start fresh.",
    };
  } finally {
    try {
      db?.close();
    } catch {
      // A failed close on an already-corrupt database must not mask the check result.
    }
  }
}

function checkCredentials(selection: CredentialStoreSelection | undefined, error: unknown): DoctorCheck {
  if (!selection) {
    return {
      name: "credentials",
      status: "fail",
      detail: `credential store unavailable: ${error instanceof Error ? error.message : String(error)}`,
      hint: "Fix credentials.store in prism-code.json or unset an unusable saved choice.",
    };
  }
  if (selection.needsChoice) {
    return {
      name: "credentials",
      status: "warn",
      detail: "no credential store selected (environment API keys still work)",
      hint: 'Run "prism-code" once to choose, or set credentials.store.',
    };
  }
  return { name: "credentials", status: "ok", detail: `store: ${selection.choice ?? "unselected"}` };
}

function failedCheck(name: string, error: unknown): DoctorCheck {
  return { name, status: "fail", detail: error instanceof Error ? error.message : String(error) };
}

/**
 * Runs the diagnostic checks. Independent checks run in parallel; MCP probes are bounded by
 * `mcpTimeoutMs` per server, so the whole report stays well under the 20 s budget.
 */
export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const home = options.home ?? resolvePrismHome(env);

  let selection: CredentialStoreSelection | undefined;
  let credentialError: unknown;
  try {
    selection = await selectCredentialStore({ config: options.config, state: readState(home).state, home, env });
  } catch (error) {
    credentialError = error;
  }
  const credentials = selection?.manager ?? new PrismCodeCredentialManager({ disableKeychain: true });

  const independent: readonly { readonly name: string; readonly run: () => Promise<DoctorCheck> | DoctorCheck }[] = [
    { name: "runtime", run: () => checkRuntime() },
    { name: "home", run: () => checkHome(home) },
    { name: "terminal", run: () => checkTerminal(env) },
    { name: "model", run: () => checkModel(options.config) },
    { name: "skills", run: () => checkSkills(options.config, home) },
    { name: "providers", run: () => checkProviders(credentials, options.providers ?? SHIPPED_PROVIDERS, env) },
    { name: "web", run: () => checkWeb(options.config, credentials) },
    { name: "session-db", run: () => checkSessionDb(options.config, home) },
  ];
  const [independentChecks, mcpChecks] = await Promise.all([
    Promise.all(
      independent.map(async ({ name, run }) => {
        try {
          return await run();
        } catch (error) {
          return failedCheck(name, error);
        }
      }),
    ),
    checkMcp(options.config, credentials, home, options.mcpTimeoutMs ?? 5000).catch((error) => [failedCheck("mcp", error)]),
  ]);

  const checks: DoctorCheck[] = [checkCredentials(selection, credentialError), ...independentChecks, ...mcpChecks];
  const ok = checks.every((check) => check.status !== "fail");
  return { checks, ok, exitCode: ok ? 0 : 1 };
}

const STATUS_LABELS: Readonly<Record<DoctorStatus, string>> = { ok: "ok", warn: "warn", fail: "fail" };

/** Plain-text table; no ANSI colors so it stays readable in logs and CI. */
export function formatDoctorTable(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((check) => check.name.length));
  const lines = report.checks.map((check) => {
    const row = `  ${STATUS_LABELS[check.status].padEnd(4)}  ${check.name.padEnd(width)}  ${check.detail}`;
    return check.hint && check.status !== "ok" ? `${row}\n        ${" ".repeat(width)}  ${check.hint}` : row;
  });
  const failures = report.checks.filter((check) => check.status === "fail").length;
  const warnings = report.checks.filter((check) => check.status === "warn").length;
  const summary = report.ok ? `doctor: ${report.checks.length} checks, no failures` : `doctor: ${failures} failed, ${warnings} warnings`;
  return `${summary}\n${lines.join("\n")}`;
}

export function doctorReportToJson(report: DoctorReport): string {
  return JSON.stringify({ version: 1, ok: report.ok, exitCode: report.exitCode, checks: report.checks }, null, 2);
}
