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
  readonly callTimeoutMs?: number;
  readonly maxCallTimeMs?: number;
  readonly readOnly?: boolean;
  readonly enabled?: boolean;
}

/**
 * OAuth sign-in for an HTTP server. `tokens` is a writable `keyring:` ref that holds the whole sign-in
 * record (tokens, client registration, discovery, PKCE verifier, authorization state) as one JSON record.
 */
export interface McpOAuthConfig {
  readonly kind: "oauth";
  readonly tokens: string;
  readonly scopes?: readonly string[];
  /** A static client id, or an `https://` client metadata URL (CIMD). Omitted: dynamic registration. */
  readonly clientId?: string;
  /** `listen` (default) binds a loopback listener; `paste` asks `host.ui` for the full callback URL. */
  readonly callback?: "listen" | "paste";
}

export interface McpHttpServerConfig {
  readonly id: string;
  readonly transport: "http" | "streamable-http" | "sse";
  readonly url: string;
  readonly headers?: Readonly<Record<string, McpHeaderSecretRef>>;
  readonly auth?: McpOAuthConfig;
  readonly allowedOrigins?: readonly string[];
  readonly allow?: string | readonly string[];
  readonly namePrefix?: string;
  readonly connectTimeoutMs?: number;
  readonly callTimeoutMs?: number;
  readonly maxCallTimeMs?: number;
  readonly readOnly?: boolean;
  readonly enabled?: boolean;
}

export interface McpRawServerConfig {
  readonly id: string;
  readonly transport: "raw";
  readonly allow?: string | readonly string[];
  readonly namePrefix?: string;
  readonly connectTimeoutMs?: number;
  readonly callTimeoutMs?: number;
  readonly maxCallTimeMs?: number;
  readonly readOnly?: boolean;
  readonly enabled?: boolean;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig | McpRawServerConfig;

/** Automatic reconnect after a server drops (default 5 attempts, 1 s doubling to 30 s; `attempts: 0` disables). */
export interface McpReconnectConfig {
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
}

export interface McpPackageConfig {
  readonly servers?: readonly McpServerConfig[];
  readonly allow?: string | readonly string[];
  readonly trusted?: readonly string[];
  /** Bounds connect and the first `tools/list` only (default 15 000). */
  readonly connectTimeoutMs?: number;
  /** Bounds one tool call without progress (default 60 000); each progress notification resets it. */
  readonly callTimeoutMs?: number;
  /** Absolute bound on one tool call, however much progress arrives (default 300 000). */
  readonly maxCallTimeMs?: number;
  readonly reconnect?: McpReconnectConfig;
  /** Bounds on what every server may send: list pages, tools, schema and result bytes, JSON shape, list cache TTL. */
  readonly limits?: McpPackageLimits;
  /** How long a person has to finish an OAuth sign-in, in ms (default 300 000). */
  readonly signInTimeoutMs?: number;
}

/** The host's bounds on server data; each is a positive integer, and the host's value is the cap. */
export interface McpPackageLimits {
  readonly maxListPages?: number;
  readonly maxTools?: number;
  readonly maxCursorBytes?: number;
  readonly maxToolNameBytes?: number;
  readonly maxToolDescriptionBytes?: number;
  readonly maxToolSchemaBytes?: number;
  readonly maxTotalToolSchemaBytes?: number;
  readonly maxJsonDepth?: number;
  readonly maxJsonProperties?: number;
  readonly maxResultBytes?: number;
  readonly listCacheTtlMs?: number;
}

/** Over-cap values fail the load, not one server at connect. */
const timeoutSchema: JsonSchema = { type: "integer", minimum: 1 };

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

/** The sign-in record is written back, so only a writable `keyring:` ref is accepted. */
const oauthSchema: JsonSchema = {
  type: "object",
  properties: {
    kind: { enum: ["oauth"] },
    tokens: { type: "string", pattern: "^keyring:[A-Za-z0-9_.\\-/]+$" },
    scopes: { type: "array", items: { type: "string", minLength: 1 } },
    clientId: { type: "string", minLength: 1 },
    callback: { enum: ["listen", "paste"] },
  },
  required: ["kind", "tokens"],
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
    auth: oauthSchema,
    allowedOrigins: { type: "array", items: { type: "string" } },
    allow: {
      oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
    },
    namePrefix: { type: "string" },
    connectTimeoutMs: timeoutSchema,
    callTimeoutMs: timeoutSchema,
    maxCallTimeMs: timeoutSchema,
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
    connectTimeoutMs: timeoutSchema,
    callTimeoutMs: timeoutSchema,
    maxCallTimeMs: timeoutSchema,
    reconnect: {
      type: "object",
      properties: {
        attempts: { type: "integer", minimum: 0 },
        baseDelayMs: timeoutSchema,
        maxDelayMs: timeoutSchema,
      },
      additionalProperties: false,
    },
    limits: {
      type: "object",
      properties: Object.fromEntries(
        [
          "maxListPages",
          "maxTools",
          "maxCursorBytes",
          "maxToolNameBytes",
          "maxToolDescriptionBytes",
          "maxToolSchemaBytes",
          "maxTotalToolSchemaBytes",
          "maxJsonDepth",
          "maxJsonProperties",
          "maxResultBytes",
          "listCacheTtlMs",
        ].map((key) => [key, { type: "integer", minimum: 1 }]),
      ),
      additionalProperties: false,
    },
    signInTimeoutMs: timeoutSchema,
  },
  additionalProperties: false,
};
