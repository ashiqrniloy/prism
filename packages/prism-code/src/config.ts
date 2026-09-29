import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { ModelConfig } from "@arnilo/prism";
import { type PrismCodeApprovalConfig, validatePrismCodeApproval } from "./approval.js";
import { PrismCodeConfigError } from "./errors.js";
import {
  type PrismCodeLimitsConfig,
  type PrismCodeLoopConfig,
  type PrismCodeMaxCostConfig,
  validatePrismCodeLimits,
  validatePrismCodeLoop,
} from "./limits.js";
import { parseMcpHeaderReference } from "./mcp.js";

export type { PrismCodeLimitsConfig, PrismCodeLoopConfig, PrismCodeMaxCostConfig };

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export interface PrismCodePlanesConfig {
  readonly coding?: boolean;
  readonly git?: boolean;
  readonly askUser?: boolean;
  readonly checks?: boolean;
}

export interface PrismCodeToolsConfig {
  readonly planes?: PrismCodePlanesConfig;
  readonly exclude?: readonly string[];
  readonly add?: readonly string[];
  readonly replace?: Readonly<Record<string, string>>;
  readonly allowedModules?: readonly string[];
  readonly optIn?: readonly string[];
}

export interface PrismCodeSkillsConfig {
  readonly dirs?: readonly string[];
  readonly exclude?: readonly string[];
  readonly disclosure?: "progressive" | "eager";
  readonly compat?: boolean;
}

export interface PrismCodeAgentsMdConfig {
  readonly path?: string;
  readonly paths?: readonly string[];
}

export interface PrismCodeSystemMdConfig {
  readonly globalRoot?: string;
  readonly path?: string;
  readonly mode?: "append" | "replace";
}

export interface PrismCodeInstructionsConfig {
  readonly text?: string;
  readonly agentsMd?: boolean | string | PrismCodeAgentsMdConfig;
  readonly systemMd?: boolean | string | PrismCodeSystemMdConfig;
}

export interface PrismCodeHooksConfig {
  readonly file: string;
}

/** One MCP server declaration from a config layer. `headers` values may be literals (global config
 *  only for sensitive names) or `${env:NAME}` / `${credential:NAME}` references; `${credential:NAME}`
 *  resolves the stored API key for provider `NAME`. Resolved to an SDK spec at assembly time. */
export interface PrismCodeMcpServer {
  readonly serverId: string;
  readonly transport?: "stdio" | "streamable-http" | "http" | "sse";
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly url?: string;
  readonly allow?: string;
  readonly namePrefix?: string;
  readonly readOnly?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
  readonly auth?: "oauth";
  readonly connectTimeoutMs?: number;
  readonly enabled?: boolean;
}

export interface PrismCodeMcpConfig {
  readonly servers?: readonly PrismCodeMcpServer[];
  readonly allow?: readonly string[];
}

