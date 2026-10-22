import type { JsonSchema } from "@arnilo/prism";

import type { NamedCheckDefinition } from "./agent/checks.js";
import type { RepositoryLimitOptions } from "./agent/repository/types.js";
import type { CodingSandboxKind } from "./sandbox.js";

/** Shell tool settings. `enabled: false` registers every other tool but not `shell`. */
export interface ToolsCodingShellConfig {
  /** Default `true`. When `false`, `shell` is not registered. */
  readonly enabled?: boolean;
  /** Default wall timeout in milliseconds. Converted to the tool's seconds option. */
  readonly timeoutMs?: number;
  /** Background processes from `shell({ background: true })` (plan 189 Task 9). */
  readonly background?: ToolsCodingShellBackgroundConfig;
}

/** Background-process settings. `shell_output` reads, waits on, and kills these. */
export interface ToolsCodingShellBackgroundConfig {
  /** Live background processes per session. Default 4, hard 16. */
  readonly maxProcesses?: number;
}

/** One JSON command rule. `match` is a substring or a `/pattern/` string. */
export interface ToolsCodingCommandRule {
  readonly match: string;
  readonly decision: "allow" | "deny" | "requireApproval";
  readonly reason?: string;
}

/** One egress allow entry, as `createEgressPolicy` accepts it. */
export interface ToolsCodingEgressRule {
  readonly host: string;
  readonly port: number;
  readonly protocol?: "http" | "https";
  readonly allowPrivate?: boolean;
}

/** Egress allow-list for sandboxed shells. Validated with `createEgressPolicy`. */
export interface ToolsCodingEgressConfig {
  readonly allow?: readonly ToolsCodingEgressRule[];
  readonly presets?: readonly ("npm-registry" | "github")[];
}

