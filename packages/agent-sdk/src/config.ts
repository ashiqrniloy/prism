import type { ExecutionPolicy } from "@arnilo/prism";
import type { AgentSdkConfig } from "./define-agent.js";
import { AgentSdkConfigError } from "./errors.js";
import type { McpServerSpec } from "./planes/mcp.js";
import { codingPreset, mergeAgentConfig } from "./presets.js";

// ---------------------------------------------------------------------------
// Plain-JSON Config Types
// ---------------------------------------------------------------------------

export interface JsonPlanesConfig {
  readonly coding?: boolean;
  readonly git?: boolean;
}

export interface JsonSkillsConfig {
  readonly enabled?: boolean;
  readonly workspaceRoot?: string;
  readonly exclude?: readonly string[];
  readonly roots?: readonly {
    readonly dir: string;
    readonly origin: "global" | "workspace";
    readonly layout?: "kind-dir" | "flat";
  }[];
  readonly activateAll?: boolean;
}

export interface JsonInstructionsConfig {
  readonly text?: string;
  readonly agentsMd?: boolean | { readonly path?: string; readonly paths?: readonly string[] };
  readonly systemMd?: boolean | { readonly globalRoot?: string; readonly path?: string; readonly mode?: "append" | "replace" };
}

export interface JsonHooksConfig {
  readonly file: string;
}

export interface JsonMcpConfig {
  /** Server specs. `auth` is host-wired (it carries closures) and is not accepted from JSON. */
  readonly servers: readonly McpServerSpec[];
  readonly allow?: readonly string[];
  readonly connectTimeoutMs?: number;
}

export interface JsonToolsConfig {
  readonly planes?: JsonPlanesConfig;
  readonly exclude?: readonly string[];
}

export interface AgentSdkJsonConfig {
  readonly workspaceRoot?: string;
  readonly planes?: JsonPlanesConfig;
  readonly exclude?: readonly string[];
  readonly tools?: JsonToolsConfig;
  readonly skills?: JsonSkillsConfig;
  readonly instructions?: JsonInstructionsConfig;
  readonly hooks?: JsonHooksConfig;
  readonly mcp?: JsonMcpConfig;
  readonly loop?: string;
}

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(record: Record<string, unknown>, known: ReadonlySet<string>, keyPathPrefix: string): void {
  for (const key of Object.keys(record)) {
    if (!known.has(key)) {
      const fullPath = keyPathPrefix ? `${keyPathPrefix}.${key}` : key;
      throw new AgentSdkConfigError(`unknown key "${fullPath}"`);
    }
  }
}

function validateBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new AgentSdkConfigError(`expected boolean for "${path}"`);
  }
  return value;
}

function validateString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new AgentSdkConfigError(`expected string for "${path}"`);
  }
  return value;
}

function validateNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AgentSdkConfigError(`expected non-empty string for "${path}"`);
  }
  return value;
}

function validateStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new AgentSdkConfigError(`expected array of strings for "${path}"`);
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      throw new AgentSdkConfigError(`expected string for "${path}[${i}]"`);
    }
  }
  return value;
}

function validatePositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new AgentSdkConfigError(`expected positive integer for "${path}"`);
  }
  return value;
}

const KNOWN_ROOT_KEYS = new Set(["workspaceRoot", "planes", "exclude", "tools", "skills", "instructions", "hooks", "mcp", "loop"]);

const KNOWN_PLANES_KEYS = new Set(["coding", "git"]);
const KNOWN_TOOLS_KEYS = new Set(["planes", "exclude"]);
const KNOWN_SKILLS_KEYS = new Set(["enabled", "workspaceRoot", "exclude", "roots", "activateAll"]);
const KNOWN_INSTRUCTIONS_KEYS = new Set(["text", "agentsMd", "systemMd"]);
const KNOWN_AGENTS_MD_KEYS = new Set(["path", "paths"]);
const KNOWN_SYSTEM_MD_KEYS = new Set(["globalRoot", "path", "mode"]);
const KNOWN_HOOKS_KEYS = new Set(["file"]);
const KNOWN_MCP_KEYS = new Set(["servers", "allow", "connectTimeoutMs"]);
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
  "allowedOrigins",
  "headers",
  "connectTimeoutMs",
]);

