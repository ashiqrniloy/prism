import type { JsonSchema } from "@arnilo/prism";

/**
 * Package config for `@arnilo/prism-context-files`. `root` is required and is
 * checked in `setup` (not as a JSON Schema `required` entry) so a config that
 * omits it fails with a field-naming error instead of a schema-default failure.
 */
export interface ContextFilesConfig {
  /** Workspace root. `AGENTS.md` is searched from here up to the enclosing trusted root. */
  readonly root?: string;
  /** Load `AGENTS.md` layers. Default `true`. */
  readonly agentsMd?: boolean;
  /** Load the `SYSTEM.md` layer under `root` (and under `globalRoot` when set). Default `true`. */
  readonly systemMd?: boolean;
  /** Global config root. Reads `<globalRoot>/.prism/agent/SYSTEM.md`. Default none: no home scan. */
  readonly globalRoot?: string;
  /** Extra trusted roots for the file trust gate. Default `[root]`. */
  readonly trustedRoots?: readonly string[];
  /** Extra explicit instruction files (project-source layers). Each is trusted by being named. */
  readonly files?: readonly string[];
  /** Just-in-time nested `AGENTS.md` / `CLAUDE.md`. Default `true`. */
  readonly nested?:
    | boolean
    | {
        /** Largest nested file read; default 16,384, hard cap 65,536. */
        readonly maxFileBytes?: number;
        /** Most distinct nested files inserted per session; default 16, hard cap 16. */
        readonly maxFiles?: number;
      };
  /** SKILL.md discovery. Enabled by default; `roots` replaces the standard skill roots when given. */
  readonly skills?: {
    /** Discover and register skills at setup. Default `true`. */
    readonly enabled?: boolean;
    /** Skill roots, relative to `root` unless absolute. Replaces the default `.agents` / `.claude` roots. */
    readonly roots?: readonly string[];
  };
}

export const contextFilesConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    root: { type: "string", minLength: 1, maxLength: 4096, description: "Workspace root to read AGENTS.md / SYSTEM.md from." },
    agentsMd: { type: "boolean", default: true, description: "Load AGENTS.md layers." },
    systemMd: { type: "boolean", default: true, description: "Load the SYSTEM.md layer." },
    globalRoot: { type: "string", minLength: 1, maxLength: 4096, description: "Global root holding .prism/agent/SYSTEM.md." },
    trustedRoots: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 4096 },
      maxItems: 64,
      default: [],
      description: "Extra trusted roots for the file trust gate.",
    },
    files: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 4096 },
      maxItems: 64,
      default: [],
      description: "Extra explicit instruction files, trusted by being named.",
    },
    nested: {
      oneOf: [
        { type: "boolean" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            maxFileBytes: {
              type: "integer",
              minimum: 1,
              maximum: 65_536,
              default: 16_384,
              description: "Largest nested AGENTS.md / CLAUDE.md file read.",
            },
            maxFiles: {
              type: "integer",
              minimum: 1,
              maximum: 16,
              default: 16,
              description: "Most distinct nested instruction files inserted per session.",
            },
          },
        },
      ],
      default: true,
      description: "Load a subtree's AGENTS.md / CLAUDE.md after the first tool result that touches it.",
    },
    skills: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean", default: true, description: "Discover and register SKILL.md files." },
        roots: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 4096 },
          maxItems: 64,
          description: "Skill roots, relative to root unless absolute. Replaces the default roots.",
        },
      },
    },
  },
};