/** One host-declared named check for `coding_check`; the model can only select the name. */
export interface PrismCodeCheckConfig {
  /** Executable path (absolute) or basename resolved through `env.PATH`. */
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export type PrismCodeChecksConfig = Readonly<Record<string, PrismCodeCheckConfig>>;

export interface PrismCodeWebConfigObject {
  readonly mode?: "obscura" | "brave" | "off";
  /** Absolute path to the trusted Obscura binary. Relative paths are rejected (config is a trust boundary). */
  readonly command?: string;
  /** Explicit opt-in for Obscura's native browser CLI tools (`obscura_fetch`/`obscura_scrape`). Default false. */
  readonly nativeTools?: boolean;
  /** Fetch backend for brave mode. `"off"` registers `web_search` only; default is Firecrawl. */
  readonly fetchBackend?: "firecrawl" | "off";
}

export type PrismCodeWebConfig = "obscura" | "brave" | "off" | PrismCodeWebConfigObject;

export interface PrismCodeWikiConfigObject {
  readonly enabled?: boolean;
  readonly workspaceRoot?: string;
  /** Deploy wiki skills into `<workspace>/.agents/skills`. Explicit opt-in; default false. */
  readonly autoDeploySkills?: boolean;
}

export type PrismCodeWikiConfig = boolean | "on" | "off" | PrismCodeWikiConfigObject;

export interface PrismCodeOmConfigObject {
  readonly enabled?: boolean;
  readonly model?: ModelConfig;
  readonly credentialRef?: string;
}

export type PrismCodeOmConfig = boolean | "on" | "off" | PrismCodeOmConfigObject;

/** Session store choice. `sqlite` without `path` uses the shared durable home store (`~/.prism/sessions/sessions.db`); `path` overrides it. */
export type PrismCodeStoreConfig = { readonly type: "sqlite"; readonly path?: string } | { readonly type: "memory" };

/** Credential store choice: `auto` probes the keychain once and falls back to a recorded choice. */
export type PrismCodeCredentialStoreConfig = "auto" | "keychain" | "file" | "encrypted-file" | "memory";

export interface PrismCodeCredentialsConfig {
  readonly store?: PrismCodeCredentialStoreConfig;
}

export interface PrismCodeModeConfig {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface PrismCodeModesConfig {
  readonly modes: readonly PrismCodeModeConfig[];
  readonly defaultModeId?: string;
}

export interface PrismCodeConfigOptionChoice {
  readonly value: string;
  readonly name: string;
  readonly description?: string;
}

export type PrismCodeConfigOption =
  | {
      readonly type: "boolean";
      readonly id: string;
      readonly name: string;
      readonly description?: string;
      readonly defaultValue: boolean;
    }
  | {
      readonly type: "select";
      readonly id: string;
      readonly name: string;
      readonly description?: string;
      readonly defaultValue: string;
      readonly options: readonly PrismCodeConfigOptionChoice[];
    };

export interface PrismCodeConfigOptionsConfig {
  readonly options: readonly PrismCodeConfigOption[];
}

export type PrismCodeCompactionStrategyKind = "coding" | "llm" | "om" | "observational-memory";
export type PrismCodeCompactionTriggerKind = "input_ratio" | "threshold_tokens" | "threshold_entries" | "each_turn";

export interface PrismCodeCompactionOptionsConfig {
  readonly strategy?: PrismCodeCompactionStrategyKind;
  readonly trigger?: PrismCodeCompactionTriggerKind;
  readonly ratio?: number;
  readonly tokens?: number;
  readonly entries?: number;
  readonly keepRecentEntries?: number;
  /**
   * Approximate recent-token budget the LLM coding strategy keeps out of the cut. Defaults to
   * `min(20000, half the model window)`; an explicit value is capped the same way so a cut point always exists.
   */
  readonly keepRecentTokens?: number;
  readonly maxSummaryChars?: number;
}

export type PrismCodeCompactionConfig = false | PrismCodeCompactionOptionsConfig;

export interface PrismCodeConfig {
  readonly userId?: string;
  readonly cwd: string;
  readonly model?: ModelConfig;
  readonly credentialRef?: string;
  readonly tools?: PrismCodeToolsConfig;
  readonly skills?: PrismCodeSkillsConfig;
  readonly instructions?: PrismCodeInstructionsConfig;
  readonly hooks?: PrismCodeHooksConfig;
  readonly mcp?: PrismCodeMcpConfig;
  /** Approval mode and optional prompt timeout. `auto` is global-config/flag/`/approval` only. */
  readonly approval?: PrismCodeApprovalConfig;
  /** Named `coding_check` commands; the tool is registered only when at least one is declared. */
  readonly checks?: PrismCodeChecksConfig;
  readonly web?: PrismCodeWebConfig;
  readonly wiki?: PrismCodeWikiConfig;
  readonly observationalMemory?: PrismCodeOmConfig;
  readonly store?: PrismCodeStoreConfig;
  readonly credentials?: PrismCodeCredentialsConfig;
  readonly loop?: PrismCodeLoopConfig;
  readonly limits?: PrismCodeLimitsConfig;
  readonly compaction?: PrismCodeCompactionConfig;
  readonly modes?: PrismCodeModesConfig;
  readonly configOptions?: PrismCodeConfigOptionsConfig;
}

// ---------------------------------------------------------------------------
// Known Keys Sets for Fail-Closed Validation
// ---------------------------------------------------------------------------

const KNOWN_ROOT_KEYS = new Set([
  "userId",
  "cwd",
  "workspaceRoot",
  "model",
  "credentialRef",
  "tools",
  "skills",
  "instructions",
  "hooks",
  "mcp",
  "approval",
  "checks",
  "web",
  "wiki",
  "observationalMemory",
  "store",
  "credentials",
  "loop",
  "limits",
  "compaction",
  "modes",
  "configOptions",
]);

const KNOWN_COMPACTION_KEYS = new Set([
  "strategy",
  "trigger",
  "ratio",
  "tokens",
  "entries",
  "keepRecentEntries",
  "keepRecentTokens",
  "maxSummaryChars",
]);

const KNOWN_MODEL_KEYS = new Set(["provider", "model", "displayName", "compat", "parameters", "metadata"]);

const KNOWN_TOOLS_KEYS = new Set(["planes", "exclude", "add", "replace", "allowedModules", "optIn"]);
const KNOWN_PLANES_KEYS = new Set(["coding", "git", "askUser", "checks"]);
const KNOWN_SKILLS_KEYS = new Set(["dirs", "exclude", "disclosure", "compat"]);
const KNOWN_INSTRUCTIONS_KEYS = new Set(["text", "agentsMd", "systemMd"]);
const KNOWN_AGENTS_MD_KEYS = new Set(["path", "paths"]);
const KNOWN_SYSTEM_MD_KEYS = new Set(["globalRoot", "path", "mode"]);
const KNOWN_HOOKS_KEYS = new Set(["file"]);
const KNOWN_MCP_KEYS = new Set(["servers", "allow"]);
const KNOWN_MCP_SERVER_KEYS = new Set([
  "serverId",
  "transport",
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "allow",
  "namePrefix",
  "readOnly",
  "headers",
  "auth",
  "connectTimeoutMs",
  "enabled",
]);
const MCP_TRANSPORTS = new Set(["stdio", "streamable-http", "http", "sse"]);
const MCP_HTTP_TRANSPORTS = new Set(["streamable-http", "http", "sse"]);
/** Header names whose literal values are a secret and therefore global-config only. */
const MCP_SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|api-key|x-auth-token)$/i;
const KNOWN_CHECK_KEYS = new Set(["command", "args", "cwd", "env", "timeoutMs"]);
const KNOWN_WEB_KEYS = new Set(["mode", "fetchBackend", "command", "nativeTools"]);
const KNOWN_WIKI_KEYS = new Set(["enabled", "workspaceRoot", "autoDeploySkills"]);
const KNOWN_OM_KEYS = new Set(["enabled", "model", "credentialRef"]);
const KNOWN_STORE_KEYS = new Set(["type", "path"]);
const KNOWN_CREDENTIALS_KEYS = new Set(["store"]);
const KNOWN_MODES_KEYS = new Set(["modes", "defaultModeId"]);
const KNOWN_MODE_ITEM_KEYS = new Set(["id", "name", "description"]);
const KNOWN_CONFIG_OPTIONS_KEYS = new Set(["options"]);
const KNOWN_CONFIG_OPTION_ITEM_KEYS = new Set(["type", "id", "name", "description", "defaultValue", "options"]);
const KNOWN_CONFIG_OPTION_CHOICE_KEYS = new Set(["value", "name", "description"]);

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(source: string, message: string): never {
  throw new PrismCodeConfigError(`${source}: ${message}`);
}

function rejectUnknown(record: Record<string, unknown>, known: ReadonlySet<string>, source: string): void {
  const unknown = Object.keys(record).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    fail(source, `unknown key(s): ${unknown.join(", ")}`);
  }
}

function requireString(value: unknown, source: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(source, `${field} must be a non-empty string`);
  }
  return value;
}

function mcpUrlOrigin(url: string, where: string): string {
  try {
    return new URL(url).origin;
  } catch {
    fail(`${where}.url`, `invalid URL "${url}"`);
  }
}

/** Parses one `mcp.servers[]` entry; `trustedSource` is the global config (literal secrets allowed). */
function parseMcpServer(value: unknown, where: string, trustedSource: boolean): PrismCodeMcpServer {
  if (!isRecord(value)) fail(where, "server must be an object");
  rejectUnknown(value, KNOWN_MCP_SERVER_KEYS, where);
  const serverId = requireString(value.serverId, where, "serverId");
  if (value.transport !== undefined && (typeof value.transport !== "string" || !MCP_TRANSPORTS.has(value.transport))) {
    fail(`${where}.transport`, 'transport must be one of "stdio", "streamable-http", "http", "sse"');
  }
  if (value.readOnly !== undefined && typeof value.readOnly !== "boolean") fail(`${where}.readOnly`, "readOnly must be a boolean");
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") fail(`${where}.enabled`, "enabled must be a boolean");
  if (value.namePrefix !== undefined) requireString(value.namePrefix, where, "namePrefix");
  if (value.allow !== undefined) requireString(value.allow, where, "allow");
  if (value.auth !== undefined && value.auth !== "oauth") fail(`${where}.auth`, 'auth must be "oauth"');
  let connectTimeoutMs: number | undefined;
  if (value.connectTimeoutMs !== undefined) {
    if (!Number.isSafeInteger(value.connectTimeoutMs) || (value.connectTimeoutMs as number) < 1) {
      fail(`${where}.connectTimeoutMs`, "connectTimeoutMs must be a positive integer");
    }
    connectTimeoutMs = value.connectTimeoutMs as number;
  }
  const transport = typeof value.transport === "string" ? (value.transport as PrismCodeMcpServer["transport"]) : undefined;
  const common = {
    serverId,
    ...(transport !== undefined ? { transport } : {}),
    ...(typeof value.namePrefix === "string" ? { namePrefix: value.namePrefix } : {}),
    ...(value.readOnly === true ? { readOnly: true } : {}),
    ...(connectTimeoutMs !== undefined ? { connectTimeoutMs } : {}),
  };
  const hasUrl = value.url !== undefined;
  const hasCommand = value.command !== undefined;
  if (hasUrl && hasCommand) fail(where, "server must define either command or url, not both");
  if (!hasUrl && !hasCommand) fail(where, "server must define command or url");
  if (hasUrl) {
    const url = requireString(value.url, where, "url");
    if (value.command !== undefined || value.args !== undefined || value.env !== undefined || value.cwd !== undefined) {
      fail(where, "url servers cannot define command, args, env, or cwd");
    }
    if (transport !== undefined && !MCP_HTTP_TRANSPORTS.has(transport))
      fail(`${where}.transport`, "url servers must use an HTTP transport");
    const allow = typeof value.allow === "string" ? value.allow : mcpUrlOrigin(url, where);
    const headers = value.headers === undefined ? undefined : parseMcpHeaders(value.headers, where, trustedSource);
    return {
      ...common,
      url,
      allow,
      ...(headers ? { headers } : {}),
      ...(value.auth === "oauth" ? { auth: "oauth" } : {}),
    };
  }
  const command = requireString(value.command, where, "command");
  if (value.headers !== undefined || value.auth !== undefined) fail(where, "command servers cannot define headers or auth");
  if (transport !== undefined && transport !== "stdio") fail(`${where}.transport`, 'command servers must use the "stdio" transport');
  const args = value.args === undefined ? undefined : parseMcpArgs(value.args, `${where}.args`);
  const env = value.env === undefined ? undefined : parseMcpEnv(value.env, `${where}.env`);
  const cwd = value.cwd === undefined ? undefined : requireString(value.cwd, where, "cwd");
  return {
    ...common,
    command,
    allow: typeof value.allow === "string" ? value.allow : "stdio",
    ...(args ? { args } : {}),
    ...(env ? { env } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
  };
}

function parseMcpArgs(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((arg) => typeof arg !== "string")) fail(where, "args must be an array of strings");
  return value as string[];
}

