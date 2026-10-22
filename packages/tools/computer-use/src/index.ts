/**
 * `@arnilo/prism-tools-computer-use` — the `computer-use-linux` MCP binary as Prism tools.
 *
 * `setup` resolves the host-owned executable on `PATH` and connects over stdio. A missing binary or
 * a refused device admission notes why and registers nothing. Every tool declares
 * `effects: ["external"]`, so the host approval hook sees it; mutating calls additionally pass
 * in-tool device admission (`assertDeviceAdmit`), which denies unless the host explicitly enabled
 * the device, supplied a sandbox, and approved. The bundled desktop procedure registers as the
 * `computer-use-linux` skill.
 *
 * ```ts
 * import toolsComputerUse from "@arnilo/prism-tools-computer-use";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model,
 *   packages: [
 *     toolsComputerUse({
 *       display: ":0",
 *       device: { enabled: true, requireApproval: true, sandbox: "linux-desktop" },
 *       runLimits: { maxTurns: 32, maxToolCalls: 200 },
 *     }),
 *   ],
 * });
 * ```
 */

import { definePackage, type PackageInstance } from "@arnilo/prism";
import manifest from "../package.json" with { type: "json" };

import { resolveCommand } from "./command.js";
import { type ToolsComputerUseConfig, toolsComputerUseConfigSchema } from "./config.js";
import {
  type ComputerUseLinuxConnect,
  type ComputerUseLinuxTools,
  type ComputerUseLinuxToolsOptions,
  createComputerUseLinuxTools,
} from "./create.js";
import { buildChildEnv, DEFAULT_CHILD_ENV_INHERIT } from "./env.js";
import { loadComputerUseLinuxSkill } from "./skill.js";

export {
  COMPUTER_USE_LINUX_MUTATING_TOOLS,
  COMPUTER_USE_LINUX_READ_TOOLS,
  COMPUTER_USE_LINUX_SETUP_TOOLS,
  COMPUTER_USE_LINUX_TOOL_NAMES,
  classifyComputerUseLinuxTool,
  isComputerUseLinuxTool,
} from "./classify.js";
export { resolveCommand } from "./command.js";
export type { ToolsComputerUseConfig, ToolsComputerUseDeviceConfig } from "./config.js";
export { toolsComputerUseConfigSchema } from "./config.js";
export {
  type ComputerUseLinuxConnect,
  type ComputerUseLinuxTools,
  type ComputerUseLinuxToolsOptions,
  createComputerUseLinuxTools,
} from "./create.js";
export type {
  DeviceAdapter,
  DeviceAdmitRequest,
  DeviceChunkResult,
  DeviceConformanceResult,
  DeviceKind,
  DevicePolicyErrorCode,
  DevicePolicyOptions,
  DeviceStreamLimits,
  ResolvedDevicePolicy,
} from "./devices.js";
export {
  acceptDeviceChunk,
  assertDeviceAdmit,
  DEFAULT_DEVICE_MAX_CHUNK_BYTES,
  DEFAULT_DEVICE_MAX_CONCURRENT_SESSIONS,
  DevicePolicyError,
  HARD_DEVICE_MAX_CHUNK_BYTES,
  HARD_DEVICE_MAX_CONCURRENT_SESSIONS,
  redactDeviceTelemetry,
  resolveDevicePolicy,
  runDevicePolicyConformance,
} from "./devices.js";
export { buildChildEnv, DEFAULT_CHILD_ENV_INHERIT } from "./env.js";
export { COMPUTER_USE_LINUX_SKILL_NAME, loadComputerUseLinuxSkill, MAX_SKILL_FILE_BYTES } from "./skill.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const definition = definePackage<ToolsComputerUseConfig>({
  name: "@arnilo/prism-tools-computer-use",
  version: manifest.version,
  description:
    "Linux desktop observation and targeting over the host-owned computer-use-linux MCP binary, with in-tool device admission and declared external effects.",
  requires: { api: 1 },
  config: toolsComputerUseConfigSchema,
  setup: async (prism) => {
    const device = prism.config.device;
    if (device === undefined || typeof device.sandbox !== "string" || device.sandbox.length === 0) {
      prism.status.note("warn", "computer-use: config needs device.sandbox (a host-owned sandbox id)");
      return;
    }
    const runLimits = prism.config.runLimits;
    if (runLimits === undefined) {
      prism.status.note("warn", "computer-use: config needs runLimits (shared run accounting)");
      return;
    }
    const command = prism.config.command ?? "computer-use-linux";
    const resolved = resolveCommand(command);
    if (resolved === undefined) {
      prism.status.note("warn", `computer-use: ${command} not found on PATH; install the host binary`);
      return;
    }

    // Host/test override: a package may provide its own MCP bridge instead of the bundled one.
    const connect = prism.services.consume<ComputerUseLinuxConnect>("computer-use.mcp");
    const options: ComputerUseLinuxToolsOptions = {
      command: resolved,
      device: {
        kind: "desktop-control",
        enabled: device.enabled === true,
        requireApproval: device.requireApproval !== false,
        sandbox: device.sandbox,
        ...(device.network !== undefined ? { network: device.network } : {}),
        ...(device.limits !== undefined ? { limits: device.limits } : {}),
      },
      runLimits,
      approved: prism.config.approved === true,
      includeSetupTools: prism.config.includeSetupTools === true,
      ...(prism.config.args !== undefined ? { args: prism.config.args } : {}),
      ...(prism.config.display !== undefined
        ? { env: buildChildEnv({ inherit: DEFAULT_CHILD_ENV_INHERIT, set: { DISPLAY: prism.config.display } }) }
        : {}),
      ...(connect !== undefined ? { connect } : {}),
    };

    let desktop: ComputerUseLinuxTools;
    try {
      desktop = await createComputerUseLinuxTools(options);
    } catch (error) {
      prism.status.note("warn", `computer-use: ${errorMessage(error)}`);
      return;
    }
    for (const tool of desktop.tools) prism.tools.register(tool);
    prism.skills.register(loadComputerUseLinuxSkill());
    prism.onDispose(() => desktop.close());
  },
});

/** The package definition. Pass config through `packageConfig` or use {@link toolsComputerUse}. */
export default definition;

/** The package with config baked in, for `packages: [toolsComputerUse({ device, runLimits })]`. */
export function toolsComputerUse(config: ToolsComputerUseConfig): PackageInstance {
  return definition(config);
}

export const packageName = "@arnilo/prism-tools-computer-use";
