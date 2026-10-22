import type { JsonSchema } from "@arnilo/prism";

export interface McpHeaderSecretRef {
  readonly ref: string;
  readonly prefix?: string;
}

export type McpEnvValue = string | { readonly ref: string };

export interface McpStdioServerConfig {
  readonly id: string;
  readonly transport: "stdio";
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, McpEnvValue>>;
  readonly allow?: string | readonly string[];
  readonly namePrefix?: string;
  readonly connectTimeoutMs?: number;
  readonly readOnly?: boolean;
  readonly enabled?: boolean;
}

export interface McpHttpServerConfig {
  readonly id: string;
  readonly transport: "http" | "streamable-http" | "sse";
  readonly url: string;
  readonly headers?: Readonly<Record<string, McpHeaderSecretRef>>;
  readonly allowedOrigins?: readonly string[];
  readonly allow?: string | readonly string[];
  readonly namePrefix?: string;
  readonly connectTimeoutMs?: number;
  readonly readOnly?: boolean;
  readonly enabled?: boolean;
}

export interface McpRawServerConfig {
  readonly id: string;
  readonly transport: "raw";
  readonly allow?: string | readonly string[];
  readonly namePrefix?: string;
  readonly connectTimeoutMs?: number;
  readonly readOnly?: boolean;
  readonly enabled?: boolean;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig | McpRawServerConfig;

export interface McpPackageConfig {
  readonly servers?: readonly McpServerConfig[];
  readonly allow?: string | readonly string[];
  readonly trusted?: readonly string[];
  readonly connectTimeoutMs?: number;
}

const SECRET_REF_PATTERN = "^(env|keyring):[A-Za-z0-9_.\\-/]+$";

const headerSecretRefSchema: JsonSchema = {
  type: "object",
  properties: {
    ref: { type: "string", pattern: SECRET_REF_PATTERN },
    prefix: { type: "string" },
  },
  required: ["ref"],
  additionalProperties: false,
};

const envValueSchema: JsonSchema = {
  oneOf: [
    { type: "string" },
    {
      type: "object",
      properties: {
        ref: { type: "string", pattern: SECRET_REF_PATTERN },
      },
      required: ["ref"],
      additionalProperties: false,
    },
  ],
};

const serverSchema: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1, maxLength: 64 },
    transport: { enum: ["stdio", "http", "streamable-http", "sse", "raw"] },
    command: { type: "string", minLength: 1 },
    args: { type: "array", items: { type: "string" } },
    cwd: { type: "string" },
    env: { type: "object", additionalProperties: envValueSchema },
    url: { type: "string", minLength: 1 },
    headers: { type: "object", additionalProperties: headerSecretRefSchema },
    allowedOrigins: { type: "array", items: { type: "string" } },
    allow: {
      oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
    },
    namePrefix: { type: "string" },
    connectTimeoutMs: { type: "integer", minimum: 1 },
    readOnly: { type: "boolean" },
    enabled: { type: "boolean" },
  },
  required: ["id", "transport"],
  additionalProperties: false,
};

export const mcpConfigSchema: JsonSchema = {
  type: "object",
  properties: {
    servers: { type: "array", items: serverSchema },
    allow: {
      oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
    },
    trusted: { type: "array", items: { type: "string" } },
    connectTimeoutMs: { type: "integer", minimum: 1 },
  },
  additionalProperties: false,
};