function parseMcpEnv(value: unknown, where: string): Record<string, string> {
  if (!isRecord(value)) fail(where, "env must be an object");
  const env: Record<string, string> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw !== "string") fail(`${where}.${name}`, "env values must be strings");
    env[name] = raw;
  }
  return env;
}

function parseMcpHeaders(value: unknown, where: string, trustedSource: boolean): Record<string, string> {
  if (!isRecord(value)) fail(`${where}.headers`, "headers must be an object");
  const headers: Record<string, string> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw !== "string" || raw.length === 0) fail(`${where}.headers.${name}`, "header values must be non-empty strings");
    const reference = parseMcpHeaderReference(raw);
    if (reference.kind === "malformed") fail(`${where}.headers.${name}`, "malformed reference (expected env:NAME or credential:NAME)");
    if (!trustedSource && reference.kind === "literal" && MCP_SENSITIVE_HEADER.test(name)) {
      fail(
        `${where}.headers.${name}`,
        "literal secret headers are only allowed in the global config; use an env: or credential: reference",
      );
    }
    headers[name] = raw;
  }
  return headers;
}

function resolvePathWithHash(baseDir: string, specifier: string): string {
  const hashIdx = specifier.indexOf("#");
  if (hashIdx === -1) {
    return isAbsolute(specifier) ? specifier : resolve(baseDir, specifier);
  }
  const pathPart = specifier.slice(0, hashIdx);
  const hashPart = specifier.slice(hashIdx);
  const resolved = isAbsolute(pathPart) ? pathPart : resolve(baseDir, pathPart);
  return `${resolved}${hashPart}`;
}

// ---------------------------------------------------------------------------
// Parser and Validator Functions
// ---------------------------------------------------------------------------

export type PrismCodeConfigLayer = Omit<PrismCodeConfig, "cwd"> & { readonly cwd?: string };

/** Later layers win per top-level key; object values shallow-merge one level. `mcp.servers` and
 *  `skills.dirs` concatenate across layers (de-duplicated by serverId / path); every other array
 *  is replaced by the later layer. */
export function mergePrismCodeConfigLayers(layers: readonly PrismCodeConfigLayer[], defaultCwd: string = process.cwd()): PrismCodeConfig {
  let merged: PrismCodeConfigLayer = {};
  for (const layer of layers) merged = mergeConfigLayer(merged, layer);
  return { userId: "local", ...merged, cwd: merged.cwd ?? defaultCwd };
}

function mergeConfigLayer(base: PrismCodeConfigLayer, override: PrismCodeConfigLayer): PrismCodeConfigLayer {
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = next[key];
    if (key === "mcp") next[key] = mergeMcpLayer(current, value);
    else if (key === "skills") next[key] = mergeSkillsLayer(current, value);
    else if (isRecord(current) && isRecord(value)) next[key] = { ...current, ...value };
    else next[key] = value;
  }
  return next as PrismCodeConfigLayer;
}

function mergeMcpLayer(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) return override;
  const baseServers = Array.isArray(base.servers) ? (base.servers as PrismCodeMcpServer[]) : undefined;
  const overrideServers = Array.isArray(override.servers) ? (override.servers as PrismCodeMcpServer[]) : undefined;
  let servers = baseServers;
  if (overrideServers) {
    servers = [...(baseServers ?? [])];
    const index = new Map(servers.map((server, i) => [server.serverId, i]));
    for (const server of overrideServers) {
      const existing = index.get(server.serverId);
      if (existing === undefined) {
        index.set(server.serverId, servers.length);
        servers.push(server);
      } else {
        servers[existing] = server;
      }
    }
  }
  return { ...base, ...override, ...(servers ? { servers } : {}) };
}

/** Last-writer-wins origin of every declared MCP server across config layers. A server declared by
 *  `~/.prism/config.json` is trusted; anything else (project file, `--config`, inline) is not. */
export function mcpServerOrigins(
  layers: readonly { readonly layer: PrismCodeConfigLayer; readonly origin: "global" | "project" }[],
): ReadonlyMap<string, "global" | "project"> {
  const origins = new Map<string, "global" | "project">();
  for (const { layer, origin } of layers) {
    for (const server of layer.mcp?.servers ?? []) origins.set(server.serverId, origin);
  }
  return origins;
}

function mergeSkillsLayer(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) return override;
  const baseDirs = Array.isArray(base.dirs) ? (base.dirs as string[]) : undefined;
  const overrideDirs = Array.isArray(override.dirs) ? (override.dirs as string[]) : undefined;
  const dirs = baseDirs || overrideDirs ? [...(baseDirs ?? [])] : undefined;
  if (dirs && overrideDirs) {
    for (const dir of overrideDirs) if (!dirs.includes(dir)) dirs.push(dir);
  }
  return { ...base, ...override, ...(dirs !== undefined ? { dirs } : {}) };
}

function readConfigFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new PrismCodeConfigError(`cannot read config file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseConfigText(text: string, source: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new PrismCodeConfigError(`${source}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function loadPrismCodeConfig(path: string): PrismCodeConfig {
  const resolved = resolve(path);
  const layer = parsePrismCodeConfigLayer(readConfigFile(resolved), dirname(resolved), resolved);
  return { userId: "local", ...layer, cwd: layer.cwd ?? dirname(resolved) };
}

/** Project/global layer: no defaults baked in, so an absent key never clobbers a lower layer. */
export function loadPrismCodeConfigLayer(path: string): PrismCodeConfigLayer {
  const resolved = resolve(path);
  return parsePrismCodeConfigLayer(readConfigFile(resolved), dirname(resolved), resolved);
}

export function parsePrismCodeConfig(text: string, baseDir = process.cwd(), source = "prism-code.json"): PrismCodeConfig {
  const layer = parsePrismCodeConfigLayer(text, baseDir, source);
  return { userId: "local", ...layer, cwd: layer.cwd ?? baseDir };
}

export function parsePrismCodeConfigLayer(
  text: string,
  baseDir = process.cwd(),
  source = "prism-code.json",
  allowAutoApproval = false,
): PrismCodeConfigLayer {
  return validatePrismCodeConfigLayer(parseConfigText(text, source), baseDir, source, allowAutoApproval);
}

export function validatePrismCodeConfig(raw: unknown, baseDir = process.cwd(), source = "config"): PrismCodeConfig {
  const layer = validatePrismCodeConfigLayer(raw, baseDir, source);
  return { userId: "local", ...layer, cwd: layer.cwd ?? baseDir };
}

export function validatePrismCodeConfigLayer(
  raw: unknown,
  baseDir = process.cwd(),
  source = "config",
  allowAutoApproval = false,
): PrismCodeConfigLayer {
  return validateConfigInternal(raw, baseDir, source, false, allowAutoApproval);
}

/** Global `~/.prism/config.json`: `cwd` is project-only and rejected instead of silently applied. */
export function validateGlobalPrismCodeConfigLayer(raw: unknown, baseDir = process.cwd(), source = "config.json"): PrismCodeConfigLayer {
  if (isRecord(raw) && (raw.cwd !== undefined || raw.workspaceRoot !== undefined)) {
    fail(source, "cwd is a project-only key and cannot be set in the global config");
  }
  return validateConfigInternal(raw, baseDir, source, false, true);
}

function validateConfigInternal(
  raw: unknown,
  baseDir: string,
  source: string,
  applyDefaults: boolean,
  allowAutoApproval: boolean,
): PrismCodeConfigLayer {
  if (!isRecord(raw)) {
    fail(source, "config must be a JSON object");
  }
  rejectUnknown(raw, KNOWN_ROOT_KEYS, source);

  // userId
  let userId: string | undefined = applyDefaults ? "local" : undefined;
  if (raw.userId !== undefined) {
    userId = requireString(raw.userId, source, "userId");
  }

  // cwd / workspaceRoot
  let cwd: string | undefined = applyDefaults ? baseDir : undefined;
  const rawCwd = raw.cwd ?? raw.workspaceRoot;
  if (rawCwd !== undefined) {
    const cwdStr = requireString(rawCwd, source, "cwd");
    cwd = isAbsolute(cwdStr) ? cwdStr : resolve(baseDir, cwdStr);
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      fail(source, `cwd is not an existing directory: ${cwd}`);
    }
  }

  // model
  let model: ModelConfig | undefined;
  if (raw.model !== undefined) {
    if (!isRecord(raw.model)) fail(`${source}.model`, "model must be an object");
    rejectUnknown(raw.model, KNOWN_MODEL_KEYS, `${source}.model`);
    const provider = requireString(raw.model.provider, `${source}.model`, "provider");
    const modelId = requireString(raw.model.model, `${source}.model`, "model");
    model = {
      provider,
      model: modelId,
      ...(typeof raw.model.displayName === "string" ? { displayName: raw.model.displayName } : {}),
      ...(raw.model.parameters !== undefined && isRecord(raw.model.parameters)
        ? { parameters: raw.model.parameters as ModelConfig["parameters"] }
        : {}),
      ...(raw.model.metadata !== undefined && isRecord(raw.model.metadata)
        ? { metadata: raw.model.metadata as ModelConfig["metadata"] }
        : {}),
      ...(raw.model.compat !== undefined && isRecord(raw.model.compat) ? { compat: raw.model.compat as ModelConfig["compat"] } : {}),
    };
  }

  // credentialRef
  let credentialRef: string | undefined;
  if (raw.credentialRef !== undefined) {
    credentialRef = requireString(raw.credentialRef, source, "credentialRef");
    if (credentialRef.length > 256) {
      fail(source, "credentialRef exceeds maximum length of 256 characters");
    }
    if (/[\r\n\0]/.test(credentialRef)) {
      fail(source, "credentialRef cannot contain control characters");
    }
  }

  // tools
  let tools: PrismCodeToolsConfig | undefined;
  if (raw.tools !== undefined) {
    if (!isRecord(raw.tools)) fail(`${source}.tools`, "tools must be an object");
    rejectUnknown(raw.tools, KNOWN_TOOLS_KEYS, `${source}.tools`);

    let planes: PrismCodePlanesConfig | undefined;
    if (raw.tools.planes !== undefined) {
      if (!isRecord(raw.tools.planes)) fail(`${source}.tools.planes`, "planes must be an object");
      rejectUnknown(raw.tools.planes, KNOWN_PLANES_KEYS, `${source}.tools.planes`);
      planes = {
        ...(typeof raw.tools.planes.coding === "boolean" ? { coding: raw.tools.planes.coding } : {}),
        ...(typeof raw.tools.planes.git === "boolean" ? { git: raw.tools.planes.git } : {}),
        ...(typeof raw.tools.planes.askUser === "boolean" ? { askUser: raw.tools.planes.askUser } : {}),
        ...(typeof raw.tools.planes.checks === "boolean" ? { checks: raw.tools.planes.checks } : {}),
      };
    }

    let exclude: string[] | undefined;
    if (raw.tools.exclude !== undefined) {
      if (!Array.isArray(raw.tools.exclude) || raw.tools.exclude.some((e) => typeof e !== "string" || e.length === 0)) {
        fail(`${source}.tools.exclude`, "exclude must be an array of non-empty strings");
      }
      exclude = [...raw.tools.exclude];
    }

    let add: string[] | undefined;
    if (raw.tools.add !== undefined) {
      if (!Array.isArray(raw.tools.add) || raw.tools.add.some((a) => typeof a !== "string" || a.length === 0)) {
        fail(`${source}.tools.add`, "add must be an array of non-empty strings");
      }
      add = raw.tools.add.map((spec) => resolvePathWithHash(baseDir, spec));
    }

    let replace: Record<string, string> | undefined;
    if (raw.tools.replace !== undefined) {
      if (!isRecord(raw.tools.replace)) {
        fail(`${source}.tools.replace`, "replace must be an object");
      }
      replace = {};
      for (const [key, val] of Object.entries(raw.tools.replace)) {
        if (typeof val !== "string" || val.length === 0) {
          fail(`${source}.tools.replace.${key}`, "replacement specifier must be a non-empty string");
        }
        replace[key] = resolvePathWithHash(baseDir, val);
      }
    }

    let allowedModules: string[] | undefined;
    if (raw.tools.allowedModules !== undefined) {
      if (!Array.isArray(raw.tools.allowedModules) || raw.tools.allowedModules.some((m) => typeof m !== "string" || m.length === 0)) {
        fail(`${source}.tools.allowedModules`, "allowedModules must be an array of non-empty strings");
      }
      allowedModules = [...raw.tools.allowedModules];
    }

    let optIn: string[] | undefined;
    if (raw.tools.optIn !== undefined) {
      if (!Array.isArray(raw.tools.optIn) || raw.tools.optIn.some((m) => typeof m !== "string" || m.length === 0)) {
        fail(`${source}.tools.optIn`, "optIn must be an array of non-empty strings");
      }
      optIn = [...raw.tools.optIn];
    }

    tools = {
      ...(planes ? { planes } : {}),
      ...(exclude ? { exclude } : {}),
      ...(add ? { add } : {}),
      ...(replace ? { replace } : {}),
      ...(allowedModules ? { allowedModules } : {}),
      ...(optIn ? { optIn } : {}),
    };
  }

  // skills
  let skills: PrismCodeSkillsConfig | undefined;
  if (raw.skills !== undefined) {
    if (!isRecord(raw.skills)) fail(`${source}.skills`, "skills must be an object");
    rejectUnknown(raw.skills, KNOWN_SKILLS_KEYS, `${source}.skills`);

    let dirs: string[] | undefined;
    if (raw.skills.dirs !== undefined) {
      if (!Array.isArray(raw.skills.dirs) || raw.skills.dirs.some((d) => typeof d !== "string" || d.length === 0)) {
        fail(`${source}.skills.dirs`, "dirs must be an array of non-empty strings");
      }
      dirs = raw.skills.dirs.map((d) => (isAbsolute(d) ? d : resolve(baseDir, d)));
    }

    let exclude: string[] | undefined;
    if (raw.skills.exclude !== undefined) {
      if (!Array.isArray(raw.skills.exclude) || raw.skills.exclude.some((e) => typeof e !== "string" || e.length === 0)) {
        fail(`${source}.skills.exclude`, "exclude must be an array of non-empty strings");
      }
      exclude = [...raw.skills.exclude];
    }

    let disclosure: "progressive" | "eager" | undefined;
    if (raw.skills.disclosure !== undefined) {
      if (raw.skills.disclosure !== "progressive" && raw.skills.disclosure !== "eager") {
        fail(`${source}.skills.disclosure`, 'disclosure must be "progressive" or "eager"');
      }
      disclosure = raw.skills.disclosure;
    }

    let compat: boolean | undefined;
    if (raw.skills.compat !== undefined) {
      if (typeof raw.skills.compat !== "boolean") {
        fail(`${source}.skills.compat`, "compat must be a boolean");
      }
      compat = raw.skills.compat;
    }

    skills = {
      ...(dirs ? { dirs } : {}),
      ...(exclude ? { exclude } : {}),
      ...(disclosure ? { disclosure } : {}),
      ...(compat !== undefined ? { compat } : {}),
    };
  }

  // instructions
  let instructions: PrismCodeInstructionsConfig | undefined;
  if (raw.instructions !== undefined) {
    if (!isRecord(raw.instructions)) {
      fail(`${source}.instructions`, "instructions must be an object");
    }
    rejectUnknown(raw.instructions, KNOWN_INSTRUCTIONS_KEYS, `${source}.instructions`);

    let text: string | undefined;
    if (raw.instructions.text !== undefined) {
      if (typeof raw.instructions.text !== "string") {
        fail(`${source}.instructions.text`, "text must be a string");
      }
      text = raw.instructions.text;
    }

    let agentsMd: boolean | string | PrismCodeAgentsMdConfig | undefined;
    if (raw.instructions.agentsMd !== undefined) {
      if (
        typeof raw.instructions.agentsMd !== "boolean" &&
        typeof raw.instructions.agentsMd !== "string" &&
        !isRecord(raw.instructions.agentsMd)
      ) {
        fail(`${source}.instructions.agentsMd`, "agentsMd must be a boolean, string path, or object");
      }
      if (typeof raw.instructions.agentsMd === "string") {
        agentsMd = isAbsolute(raw.instructions.agentsMd) ? raw.instructions.agentsMd : resolve(baseDir, raw.instructions.agentsMd);
      } else if (isRecord(raw.instructions.agentsMd)) {
        rejectUnknown(raw.instructions.agentsMd, KNOWN_AGENTS_MD_KEYS, `${source}.instructions.agentsMd`);
        const p = raw.instructions.agentsMd.path;
        const paths = raw.instructions.agentsMd.paths;
        agentsMd = {
          ...(typeof p === "string" ? { path: isAbsolute(p) ? p : resolve(baseDir, p) } : {}),
          ...(Array.isArray(paths) ? { paths: paths.map((item) => (isAbsolute(item) ? item : resolve(baseDir, item))) } : {}),
        };
      } else {
        agentsMd = raw.instructions.agentsMd;
      }
    }

    let systemMd: boolean | string | PrismCodeSystemMdConfig | undefined;
    if (raw.instructions.systemMd !== undefined) {
      if (
        typeof raw.instructions.systemMd !== "boolean" &&
        typeof raw.instructions.systemMd !== "string" &&
        !isRecord(raw.instructions.systemMd)
      ) {
        fail(`${source}.instructions.systemMd`, "systemMd must be a boolean, string path, or object");
      }
      if (typeof raw.instructions.systemMd === "string") {
        systemMd = isAbsolute(raw.instructions.systemMd) ? raw.instructions.systemMd : resolve(baseDir, raw.instructions.systemMd);
      } else if (isRecord(raw.instructions.systemMd)) {
        rejectUnknown(raw.instructions.systemMd, KNOWN_SYSTEM_MD_KEYS, `${source}.instructions.systemMd`);
        let resolvedGlobalRoot: string | undefined;
        if (raw.instructions.systemMd.globalRoot !== undefined) {
          const globalRoot = requireString(raw.instructions.systemMd.globalRoot, `${source}.instructions.systemMd`, "globalRoot");
          resolvedGlobalRoot = isAbsolute(globalRoot) ? globalRoot : resolve(baseDir, globalRoot);
        }
        let pathPart: string | undefined;
        if (raw.instructions.systemMd.path !== undefined) {
          pathPart = requireString(raw.instructions.systemMd.path, `${source}.instructions.systemMd`, "path");
        }
        let modePart: "append" | "replace" | undefined;
        if (raw.instructions.systemMd.mode !== undefined) {
          if (raw.instructions.systemMd.mode !== "append" && raw.instructions.systemMd.mode !== "replace") {
            fail(`${source}.instructions.systemMd.mode`, 'mode must be "append" or "replace"');
          }
          modePart = raw.instructions.systemMd.mode;
        }
        systemMd = {
          ...(resolvedGlobalRoot ? { globalRoot: resolvedGlobalRoot } : {}),
          ...(pathPart ? { path: pathPart } : {}),
          ...(modePart ? { mode: modePart } : {}),
        };
      } else {
        systemMd = raw.instructions.systemMd;
      }
    }

    instructions = {
      ...(text !== undefined ? { text } : {}),
      ...(agentsMd !== undefined ? { agentsMd } : {}),
      ...(systemMd !== undefined ? { systemMd } : {}),
    };
  }

  // hooks
  let hooks: PrismCodeHooksConfig | undefined;
  if (raw.hooks !== undefined) {
    if (!isRecord(raw.hooks)) fail(`${source}.hooks`, "hooks must be an object");
    rejectUnknown(raw.hooks, KNOWN_HOOKS_KEYS, `${source}.hooks`);
    const file = requireString(raw.hooks.file, `${source}.hooks`, "file");
    hooks = {
      file: isAbsolute(file) ? file : resolve(baseDir, file),
    };
  }

  // mcp
  let mcp: PrismCodeMcpConfig | undefined;
  if (raw.mcp !== undefined) {
    if (!isRecord(raw.mcp)) fail(`${source}.mcp`, "mcp must be an object");
    rejectUnknown(raw.mcp, KNOWN_MCP_KEYS, `${source}.mcp`);

    let servers: PrismCodeMcpServer[] | undefined;
    if (raw.mcp.servers !== undefined) {
      if (!Array.isArray(raw.mcp.servers)) {
        fail(`${source}.mcp.servers`, "servers must be an array");
      }
      servers = raw.mcp.servers.map((s, idx) => parseMcpServer(s, `${source}.mcp.servers[${idx}]`, allowAutoApproval));
    }

    let allow: string[] | undefined;
    if (raw.mcp.allow !== undefined) {
      if (!Array.isArray(raw.mcp.allow) || raw.mcp.allow.some((a) => typeof a !== "string" || a.length === 0)) {
        fail(`${source}.mcp.allow`, "allow must be an array of non-empty strings");
      }
      allow = [...raw.mcp.allow];
    }

    mcp = {
      ...(servers ? { servers } : {}),
      ...(allow ? { allow } : {}),
    };
  }

  // approval
  let approval: PrismCodeApprovalConfig | undefined;
  if (raw.approval !== undefined) {
    approval = validatePrismCodeApproval(raw.approval, `${source}.approval`, allowAutoApproval);
  }

  // checks
  let checks: PrismCodeChecksConfig | undefined;
  if (raw.checks !== undefined) {
    if (!isRecord(raw.checks)) fail(`${source}.checks`, "checks must be an object");
    const parsedChecks: Record<string, PrismCodeCheckConfig> = {};
    for (const [name, value] of Object.entries(raw.checks)) {
      const at = `${source}.checks.${name}`;
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
        fail(at, "check names must match /^[A-Za-z][A-Za-z0-9_-]{0,63}$/");
      }
      if (!isRecord(value)) fail(at, "check must be an object");
      rejectUnknown(value, KNOWN_CHECK_KEYS, at);
      const command = requireString(value.command, at, "command");
      let args: string[] | undefined;
      if (value.args !== undefined) {
        if (!Array.isArray(value.args) || value.args.some((item) => typeof item !== "string" || item.includes("\0"))) {
          fail(`${at}.args`, "args must be an array of strings without NUL");
        }
        args = [...value.args];
      }
      let env: Record<string, string> | undefined;
      if (value.env !== undefined) {
        if (!isRecord(value.env) || Object.values(value.env).some((item) => typeof item !== "string")) {
          fail(`${at}.env`, "env must be an object of string values");
        }
        env = { ...(value.env as Record<string, string>) };
      }
      let timeoutMs: number | undefined;
      if (value.timeoutMs !== undefined) {
        if (typeof value.timeoutMs !== "number" || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1) {
          fail(`${at}.timeoutMs`, "timeoutMs must be a positive safe integer");
        }
        timeoutMs = value.timeoutMs;
      }
      let checkCwd: string | undefined;
      if (value.cwd !== undefined) {
        checkCwd = requireString(value.cwd, at, "cwd");
        if (!isAbsolute(checkCwd)) checkCwd = resolve(baseDir, checkCwd);
      }
      parsedChecks[name] = {
        command,
        ...(args ? { args } : {}),
        ...(checkCwd ? { cwd: checkCwd } : {}),
        ...(env ? { env } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      };
    }
    checks = parsedChecks;
  }

  // web
  let web: PrismCodeWebConfig | undefined;
  if (raw.web !== undefined) {
    if (typeof raw.web === "string") {
      if (raw.web !== "obscura" && raw.web !== "brave" && raw.web !== "off") {
        fail(`${source}.web`, `web mode must be "obscura", "brave", or "off", got ${JSON.stringify(raw.web)}`);
      }
      web = raw.web;
    } else if (isRecord(raw.web)) {
      rejectUnknown(raw.web, KNOWN_WEB_KEYS, `${source}.web`);
      let mode: "obscura" | "brave" | "off" | undefined;
      if (raw.web.mode !== undefined) {
        if (raw.web.mode !== "obscura" && raw.web.mode !== "brave" && raw.web.mode !== "off") {
          fail(`${source}.web.mode`, `mode must be "obscura", "brave", or "off"`);
        }
        mode = raw.web.mode;
      }
      let fetchBackend: "firecrawl" | "off" | undefined;
      if (raw.web.fetchBackend !== undefined) {
        if (raw.web.fetchBackend !== "firecrawl" && raw.web.fetchBackend !== "off") {
          fail(`${source}.web.fetchBackend`, `fetchBackend must be "firecrawl" or "off"`);
        }
        fetchBackend = raw.web.fetchBackend;
      }
      let command: string | undefined;
      if (raw.web.command !== undefined) {
        command = requireString(raw.web.command, `${source}.web`, "command");
        if (!isAbsolute(command)) {
          fail(`${source}.web.command`, "command must be an absolute path to the trusted Obscura binary");
        }
      }
      let nativeTools: boolean | undefined;
      if (raw.web.nativeTools !== undefined) {
        if (typeof raw.web.nativeTools !== "boolean") {
          fail(`${source}.web.nativeTools`, "nativeTools must be a boolean");
        }
        nativeTools = raw.web.nativeTools;
      }
      web = {
        ...(mode ? { mode } : {}),
        ...(fetchBackend ? { fetchBackend } : {}),
        ...(command ? { command } : {}),
        ...(nativeTools !== undefined ? { nativeTools } : {}),
      };
    } else {
      fail(`${source}.web`, "web must be a string or an object");
    }
  }

  // wiki
  let wiki: PrismCodeWikiConfig | undefined;
  if (raw.wiki !== undefined) {
    if (typeof raw.wiki === "boolean") {
      wiki = raw.wiki;
    } else if (raw.wiki === "on" || raw.wiki === "off") {
      wiki = raw.wiki;
    } else if (isRecord(raw.wiki)) {
      rejectUnknown(raw.wiki, KNOWN_WIKI_KEYS, `${source}.wiki`);
      if (raw.wiki.enabled !== undefined && typeof raw.wiki.enabled !== "boolean") {
        fail(`${source}.wiki.enabled`, "enabled must be a boolean");
      }
      if (raw.wiki.autoDeploySkills !== undefined && typeof raw.wiki.autoDeploySkills !== "boolean") {
        fail(`${source}.wiki.autoDeploySkills`, "autoDeploySkills must be a boolean");
      }
      const enabled = typeof raw.wiki.enabled === "boolean" ? raw.wiki.enabled : undefined;
      const autoDeploySkills = typeof raw.wiki.autoDeploySkills === "boolean" ? raw.wiki.autoDeploySkills : undefined;
      let wikiRoot: string | undefined;
      if (raw.wiki.workspaceRoot !== undefined) {
        const r = requireString(raw.wiki.workspaceRoot, `${source}.wiki`, "workspaceRoot");
        wikiRoot = isAbsolute(r) ? r : resolve(baseDir, r);
      }
      wiki = {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(wikiRoot ? { workspaceRoot: wikiRoot } : {}),
        ...(autoDeploySkills !== undefined ? { autoDeploySkills } : {}),
      };
    } else {
      fail(`${source}.wiki`, 'wiki must be a boolean, "on", "off", or an object');
    }
  }

  // observationalMemory
  let observationalMemory: PrismCodeOmConfig | undefined;
  if (raw.observationalMemory !== undefined) {
    if (typeof raw.observationalMemory === "boolean") {
      observationalMemory = raw.observationalMemory;
    } else if (raw.observationalMemory === "on" || raw.observationalMemory === "off") {
      observationalMemory = raw.observationalMemory;
    } else if (isRecord(raw.observationalMemory)) {
      rejectUnknown(raw.observationalMemory, KNOWN_OM_KEYS, `${source}.observationalMemory`);
      const enabled = typeof raw.observationalMemory.enabled === "boolean" ? raw.observationalMemory.enabled : undefined;
      let omModel: ModelConfig | undefined;
      if (raw.observationalMemory.model !== undefined) {
        if (!isRecord(raw.observationalMemory.model)) {
          fail(`${source}.observationalMemory.model`, "model must be an object");
        }
        rejectUnknown(raw.observationalMemory.model, KNOWN_MODEL_KEYS, `${source}.observationalMemory.model`);
        omModel = {
          provider: requireString(raw.observationalMemory.model.provider, `${source}.observationalMemory.model`, "provider"),
          model: requireString(raw.observationalMemory.model.model, `${source}.observationalMemory.model`, "model"),
        };
      }
      let omCredRef: string | undefined;
      if (raw.observationalMemory.credentialRef !== undefined) {
        omCredRef = requireString(raw.observationalMemory.credentialRef, `${source}.observationalMemory`, "credentialRef");
      }
      observationalMemory = {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(omModel ? { model: omModel } : {}),
        ...(omCredRef ? { credentialRef: omCredRef } : {}),
      };
    } else {
      fail(`${source}.observationalMemory`, 'observationalMemory must be a boolean, "on", "off", or an object');
    }
  }

  // store
  let store: PrismCodeStoreConfig | undefined;
  if (raw.store !== undefined) {
    if (!isRecord(raw.store)) fail(`${source}.store`, "store must be an object");
    rejectUnknown(raw.store, KNOWN_STORE_KEYS, `${source}.store`);
    if (raw.store.type === "sqlite") {
      if (raw.store.path === undefined) {
        store = { type: "sqlite" };
      } else {
        const p = requireString(raw.store.path, `${source}.store`, "path");
        store = {
          type: "sqlite",
          path: p === ":memory:" ? p : isAbsolute(p) ? p : resolve(baseDir, p),
        };
      }
    } else if (raw.store.type === "memory") {
      store = { type: "memory" };
    } else {
      fail(`${source}.store.type`, `store.type must be "sqlite" or "memory", got ${JSON.stringify(raw.store.type)}`);
    }
  }

  // credentials
  let credentials: PrismCodeCredentialsConfig | undefined;
  if (raw.credentials !== undefined) {
    if (!isRecord(raw.credentials)) fail(`${source}.credentials`, "credentials must be an object");
    rejectUnknown(raw.credentials, KNOWN_CREDENTIALS_KEYS, `${source}.credentials`);
    if (raw.credentials.store !== undefined) {
      const choice = raw.credentials.store;
      if (choice !== "auto" && choice !== "keychain" && choice !== "file" && choice !== "encrypted-file" && choice !== "memory") {
        fail(
          `${source}.credentials.store`,
          `credentials.store must be one of: auto, keychain, file, encrypted-file, memory (got ${JSON.stringify(choice)})`,
        );
      }
      credentials = { store: choice };
    }
  }

  // loop
  let loop: PrismCodeLoopConfig | undefined;
  if (raw.loop !== undefined) {
    loop = validatePrismCodeLoop(raw.loop, `${source}.loop`);
  }

  // limits
  let limits: PrismCodeLimitsConfig | undefined;
  if (raw.limits !== undefined) {
    limits = validatePrismCodeLimits(raw.limits, `${source}.limits`);
  }

  // compaction
  let compaction: PrismCodeCompactionConfig | undefined;
  if (raw.compaction !== undefined) {
    if (raw.compaction === false) {
      compaction = false;
    } else if (isRecord(raw.compaction)) {
      rejectUnknown(raw.compaction, KNOWN_COMPACTION_KEYS, `${source}.compaction`);
      let strategy: PrismCodeCompactionStrategyKind | undefined;
      if (raw.compaction.strategy !== undefined) {
        const strat = requireString(raw.compaction.strategy, `${source}.compaction`, "strategy");
        if (strat !== "coding" && strat !== "llm" && strat !== "om" && strat !== "observational-memory") {
          fail(
            `${source}.compaction.strategy`,
            `strategy must be one of: coding, llm, om, observational-memory (got ${JSON.stringify(strat)})`,
          );
        }
        strategy = strat;
      }
      let trigger: PrismCodeCompactionTriggerKind | undefined;
      if (raw.compaction.trigger !== undefined) {
        const trig = requireString(raw.compaction.trigger, `${source}.compaction`, "trigger");
        if (trig !== "input_ratio" && trig !== "threshold_tokens" && trig !== "threshold_entries" && trig !== "each_turn") {
          fail(
            `${source}.compaction.trigger`,
            `trigger must be one of: input_ratio, threshold_tokens, threshold_entries, each_turn (got ${JSON.stringify(trig)})`,
          );
        }
        trigger = trig;
      }
      let ratio: number | undefined;
      if (raw.compaction.ratio !== undefined) {
        if (
          typeof raw.compaction.ratio !== "number" ||
          !Number.isFinite(raw.compaction.ratio) ||
          raw.compaction.ratio <= 0 ||
          raw.compaction.ratio >= 1
        ) {
          fail(`${source}.compaction.ratio`, "ratio must be a finite number between 0 and 1");
        }
        ratio = raw.compaction.ratio;
      }
      let tokens: number | undefined;
      if (raw.compaction.tokens !== undefined) {
        if (typeof raw.compaction.tokens !== "number" || !Number.isSafeInteger(raw.compaction.tokens) || raw.compaction.tokens < 1) {
          fail(`${source}.compaction.tokens`, "tokens must be a positive safe integer");
        }
        tokens = raw.compaction.tokens;
      }
      let entries: number | undefined;
      if (raw.compaction.entries !== undefined) {
        if (typeof raw.compaction.entries !== "number" || !Number.isSafeInteger(raw.compaction.entries) || raw.compaction.entries < 1) {
          fail(`${source}.compaction.entries`, "entries must be a positive safe integer");
        }
        entries = raw.compaction.entries;
      }
      let keepRecentEntries: number | undefined;
      if (raw.compaction.keepRecentEntries !== undefined) {
        if (
          typeof raw.compaction.keepRecentEntries !== "number" ||
          !Number.isSafeInteger(raw.compaction.keepRecentEntries) ||
          raw.compaction.keepRecentEntries < 0
        ) {
          fail(`${source}.compaction.keepRecentEntries`, "keepRecentEntries must be a non-negative safe integer");
        }
        keepRecentEntries = raw.compaction.keepRecentEntries;
      }
      let keepRecentTokens: number | undefined;
      if (raw.compaction.keepRecentTokens !== undefined) {
        if (
          typeof raw.compaction.keepRecentTokens !== "number" ||
          !Number.isSafeInteger(raw.compaction.keepRecentTokens) ||
          raw.compaction.keepRecentTokens < 0
        ) {
          fail(`${source}.compaction.keepRecentTokens`, "keepRecentTokens must be a non-negative safe integer");
        }
        keepRecentTokens = raw.compaction.keepRecentTokens;
      }
      let maxSummaryChars: number | undefined;
      if (raw.compaction.maxSummaryChars !== undefined) {
        if (
          typeof raw.compaction.maxSummaryChars !== "number" ||
          !Number.isSafeInteger(raw.compaction.maxSummaryChars) ||
          raw.compaction.maxSummaryChars < 1
        ) {
          fail(`${source}.compaction.maxSummaryChars`, "maxSummaryChars must be a positive safe integer");
        }
        maxSummaryChars = raw.compaction.maxSummaryChars;
      }
      compaction = {
        ...(strategy ? { strategy } : {}),
        ...(trigger ? { trigger } : {}),
        ...(ratio !== undefined ? { ratio } : {}),
        ...(tokens !== undefined ? { tokens } : {}),
        ...(entries !== undefined ? { entries } : {}),
        ...(keepRecentEntries !== undefined ? { keepRecentEntries } : {}),
        ...(keepRecentTokens !== undefined ? { keepRecentTokens } : {}),
        ...(maxSummaryChars !== undefined ? { maxSummaryChars } : {}),
      };
    } else {
      fail(`${source}.compaction`, "compaction must be false or an object");
    }
  }

  // modes
  let modes: PrismCodeModesConfig | undefined;
  if (raw.modes !== undefined) {
    if (!isRecord(raw.modes)) fail(`${source}.modes`, "modes must be an object");
    rejectUnknown(raw.modes, KNOWN_MODES_KEYS, `${source}.modes`);
    const modeList = raw.modes.modes;
    if (!Array.isArray(modeList) || modeList.length === 0) fail(`${source}.modes.modes`, "modes.modes must be a non-empty array");
    const ids = new Set<string>();
    const parsedModes: PrismCodeModeConfig[] = [];
    for (const [index, mode] of modeList.entries()) {
      const at = `${source}.modes.modes[${index}]`;
      if (!isRecord(mode)) fail(at, `${at} must be an object`);
      rejectUnknown(mode, KNOWN_MODE_ITEM_KEYS, at);
      const id = requireString(mode.id, at, "id");
      const name = requireString(mode.name, at, "name");
      if (ids.has(id)) fail(at, `duplicate mode id: ${id}`);
      ids.add(id);
      parsedModes.push({
        id,
        name,
        ...(typeof mode.description === "string" ? { description: mode.description } : {}),
      });
    }
    const defaultModeId =
      raw.modes.defaultModeId === undefined ? undefined : requireString(raw.modes.defaultModeId, `${source}.modes`, "defaultModeId");
    if (defaultModeId !== undefined && !ids.has(defaultModeId))
      fail(`${source}.modes`, `defaultModeId '${defaultModeId}' is not a known mode`);
    modes = {
      modes: parsedModes,
      ...(defaultModeId !== undefined ? { defaultModeId } : {}),
    };
  }

  // configOptions
  let configOptions: PrismCodeConfigOptionsConfig | undefined;
  if (raw.configOptions !== undefined) {
    if (!isRecord(raw.configOptions)) fail(`${source}.configOptions`, "configOptions must be an object");
    rejectUnknown(raw.configOptions, KNOWN_CONFIG_OPTIONS_KEYS, `${source}.configOptions`);
    const optionList = raw.configOptions.options;
    if (!Array.isArray(optionList) || optionList.length === 0)
      fail(`${source}.configOptions.options`, "configOptions.options must be a non-empty array");
    const ids = new Set<string>();
    const parsedOptions: PrismCodeConfigOption[] = [];
    for (const [index, option] of optionList.entries()) {
      const at = `${source}.configOptions.options[${index}]`;
      if (!isRecord(option)) fail(at, `${at} must be an object`);
      rejectUnknown(option, KNOWN_CONFIG_OPTION_ITEM_KEYS, at);
      const type = option.type;
      if (type !== "boolean" && type !== "select") fail(at, `${at}.type must be "boolean" or "select"`);
      const id = requireString(option.id, at, "id");
      const name = requireString(option.name, at, "name");
      if (ids.has(id)) fail(at, `duplicate config option id: ${id}`);
      ids.add(id);
      if (type === "boolean") {
        if (typeof option.defaultValue !== "boolean") fail(at, `${at}.defaultValue must be a boolean`);
        parsedOptions.push({
          type: "boolean",
          id,
          name,
          defaultValue: option.defaultValue,
          ...(typeof option.description === "string" ? { description: option.description } : {}),
        });
      } else {
        if (typeof option.defaultValue !== "string") fail(at, `${at}.defaultValue must be a string`);
        if (!Array.isArray(option.options) || option.options.length === 0) fail(at, `${at}.options must be a non-empty array`);
        const choices: PrismCodeConfigOptionChoice[] = [];
        for (const [choiceIndex, choice] of option.options.entries()) {
          const choiceAt = `${at}.options[${choiceIndex}]`;
          if (!isRecord(choice) || typeof choice.value !== "string" || choice.value.length === 0) {
            fail(choiceAt, `${choiceAt}.value must be a non-empty string`);
          }
          rejectUnknown(choice, KNOWN_CONFIG_OPTION_CHOICE_KEYS, choiceAt);
          const choiceName = requireString(choice.name ?? choice.value, choiceAt, "name");
          choices.push({
            value: choice.value,
            name: choiceName,
            ...(typeof choice.description === "string" ? { description: choice.description } : {}),
          });
        }
        parsedOptions.push({
          type: "select",
          id,
          name,
          defaultValue: option.defaultValue,
          options: choices,
          ...(typeof option.description === "string" ? { description: option.description } : {}),
        });
      }
    }
    configOptions = { options: parsedOptions };
  }

  return {
    ...(userId !== undefined ? { userId } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(model ? { model } : {}),
    ...(credentialRef ? { credentialRef } : {}),
    ...(tools ? { tools } : {}),
    ...(skills ? { skills } : {}),
    ...(instructions ? { instructions } : {}),
    ...(hooks ? { hooks } : {}),
    ...(mcp ? { mcp } : {}),
    ...(approval ? { approval } : {}),
    ...(checks ? { checks } : {}),
    ...(web !== undefined ? { web } : {}),
    ...(wiki !== undefined ? { wiki } : {}),
    ...(observationalMemory !== undefined ? { observationalMemory } : {}),
    ...(store ? { store } : {}),
    ...(credentials ? { credentials } : {}),
    ...(loop ? { loop } : {}),
    ...(limits ? { limits } : {}),
    ...(compaction !== undefined ? { compaction } : {}),
    ...(modes ? { modes } : {}),
    ...(configOptions ? { configOptions } : {}),
  };
}
