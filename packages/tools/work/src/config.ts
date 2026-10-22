import type { JsonObject, JsonSchema } from "@arnilo/prism";

/** Office tool group settings. `enabled: false` registers no `office_*` tool. */
export interface ToolsWorkOfficeConfig {
  /** Default `true`. */
  readonly enabled?: boolean;
  /** Document byte cap handed to the OOXML stack. */
  readonly maxBytes?: number;
}

/** One connector's settings. `credential` is ref-only; the rest is host-declared adapter config. */
export interface ToolsWorkConnectorConfig {
  /** `env:NAME` or `keyring:NAME`; a literal fails config validation. */
  readonly credential: string;
  /** CLI binary name or absolute path. Default `m365` / `gws`. */
  readonly binary?: string;
  /** Host config directory for the CLI. Required together with `identity`. */
  readonly configDir?: string;
  /** `AgentIdentity` fields as JSON; `verified: true` is added by setup. */
  readonly identity?: JsonObject;
  /** Provider operations to allow; default is the adapter's default set. */
  readonly allowedOps?: readonly string[];
}

/** Connector group settings. A provider with no resolvable credential registers nothing. */
export interface ToolsWorkConnectorsConfig {
  readonly microsoft365?: ToolsWorkConnectorConfig;
  readonly google?: ToolsWorkConnectorConfig;
}

/** Reader service settings. The reader is provided as `work.reader`, not registered as a tool. */
export interface ToolsWorkReaderConfig {
  /** Formats to keep. Default all four. A format whose optional peer is missing is dropped with a note. */
  readonly formats?: readonly ("pdf" | "docx" | "xlsx" | "pptx")[];
  readonly maxBytes?: number;
  readonly maxPages?: number;
  readonly maxTextBytes?: number;
  /** Mistral OCR parser; off by default (one external call per page). */
  readonly ocr?: {
    readonly provider: "mistral";
    /** `env:NAME` or `keyring:NAME`; a literal fails config validation. */
    readonly apiKey: string;
    readonly baseUrl?: string;
    readonly model?: string;
  };
}

/** Validated `packageConfig` for `@arnilo/prism-tools-work`. */
export interface ToolsWorkConfig {
  /** Absolute workspace root the file-touching tools operate in. Required; checked in `setup`. */
  readonly root?: string;
  /** Office document tools. Default `{ enabled: true }`. */
  readonly office?: ToolsWorkOfficeConfig;
  /** `work_exec` inside the host-injected `work.sandbox` service. Default `{ enabled: true }`. */
  readonly work?: { readonly enabled?: boolean };
  /** Connector tools; each provider registers only with a resolvable credential. */
  readonly connectors?: ToolsWorkConnectorsConfig;
  /** The `work.reader` service. */
  readonly reader?: ToolsWorkReaderConfig;
  /** Non-token env entries for the sandbox. `M365_*` / `GOOGLE_*` names are refused. */
  readonly env?: Readonly<Record<string, string>>;
}

const secretString: JsonSchema = {
  type: "string",
  minLength: 1,
  maxLength: 4096,
  pattern: "^(env|keyring):",
  "x-prism-secret": true,
};

const connectorProperties: Readonly<Record<string, JsonSchema>> = {
  credential: secretString,
  binary: { type: "string", minLength: 1, maxLength: 4096 },
  configDir: { type: "string", minLength: 1, maxLength: 4096 },
  identity: { type: "object", additionalProperties: true },
  allowedOps: { type: "array", maxItems: 64, items: { type: "string", minLength: 1, maxLength: 128 } },
};

const connectorObject: JsonSchema = {
  type: "object",
  required: ["credential"],
  properties: connectorProperties,
};

/**
 * The config schema. `root` is deliberately not declared `required`: a required field with no
 * default would fail package conformance, so `setup` checks it and names the field instead.
 * `connectors.*.credential` and `reader.ocr.apiKey` are ref-only secret fields; a literal fails validation.
 */
export const toolsWorkConfigSchema: JsonSchema = {
  type: "object",
  properties: {
    root: { type: "string", minLength: 1, maxLength: 4096 },
    office: {
      type: "object",
      properties: {
        enabled: { type: "boolean", default: true },
        maxBytes: { type: "number", minimum: 1 },
      },
    },
    work: {
      type: "object",
      properties: { enabled: { type: "boolean", default: true } },
    },
    connectors: {
      type: "object",
      properties: {
        microsoft365: connectorObject,
        google: connectorObject,
      },
    },
    reader: {
      type: "object",
      properties: {
        formats: {
          type: "array",
          maxItems: 4,
          items: { type: "string", enum: ["pdf", "docx", "xlsx", "pptx"] },
        },
        maxBytes: { type: "number", minimum: 1 },
        maxPages: { type: "number", minimum: 1 },
        maxTextBytes: { type: "number", minimum: 1 },
        ocr: {
          type: "object",
          required: ["provider", "apiKey"],
          properties: {
            provider: { type: "string", enum: ["mistral"] },
            apiKey: secretString,
            baseUrl: { type: "string", minLength: 1, maxLength: 2048 },
            model: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    env: { type: "object", additionalProperties: { type: "string", maxLength: 4096 } },
  },
};
