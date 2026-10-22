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
  },
};
