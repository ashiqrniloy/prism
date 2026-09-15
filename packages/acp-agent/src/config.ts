/**
 * Config parsing and validation for the spawnable ACP agent (0.2.8 Task 10).
 *
 * The config file is the trust boundary: every field is validated with a
 * clear error, and unknown keys are rejected so a typo cannot silently
 * disable a security-relevant option (fail closed). Paths in the config are
 * resolved against the config file's directory, so the file is relocatable.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AgUiLimitOptions } from "@arnilo/prism-ag-ui";
import type { AcpConfigOption, AcpSessionMode } from "@arnilo/prism-ag-ui/acp";
import type { ModelConfig } from "@arnilo/prism";

export class ConfigError extends Error {
  readonly code = "PRISM_ACP_AGENT_CONFIG";
}

export const AMBIGUOUS_PATH_PATTERN = /%2[eEfF]|%5[cC]|\\|\.\./;
export const MAX_URL_LENGTH = 2048;
export const MAX_MCP_ALLOW_ENTRIES = 256;

export interface ParsedAllowDestination {
  readonly kind: "stdio" | "url";
  readonly origin?: string;
  readonly path?: string;
}

export function parseAllowDestination(entry: string): ParsedAllowDestination | null {
  if (entry === "stdio") {
    return { kind: "stdio" };
  }
  if (typeof entry !== "string" || entry.length === 0 || entry.length > MAX_URL_LENGTH) {
    return null;
  }
  const urlWithoutQuery = entry.split(/[?#]/, 1)[0] ?? entry;
  if (AMBIGUOUS_PATH_PATTERN.test(urlWithoutQuery)) {
    return null;
  }
  try {
    const url = new URL(entry);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.username || url.password || url.search || url.hash) {
      return null;
    }
    let path = url.pathname;
    if (path.endsWith("/") && path.length > 1) {
      path = path.slice(0, -1);
    }
    return { kind: "url", origin: url.origin, path };
  } catch {
    return null;
  }
}

export interface PrismAcpAgentMcpConfig {
  /** Allowed destinations for http/sse MCP servers (origin or path-subtree); the marker "stdio" allows stdio servers. */
  readonly allow: readonly string[];
}

export interface PrismAcpAgentModesConfig {
  readonly modes: readonly AcpSessionMode[];
  readonly defaultModeId?: string;
}

export interface PrismAcpAgentConfigOptionsConfig {
  readonly options: readonly AcpConfigOption[];
}

export interface PrismAcpAgentConfig {
  /** Ownership user id for every ACP session (single-local-user authorization). */
  readonly userId: string;
  /** Workspace root the coding tools are bound to (resolved against the config dir). */
  readonly cwd: string;
  /** Durable store for Prism sessions/runs; default: in-memory. */
  readonly sessionStore: { readonly type: "sqlite"; readonly path: string } | { readonly type: "memory" };
  /** Model selection for the ACP agent. */
  readonly model?: ModelConfig;
  /** Credential reference (env var name or host secret identifier) used to resolve provider credentials. */
  readonly credentialRef?: string;
  readonly mcp?: PrismAcpAgentMcpConfig;
  readonly modes?: PrismAcpAgentModesConfig;
  readonly configOptions?: PrismAcpAgentConfigOptionsConfig;
  /** AG-UI/ACP caps (see @arnilo/prism-ag-ui AgUiLimitOptions); optional passthrough. */
  readonly limits?: AgUiLimitOptions;
}

const KNOWN_KEYS = new Set(["userId", "cwd", "sessionStore", "model", "credentialRef", "mcp", "modes", "configOptions", "limits"]);
const KNOWN_MODEL_KEYS = new Set(["provider", "model", "displayName", "compat", "parameters", "metadata"]);
const KNOWN_SESSION_STORE_KEYS = new Set(["type", "path"]);
const KNOWN_MCP_KEYS = new Set(["allow"]);

