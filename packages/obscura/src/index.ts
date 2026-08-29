export type { ObscuraCdpSession, ObscuraChromium, ObscuraPlaywright } from "./cdp.js";
export { connectObscuraCdp, endpointFromServeArgs, validateObscuraEndpoint } from "./cdp.js";
export { isObscuraReadTool } from "./classify.js";
export type { ObscuraCliRunOptions, ObscuraCliRunResult } from "./cli.js";
export { runObscuraCli, validateObscuraWebUrl } from "./cli.js";
export { ObscuraError } from "./errors.js";
export {
  DEFAULT_OBSCURA_PROCESS_LIMITS,
  DEFAULT_OBSCURA_WEB_LIMITS,
  HARD_OBSCURA_PROCESS_LIMITS,
  HARD_OBSCURA_WEB_LIMITS,
  type ObscuraProcessLimits,
  type ObscuraWebLimits,
  resolveObscuraProcessLimits,
  resolveObscuraWebLimits,
} from "./limits.js";
export {
  createObscuraMcpTools,
  DEFAULT_OBSCURA_NAME_PREFIX,
  DEFAULT_OBSCURA_SERVER_ID,
  ObscuraMcpError,
  type ObscuraMcpTools,
  type ObscuraMcpToolsOptions,
} from "./mcp.js";
export { spawnObscuraProcess, validateObscuraCommand } from "./process.js";
export { DEFAULT_OBSCURA_SEARCH_PROFILE, type ObscuraSearchProfile, resolveObscuraSearchProfile } from "./search-profile.js";
export type {
  ObscuraCloseOptions,
  ObscuraExit,
  ObscuraProcessOptions,
  OwnedObscuraProcess,
} from "./types.js";
export { createObscuraWebTools, type ObscuraWebTools, type ObscuraWebToolsOptions } from "./web.js";

export const packageName = "@arnilo/prism-obscura";