function validatePlanes(raw: unknown, path: string): JsonPlanesConfig {
  if (!isRecord(raw)) {
    throw new AgentSdkConfigError(`expected object for "${path}"`);
  }
  rejectUnknownKeys(raw, KNOWN_PLANES_KEYS, path);

  const out: Record<string, boolean> = {};
  if (raw.coding !== undefined) {
    out.coding = validateBoolean(raw.coding, `${path}.coding`);
  }
  if (raw.git !== undefined) {
    out.git = validateBoolean(raw.git, `${path}.git`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// parseAgentSdkConfig
// ---------------------------------------------------------------------------

/**
 * Validates a plain-JSON configuration object (e.g. from an app config file).
 *
 * Enforces fail-closed validation:
 * - Unknown keys at any depth are rejected with their full key path.
 * - Every value is shape- and type-validated.
 * - Programmatic concerns (`model`, `provider`) are rejected with an explicit error.
 * - Does not perform any filesystem or network I/O.
 *
 * @param json Plain JSON object or raw JSON string.
 * @returns Fully validated `AgentSdkJsonConfig`.
 */
export function parseAgentSdkConfig(json: unknown): AgentSdkJsonConfig {
  let parsed: unknown = json;
  if (typeof json === "string") {
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      throw new AgentSdkConfigError(`invalid JSON configuration: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!isRecord(parsed)) {
    throw new AgentSdkConfigError("configuration must be a JSON object");
  }

  // Explicit rejection for programmatic concerns
  if ("model" in parsed) {
    throw new AgentSdkConfigError('cannot specify "model" in JSON config: model and provider must be supplied programmatically');
  }
  if ("provider" in parsed) {
    throw new AgentSdkConfigError('cannot specify "provider" in JSON config: model and provider must be supplied programmatically');
  }

  rejectUnknownKeys(parsed, KNOWN_ROOT_KEYS, "");

  const result: Record<string, unknown> = {};

  if (parsed.workspaceRoot !== undefined) {
    result.workspaceRoot = validateNonEmptyString(parsed.workspaceRoot, "workspaceRoot");
  }

  if (parsed.planes !== undefined) {
    result.planes = validatePlanes(parsed.planes, "planes");
  }

  if (parsed.exclude !== undefined) {
    result.exclude = validateStringArray(parsed.exclude, "exclude");
  }

  if (parsed.tools !== undefined) {
    if (!isRecord(parsed.tools)) {
      throw new AgentSdkConfigError('expected object for "tools"');
    }
    rejectUnknownKeys(parsed.tools, KNOWN_TOOLS_KEYS, "tools");
    const toolsResult: Record<string, unknown> = {};
    if (parsed.tools.planes !== undefined) {
      toolsResult.planes = validatePlanes(parsed.tools.planes, "tools.planes");
    }
    if (parsed.tools.exclude !== undefined) {
      toolsResult.exclude = validateStringArray(parsed.tools.exclude, "tools.exclude");
    }
    result.tools = toolsResult;
  }

  if (parsed.skills !== undefined) {
    if (!isRecord(parsed.skills)) {
      throw new AgentSdkConfigError('expected object for "skills"');
    }
    rejectUnknownKeys(parsed.skills, KNOWN_SKILLS_KEYS, "skills");
    const skillsResult: Record<string, unknown> = {};
    if (parsed.skills.enabled !== undefined) {
      skillsResult.enabled = validateBoolean(parsed.skills.enabled, "skills.enabled");
    }
    if (parsed.skills.workspaceRoot !== undefined) {
      skillsResult.workspaceRoot = validateNonEmptyString(parsed.skills.workspaceRoot, "skills.workspaceRoot");
    }
    if (parsed.skills.exclude !== undefined) {
      skillsResult.exclude = validateStringArray(parsed.skills.exclude, "skills.exclude");
    }
    if (parsed.skills.activateAll !== undefined) {
      skillsResult.activateAll = validateBoolean(parsed.skills.activateAll, "skills.activateAll");
    }
    if (parsed.skills.roots !== undefined) {
      if (!Array.isArray(parsed.skills.roots)) {
        throw new AgentSdkConfigError('expected array for "skills.roots"');
      }
      skillsResult.roots = parsed.skills.roots.map((r, i) => {
        if (!isRecord(r)) throw new AgentSdkConfigError(`expected object for "skills.roots[${i}]"`);
        const dir = validateNonEmptyString(r.dir, `skills.roots[${i}].dir`);
        if (r.origin !== "global" && r.origin !== "workspace") {
          throw new AgentSdkConfigError(`expected "global" or "workspace" for "skills.roots[${i}].origin"`);
        }
        let layout: "kind-dir" | "flat" | undefined;
        if (r.layout !== undefined) {
          if (r.layout !== "kind-dir" && r.layout !== "flat") {
            throw new AgentSdkConfigError(`expected "kind-dir" or "flat" for "skills.roots[${i}].layout"`);
          }
          layout = r.layout;
        }
        return { dir, origin: r.origin, ...(layout ? { layout } : {}) };
      });
    }
    result.skills = skillsResult;
  }

  if (parsed.instructions !== undefined) {
    if (typeof parsed.instructions === "string") {
      result.instructions = { text: parsed.instructions };
    } else if (isRecord(parsed.instructions)) {
      rejectUnknownKeys(parsed.instructions, KNOWN_INSTRUCTIONS_KEYS, "instructions");
      const instructionsResult: Record<string, unknown> = {};
      if (parsed.instructions.text !== undefined) {
        instructionsResult.text = validateString(parsed.instructions.text, "instructions.text");
      }
      if (parsed.instructions.agentsMd !== undefined) {
        if (typeof parsed.instructions.agentsMd === "boolean") {
          instructionsResult.agentsMd = parsed.instructions.agentsMd;
        } else if (isRecord(parsed.instructions.agentsMd)) {
          rejectUnknownKeys(parsed.instructions.agentsMd, KNOWN_AGENTS_MD_KEYS, "instructions.agentsMd");
          instructionsResult.agentsMd = {
            ...(parsed.instructions.agentsMd.path !== undefined
              ? { path: validateNonEmptyString(parsed.instructions.agentsMd.path, "instructions.agentsMd.path") }
              : {}),
            ...(parsed.instructions.agentsMd.paths !== undefined
              ? {
                  paths: validateStringArray(parsed.instructions.agentsMd.paths, "instructions.agentsMd.paths"),
                }
              : {}),
          };
        } else {
          throw new AgentSdkConfigError('expected boolean or object for "instructions.agentsMd"');
        }
      }
      if (parsed.instructions.systemMd !== undefined) {
        if (typeof parsed.instructions.systemMd === "boolean") {
          instructionsResult.systemMd = parsed.instructions.systemMd;
        } else if (isRecord(parsed.instructions.systemMd)) {
          rejectUnknownKeys(parsed.instructions.systemMd, KNOWN_SYSTEM_MD_KEYS, "instructions.systemMd");
          const modeVal = parsed.instructions.systemMd.mode;
          if (modeVal !== undefined && modeVal !== "append" && modeVal !== "replace") {
            throw new AgentSdkConfigError('instructions.systemMd.mode must be "append" or "replace"');
          }
          instructionsResult.systemMd = {
            ...(parsed.instructions.systemMd.globalRoot !== undefined
              ? { globalRoot: validateNonEmptyString(parsed.instructions.systemMd.globalRoot, "instructions.systemMd.globalRoot") }
              : {}),
            ...(parsed.instructions.systemMd.path !== undefined
              ? { path: validateNonEmptyString(parsed.instructions.systemMd.path, "instructions.systemMd.path") }
              : {}),
            ...(modeVal !== undefined ? { mode: modeVal as "append" | "replace" } : {}),
          };
        } else {
          throw new AgentSdkConfigError('expected boolean or object for "instructions.systemMd"');
        }
      }
      result.instructions = instructionsResult;
    } else {
      throw new AgentSdkConfigError('expected object or string for "instructions"');
    }
  }

  if (parsed.hooks !== undefined) {
    if (!isRecord(parsed.hooks)) {
      throw new AgentSdkConfigError('expected object for "hooks"');
    }
    rejectUnknownKeys(parsed.hooks, KNOWN_HOOKS_KEYS, "hooks");
    result.hooks = {
      file: validateNonEmptyString(parsed.hooks.file, "hooks.file"),
    };
  }

  if (parsed.mcp !== undefined) {
    if (!isRecord(parsed.mcp)) {
      throw new AgentSdkConfigError('expected object for "mcp"');
    }
    rejectUnknownKeys(parsed.mcp, KNOWN_MCP_KEYS, "mcp");
    if (!Array.isArray(parsed.mcp.servers)) {
      throw new AgentSdkConfigError('expected array for "mcp.servers"');
    }
    const validatedServers: McpServerSpec[] = [];
    const resolvedAllow = parsed.mcp.allow !== undefined ? validateStringArray(parsed.mcp.allow, "mcp.allow") : undefined;
    const resolvedTimeout =
      parsed.mcp.connectTimeoutMs !== undefined ? validatePositiveInteger(parsed.mcp.connectTimeoutMs, "mcp.connectTimeoutMs") : undefined;
    for (let i = 0; i < parsed.mcp.servers.length; i++) {
      const s = parsed.mcp.servers[i];
      const serverPath = `mcp.servers[${i}]`;
      if (!isRecord(s)) {
        throw new AgentSdkConfigError(`expected object for "${serverPath}"`);
      }
      rejectUnknownKeys(s, KNOWN_MCP_SERVER_KEYS, serverPath);

      validateNonEmptyString(s.serverId, `${serverPath}.serverId`);
      validateNonEmptyString(s.allow, `${serverPath}.allow`);

      if (s.args !== undefined) {
        validateStringArray(s.args, `${serverPath}.args`);
      }
      if (s.command !== undefined) {
        validateNonEmptyString(s.command, `${serverPath}.command`);
      }
      if (s.cwd !== undefined) {
        validateNonEmptyString(s.cwd, `${serverPath}.cwd`);
      }
      if (s.url !== undefined) {
        validateNonEmptyString(s.url, `${serverPath}.url`);
      }
      if (s.allowedOrigins !== undefined) {
        validateStringArray(s.allowedOrigins, `${serverPath}.allowedOrigins`);
      }
      if (s.namePrefix !== undefined) {
        validateNonEmptyString(s.namePrefix, `${serverPath}.namePrefix`);
      }
      if (s.connectTimeoutMs !== undefined) {
        validatePositiveInteger(s.connectTimeoutMs, `${serverPath}.connectTimeoutMs`);
      }
      if (s.headers !== undefined) {
        if (!isRecord(s.headers)) {
          throw new AgentSdkConfigError(`expected object for "${serverPath}.headers"`);
        }
        for (const headerKey of Object.keys(s.headers)) {
          validateString(s.headers[headerKey], `${serverPath}.headers.${headerKey}`);
        }
      }
      if (s.env !== undefined) {
        if (!isRecord(s.env)) {
          throw new AgentSdkConfigError(`expected object for "${serverPath}.env"`);
        }
        for (const envKey of Object.keys(s.env)) {
          validateString(s.env[envKey], `${serverPath}.env.${envKey}`);
        }
      }

      validatedServers.push(s as unknown as McpServerSpec);
    }
    result.mcp = {
      servers: validatedServers,
      ...(resolvedAllow ? { allow: resolvedAllow } : {}),
      ...(resolvedTimeout !== undefined ? { connectTimeoutMs: resolvedTimeout } : {}),
    };
  }

  if (parsed.loop !== undefined) {
    result.loop = validateNonEmptyString(parsed.loop, "loop");
  }

  return result as AgentSdkJsonConfig;
}

// ---------------------------------------------------------------------------
// resolveJsonConfig Helper
// ---------------------------------------------------------------------------

/**
 * Convenience helper: converts an `AgentSdkJsonConfig` (e.g. from an app config file)
 * into a partial `AgentSdkConfig` using `codingPreset` and `mergeAgentConfig`.
 */
export function resolveJsonConfig(
  json: AgentSdkJsonConfig,
  context: { cwd: string; permissions?: ExecutionPolicy },
): Partial<AgentSdkConfig> {
  const planes = json.tools?.planes ?? json.planes;
  const exclude = json.tools?.exclude ?? json.exclude;

  const base = codingPreset({
    cwd: json.workspaceRoot ?? context.cwd,
    permissions: context.permissions,
    planes,
  });

  const override: Partial<AgentSdkConfig> = {
    workspaceRoot: json.workspaceRoot ?? context.cwd,
    tools: {
      exclude,
    },
    ...(json.skills?.enabled
      ? {
          skills: {
            workspaceRoot: json.skills.workspaceRoot ?? json.workspaceRoot ?? context.cwd,
            exclude: json.skills.exclude,
            roots: json.skills.roots,
            activateAll: json.skills.activateAll,
          },
        }
      : {}),
    ...(json.instructions ? { instructions: json.instructions } : {}),
    ...(json.hooks ? { hooks: json.hooks } : {}),
    ...(json.mcp ? { mcp: json.mcp } : {}),
    ...(json.loop
      ? {
          loop:
            json.loop === "single-shot" || json.loop === "singleShot"
              ? { strategy: "single-shot" as const }
              : { strategy: json.loop as "single-shot" },
        }
      : {}),
  };

  return mergeAgentConfig(base, override);
}
