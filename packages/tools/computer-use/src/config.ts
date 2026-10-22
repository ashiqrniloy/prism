import type { JsonSchema, RunLimits } from "@arnilo/prism";

/** Host-declared desktop device policy; admission stays deny-by-default in the tool. */
export interface ToolsComputerUseDeviceConfig {
  /** Deny-by-default: admission fails unless this is explicitly `true`. */
  readonly enabled?: boolean;
  /** Approval is required unless the host explicitly opts out. Default `true`. */
  readonly requireApproval?: boolean;
  /** Host-owned sandbox identifier; admission fails closed without it. */
  readonly sandbox: string;
  /** Host-owned network/egress policy identifier. */
  readonly network?: string;
  /** Chunk and concurrent-session bounds. */
  readonly limits?: {
    readonly maxChunkBytes?: number;
    readonly maxConcurrentSessions?: number;
  };
}

/** Validated `packageConfig` for `@arnilo/prism-tools-computer-use`. */
export interface ToolsComputerUseConfig {
  /** Host-owned executable. Default `"computer-use-linux"`. */
  readonly command?: string;
  /** Executable arguments. Default `["mcp"]`. */
  readonly args?: readonly string[];
  /** X11 display the child should target; sets `DISPLAY` in the child environment. */
  readonly display?: string;
  /** Expose the host-only `setup_*` tools. Default `false`. */
  readonly includeSetupTools?: boolean;
  /** Host approval for mutating desktop calls. Default `false`. */
  readonly approved?: boolean;
  /** Required; checked in `setup` with a naming error. */
  readonly device?: ToolsComputerUseDeviceConfig;
  /** Required; shared run accounting the device session must consume. */
  readonly runLimits?: RunLimits;
}

/**
 * The config schema. `device` and `runLimits` are deliberately not declared `required`: a required
 * field with no default would fail package conformance, so `setup` checks them and names the field
 * instead. `runLimits` accepts any JSON object and is passed through to device admission.
 */
export const toolsComputerUseConfigSchema: JsonSchema = {
  type: "object",
  properties: {
    command: { type: "string", minLength: 1, maxLength: 4096 },
    args: { type: "array", items: { type: "string" } },
    display: { type: "string", minLength: 1, maxLength: 256 },
    includeSetupTools: { type: "boolean", default: false },
    approved: { type: "boolean", default: false },
    device: {
      type: "object",
      properties: {
        enabled: { type: "boolean", default: false },
        requireApproval: { type: "boolean", default: true },
        sandbox: { type: "string", minLength: 1, maxLength: 256 },
        network: { type: "string", minLength: 1, maxLength: 256 },
        limits: {
          type: "object",
          properties: {
            maxChunkBytes: { type: "number", minimum: 1 },
            maxConcurrentSessions: { type: "number", minimum: 1 },
          },
        },
      },
    },
    runLimits: { type: "object", additionalProperties: true },
  },
};
