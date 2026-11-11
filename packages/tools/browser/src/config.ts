import type { JsonSchema } from "@arnilo/prism";

/** Host attestation that real egress is forced through an isolated proxy/firewall. */
export interface ToolsBrowserProxyConfig {
  readonly proxyEndpoint: string;
  readonly denyDirectEgress: true;
}

/** Validated `packageConfig` for `@arnilo/prism-tools/browser`. */
export interface ToolsBrowserConfig {
  /** Launch a headless Chromium through `playwright-core` (default `true`). */
  readonly headless?: boolean;
  /** Absolute path to a host-pinned browser binary passed to `chromium.launch`. */
  readonly executablePath?: string;
  /** Playwright channel (for example `"chromium"` or `"chrome"`) passed to `chromium.launch`. */
  readonly channel?: string;
  /**
   * Origin allowlist. When set, navigation and subrequests to any other origin are hard-denied.
   * Omit to leave origin decisions to `containedProxy` and the default scheme/host denies.
   */
  readonly allowOrigins?: readonly string[];
  /** Host contained-proxy attestation; without it every external request is denied (fail closed). */
  readonly containedProxy?: ToolsBrowserProxyConfig;
  /** Allow loopback destinations (default `false`). */
  readonly allowLoopback?: boolean;
  /** Allow private/link-local/ULA destinations (default `false`). */
  readonly allowPrivateHosts?: boolean;
  /** Absolute roots uploads may read from (realpath-contained; symlink escapes rejected). */
  readonly uploadRoots?: readonly string[];
  /** Absolute quarantine directory; enables download support when set. */
  readonly quarantine?: string;
  /** CDP capability gating: `"auto"` (default), `"on"`, or `"off"`. */
  readonly cdp?: "auto" | "on" | "off";
}

const originList: JsonSchema = {
  type: "array",
  items: { type: "string", minLength: 1, maxLength: 4096 },
  maxItems: 64,
};

const pathList: JsonSchema = {
  type: "array",
  items: { type: "string", minLength: 1, maxLength: 4096 },
  maxItems: 64,
};

/** The config schema. Every undeclared key fails closed. */
export const toolsBrowserConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    headless: { type: "boolean", default: true },
    executablePath: { type: "string", minLength: 1, maxLength: 4096 },
    channel: { type: "string", minLength: 1, maxLength: 128 },
    allowOrigins: originList,
    containedProxy: {
      type: "object",
      additionalProperties: false,
      required: ["proxyEndpoint", "denyDirectEgress"],
      properties: {
        proxyEndpoint: { type: "string", minLength: 1, maxLength: 4096 },
        denyDirectEgress: { type: "boolean", enum: [true] },
      },
    },
    allowLoopback: { type: "boolean", default: false },
    allowPrivateHosts: { type: "boolean", default: false },
    uploadRoots: pathList,
    quarantine: { type: "string", minLength: 1, maxLength: 4096 },
    cdp: { type: "string", enum: ["auto", "on", "off"], default: "auto" },
  },
};