export function loadConfig(path: string): PrismAcpAgentConfig {
  const resolved = resolve(path);
  let text: string;
  try {
    text = readFileSync(resolved, "utf8");
  } catch (error) {
    throw new ConfigError(`cannot read config file ${resolved}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseConfig(text, dirname(resolved), resolved);
}

export function parseConfig(text: string, baseDir: string, source = "config"): PrismAcpAgentConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${source}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateConfig(raw, baseDir, source);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(source: string, message: string): never {
  throw new ConfigError(`${source}: ${message}`);
}

function requireString(value: unknown, source: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) fail(source, `${field} must be a non-empty string`);
  return value;
}

function rejectUnknown(record: Record<string, unknown>, known: ReadonlySet<string>, source: string): void {
  const unknown = Object.keys(record).filter((key) => !known.has(key));
  if (unknown.length > 0) fail(source, `unknown key(s): ${unknown.join(", ")}`);
}

export function validateConfig(raw: unknown, baseDir: string, source: string): PrismAcpAgentConfig {
  if (!isRecord(raw)) fail(source, "config must be a JSON object");
  rejectUnknown(raw, KNOWN_KEYS, source);

  const userId = requireString(raw.userId, source, "userId");

  const cwd = resolve(baseDir, requireString(raw.cwd, source, "cwd"));
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) fail(source, `cwd is not an existing directory: ${cwd}`);

  let sessionStore: PrismAcpAgentConfig["sessionStore"] = { type: "memory" };
  if (raw.sessionStore !== undefined) {
    if (!isRecord(raw.sessionStore)) fail(source, "sessionStore must be an object");
    rejectUnknown(raw.sessionStore, KNOWN_SESSION_STORE_KEYS, `${source}.sessionStore`);
    if (raw.sessionStore.type === "sqlite") {
      const path = requireString(raw.sessionStore.path, `${source}.sessionStore`, "path");
      // ":memory:" is the sqlite in-memory convention — pass it through verbatim.
      sessionStore = { type: "sqlite", path: path === ":memory:" ? path : resolve(baseDir, path) };
    } else if (raw.sessionStore.type !== "memory") {
      fail(source, `sessionStore.type must be "sqlite" or "memory", got ${JSON.stringify(raw.sessionStore.type)}`);
    }
  }

  let model: ModelConfig | undefined;
  if (raw.model !== undefined) {
    if (!isRecord(raw.model)) fail(source, "model must be an object");
    rejectUnknown(raw.model, KNOWN_MODEL_KEYS, `${source}.model`);
    const provider = requireString(raw.model.provider, `${source}.model`, "provider");
    const modelId = requireString(raw.model.model, `${source}.model`, "model");
    model = {
      provider,
      model: modelId,
      ...(typeof raw.model.displayName === "string" ? { displayName: raw.model.displayName } : {}),
      ...(raw.model.compat !== undefined && isRecord(raw.model.compat) ? { compat: raw.model.compat as ModelConfig["compat"] } : {}),
      ...(raw.model.parameters !== undefined && isRecord(raw.model.parameters)
        ? { parameters: raw.model.parameters as ModelConfig["parameters"] }
        : {}),
      ...(raw.model.metadata !== undefined && isRecord(raw.model.metadata)
        ? { metadata: raw.model.metadata as ModelConfig["metadata"] }
        : {}),
    };
  }

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

  let mcp: PrismAcpAgentMcpConfig | undefined;
  if (raw.mcp !== undefined) {
    if (!isRecord(raw.mcp)) fail(source, "mcp must be an object");
    rejectUnknown(raw.mcp, KNOWN_MCP_KEYS, `${source}.mcp`);
    if (!Array.isArray(raw.mcp.allow) || raw.mcp.allow.some((entry) => typeof entry !== "string" || entry.length === 0)) {
      fail(source, "mcp.allow must be an array of non-empty strings");
    }
    if (raw.mcp.allow.length > MAX_MCP_ALLOW_ENTRIES) {
      fail(source, `mcp.allow cannot exceed ${MAX_MCP_ALLOW_ENTRIES} entries`);
    }
    const validatedAllow: string[] = [];
    for (const [index, entry] of raw.mcp.allow.entries()) {
      if (entry === "stdio") {
        validatedAllow.push(entry);
        continue;
      }
      if (entry.length > MAX_URL_LENGTH) {
        fail(source, `mcp.allow[${index}] exceeds maximum URL length of ${MAX_URL_LENGTH}`);
      }
      const urlWithoutQuery = entry.split(/[?#]/, 1)[0] ?? entry;
      if (AMBIGUOUS_PATH_PATTERN.test(urlWithoutQuery)) {
        fail(
          source,
          `invalid mcp.allow entry '${entry}': ambiguous encoded characters, backslashes, or traversal segments are not permitted`,
        );
      }
      let parsed: URL;
      try {
        parsed = new URL(entry);
      } catch {
        fail(source, `invalid mcp.allow entry '${entry}': must be "stdio" or a valid absolute http/https URL`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        fail(source, `invalid mcp.allow entry '${entry}': scheme must be http or https`);
      }
      if (parsed.username || parsed.password) {
        fail(source, `invalid mcp.allow entry '${entry}': credentials are not permitted`);
      }
      if (parsed.search) {
        fail(source, `invalid mcp.allow entry '${entry}': query parameters are not permitted`);
      }
      if (parsed.hash) {
        fail(source, `invalid mcp.allow entry '${entry}': fragment identifiers are not permitted`);
      }
      validatedAllow.push(entry);
    }
    mcp = { allow: validatedAllow };
  }

  let modes: PrismAcpAgentModesConfig | undefined;
  if (raw.modes !== undefined) {
    if (!isRecord(raw.modes)) fail(source, "modes must be an object");
    const modeList = raw.modes.modes;
    if (!Array.isArray(modeList) || modeList.length === 0) fail(source, "modes.modes must be a non-empty array");
    const ids = new Set<string>();
    for (const [index, mode] of modeList.entries()) {
      if (!isRecord(mode)) fail(source, `modes.modes[${index}] must be an object`);
      rejectUnknown(mode, new Set(["id", "name", "description"]), `${source}.modes.modes[${index}]`);
      const id = requireString(mode.id, `${source}.modes.modes[${index}]`, "id");
      requireString(mode.name, `${source}.modes.modes[${index}]`, "name");
      if (ids.has(id)) fail(source, `duplicate mode id: ${id}`);
      ids.add(id);
    }
    const defaultModeId =
      raw.modes.defaultModeId === undefined ? undefined : requireString(raw.modes.defaultModeId, `${source}.modes`, "defaultModeId");
    if (defaultModeId !== undefined && !ids.has(defaultModeId)) fail(source, `defaultModeId '${defaultModeId}' is not a known mode`);
    modes = {
      modes: modeList as unknown as PrismAcpAgentModesConfig["modes"],
      ...(defaultModeId !== undefined ? { defaultModeId } : {}),
    };
  }

  let configOptions: PrismAcpAgentConfigOptionsConfig | undefined;
  if (raw.configOptions !== undefined) {
    if (!isRecord(raw.configOptions)) fail(source, "configOptions must be an object");
    const optionList = raw.configOptions.options;
    if (!Array.isArray(optionList) || optionList.length === 0) fail(source, "configOptions.options must be a non-empty array");
    const ids = new Set<string>();
    for (const [index, option] of optionList.entries()) {
      const at = `${source}.configOptions.options[${index}]`;
      if (!isRecord(option)) fail(source, `${at} must be an object`);
      rejectUnknown(option, new Set(["type", "id", "name", "description", "defaultValue", "options"]), at);
      const type = option.type;
      if (type !== "boolean" && type !== "select") fail(source, `${at}.type must be "boolean" or "select"`);
      const id = requireString(option.id, at, "id");
      requireString(option.name, at, "name");
      if (ids.has(id)) fail(source, `duplicate config option id: ${id}`);
      ids.add(id);
      if (type === "boolean" && typeof option.defaultValue !== "boolean") fail(source, `${at}.defaultValue must be a boolean`);
      if (type === "select") {
        if (typeof option.defaultValue !== "string") fail(source, `${at}.defaultValue must be a string`);
        if (!Array.isArray(option.options) || option.options.length === 0) fail(source, `${at}.options must be a non-empty array`);
        for (const [choiceIndex, choice] of option.options.entries()) {
          if (!isRecord(choice) || typeof choice.value !== "string" || choice.value.length === 0) {
            fail(source, `${at}.options[${choiceIndex}].value must be a non-empty string`);
          }
        }
      }
    }
    configOptions = { options: optionList as unknown as PrismAcpAgentConfigOptionsConfig["options"] };
  }

  let limits: AgUiLimitOptions | undefined;
  if (raw.limits !== undefined) {
    if (!isRecord(raw.limits)) fail(source, "limits must be an object");
    limits = raw.limits;
  }

  return {
    userId,
    cwd,
    sessionStore,
    ...(model ? { model } : {}),
    ...(credentialRef ? { credentialRef } : {}),
    ...(mcp ? { mcp } : {}),
    ...(modes ? { modes } : {}),
    ...(configOptions ? { configOptions } : {}),
    ...(limits ? { limits } : {}),
  };
}