/** One language server. Mirrors `LanguageServerSpec`; the model never supplies `command`. */
export interface ToolsCodingLanguageServerConfig {
  readonly command: string;
  readonly args?: readonly string[];
  /** LSP language ids the server handles (`typescript`, `typescriptreact`, `python`, …). */
  readonly languages: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/** Language servers behind the opt-in `diagnostics` tool. No servers means no tool. */
export interface ToolsCodingLanguageConfig {
  readonly servers?: Readonly<Record<string, ToolsCodingLanguageServerConfig>>;
}

/** Structured git tools. `enabled: false` registers no `git_*` tool. Default `{ enabled: true }`. */
export interface ToolsCodingGitConfig {
  readonly enabled?: boolean;
}

/** `todo_write` and its `run.end` continuation. `continueOnOpen: false` keeps the tool, drops the hook. */
export interface ToolsCodingTodoConfig {
  readonly enabled?: boolean;
  readonly continueOnOpen?: boolean;
}

/** The `workspace` service: disposable git worktrees for delegated coding work (plan 165 Task 6). */
export interface ToolsCodingWorkspaceConfig {
  /** Default `true`. When `false`, no `workspace` service is provided. */
  readonly enabled?: boolean;
  /** Where worktrees are created. Default: a per-repository directory under the OS temp dir. */
  readonly worktreeRoot?: string;
  /** Maximum active worktrees. Default 4, hard cap 16. */
  readonly maxWorktrees?: number;
  /** `diff` bounds. Defaults 200 files and 1 MiB per file. */
  readonly diff?: {
    readonly maxFiles?: number;
    readonly maxBytes?: number;
  };
}

/** The principal durable-effect tools require. Opaque; governance verifies it in Phase 9. */
export interface ToolsCodingPrincipalConfig {
  readonly id: string;
}

/** Forge credential ref (never a literal). Resolved through `prism.credentials.resolve`. */
export interface ToolsCodingForgeConfig {
  /** `env:NAME` or `keyring:NAME`; a literal fails config validation. */
  readonly token: string;
}

/** Shared repository limits for `grep` and `glob`. */
export type ToolsCodingRepositoryConfig = RepositoryLimitOptions;

/** Validated `packageConfig` for `@arnilo/prism-tools-coding`. */
export interface ToolsCodingConfig {
  /** The workspace root the file tools operate in. Required; checked in `setup` with a naming error. */
  readonly root: string;
  /** Extra roots that the `coding.targets` service (Task 4) reports alongside `root`. */
  readonly roots?: readonly string[];
  /** Registers only `read`, `grep`, and `glob`. Default `false`. */
  readonly readOnly?: boolean;
  readonly shell?: ToolsCodingShellConfig;
  readonly repository?: ToolsCodingRepositoryConfig;
  /** Structured git tools. Default `{ enabled: true }`. */
  readonly git?: ToolsCodingGitConfig;
  /** Language servers for the opt-in `diagnostics` tool. Default: none. */
  readonly language?: ToolsCodingLanguageConfig;
  /** Named check commands for `coding_check`. No checks means no tool. */
  readonly checks?: Readonly<Record<string, NamedCheckDefinition>>;
  /** `todo_write` plus the `run.end` continuation. Default `{ enabled: true, continueOnOpen: true }`. */
  readonly todo?: ToolsCodingTodoConfig;
  /** Principal durable-effect tools require; when absent they fail closed. */
  readonly principal?: ToolsCodingPrincipalConfig;
  /** Forge credential ref; resolved only through `prism.credentials.resolve`. */
  readonly forge?: ToolsCodingForgeConfig;
  /** Shell/file backend. Default `"none"` (local). `docker` fails closed without host wiring. */
  readonly sandbox?: CodingSandboxKind;
  /** Hard-deny command rules for `shell`; a `deny` decision wins over any approval. */
  readonly commandRules?: readonly ToolsCodingCommandRule[];
  /** Egress allow-list for sandboxed shells. */
  readonly egress?: ToolsCodingEgressConfig;
  /** Disposable git worktrees for delegated coding work. Default `{ enabled: true }`. */
  readonly workspace?: ToolsCodingWorkspaceConfig;
}

const repositoryProperties: Readonly<Record<string, JsonSchema>> = {
  maxDepth: { type: "number", minimum: 1 },
  maxEntries: { type: "number", minimum: 1 },
  maxFiles: { type: "number", minimum: 1 },
  maxResults: { type: "number", minimum: 1 },
  maxConcurrency: { type: "number", minimum: 1 },
  maxScanBytes: { type: "number", minimum: 1 },
  maxFileBytes: { type: "number", minimum: 1 },
  maxMatches: { type: "number", minimum: 1 },
  maxPatternBytes: { type: "number", minimum: 1 },
  maxLineBytes: { type: "number", minimum: 1 },
  maxContextLines: { type: "number", minimum: 0 },
  maxTimeMs: { type: "number", minimum: 1 },
  exclude: { type: "array", items: { type: "string", minLength: 1 } },
};

/**
 * The config schema. `root` is deliberately not declared `required`: a required field with no
 * default would fail package conformance, so `setup` checks it and names the field instead
 * (plan 152 Task 6's config rule).
 */
export const toolsCodingConfigSchema: JsonSchema = {
  type: "object",
  properties: {
    root: { type: "string", minLength: 1, maxLength: 4096 },
    roots: { type: "array", items: { type: "string", minLength: 1, maxLength: 4096 }, maxItems: 64 },
    readOnly: { type: "boolean", default: false },
    shell: {
      type: "object",
      properties: {
        enabled: { type: "boolean", default: true },
        timeoutMs: { type: "number", minimum: 1, maximum: 3_600_000 },
        background: {
          type: "object",
          properties: {
            maxProcesses: { type: "number", minimum: 1, maximum: 16, default: 4 },
          },
        },
      },
    },
    language: {
      type: "object",
      properties: {
        servers: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              command: { type: "string", minLength: 1, maxLength: 4096 },
              args: { type: "array", maxItems: 64, items: { type: "string", maxLength: 4096 } },
              languages: { type: "array", minItems: 1, maxItems: 32, items: { type: "string", minLength: 1, maxLength: 64 } },
              env: { type: "object", additionalProperties: { type: "string", maxLength: 4096 } },
            },
            required: ["command", "languages"],
          },
        },
      },
    },
    repository: { type: "object", properties: repositoryProperties },
    git: {
      type: "object",
      properties: { enabled: { type: "boolean", default: true } },
    },
    checks: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          file: { type: "string", minLength: 1, maxLength: 4096 },
          args: { type: "array", maxItems: 256, items: { type: "string", maxLength: 4096 } },
          cwd: { type: "string", minLength: 1, maxLength: 4096 },
          env: { type: "object", additionalProperties: { type: "string", maxLength: 4096 } },
          timeoutMs: { type: "number", minimum: 1, maximum: 3_600_000 },
        },
        required: ["file", "args"],
      },
    },
    todo: {
      type: "object",
      properties: {
        enabled: { type: "boolean", default: true },
        continueOnOpen: { type: "boolean", default: true },
      },
    },
    principal: {
      type: "object",
      properties: { id: { type: "string", minLength: 1, maxLength: 256 } },
    },
    forge: {
      type: "object",
      properties: {
        token: { type: "string", minLength: 1, maxLength: 4096, pattern: "^(env|keyring):" },
      },
    },
    sandbox: { type: "string", enum: ["none", "native", "docker", "e2b"], default: "none" },
    workspace: {
      type: "object",
      properties: {
        enabled: { type: "boolean", default: true },
        worktreeRoot: { type: "string", minLength: 1, maxLength: 4096 },
        maxWorktrees: { type: "number", minimum: 1, maximum: 16 },
        diff: {
          type: "object",
          properties: {
            maxFiles: { type: "number", minimum: 1, maximum: 2000 },
            maxBytes: { type: "number", minimum: 1, maximum: 8_388_608 },
          },
        },
      },
    },
    commandRules: {
      type: "array",
      maxItems: 256,
      items: {
        type: "object",
        properties: {
          match: { type: "string", minLength: 1, maxLength: 4096 },
          decision: { type: "string", enum: ["allow", "deny", "requireApproval"] },
          reason: { type: "string", maxLength: 512 },
        },
      },
    },
    egress: {
      type: "object",
      properties: {
        allow: {
          type: "array",
          maxItems: 1024,
          items: {
            type: "object",
            properties: {
              host: { type: "string", minLength: 1, maxLength: 253 },
              port: { type: "number", minimum: 1, maximum: 65_535 },
              protocol: { type: "string", enum: ["http", "https"] },
              allowPrivate: { type: "boolean", default: false },
            },
          },
        },
        presets: { type: "array", maxItems: 8, items: { type: "string", enum: ["npm-registry", "github"] } },
      },
    },
  },
};
