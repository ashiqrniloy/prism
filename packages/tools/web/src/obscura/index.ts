export type { ObscuraCdpSession, ObscuraChromium, ObscuraPlaywright } from "./cdp.js";
export { connectObscuraCdp, endpointFromServeArgs, validateObscuraEndpoint } from "./cdp.js";
export { isObscuraReadTool } from "./classify.js";
export type {
  ObscuraCliRunOptions,
  ObscuraCliRunResult,
  ObscuraVersionProbe,
  ObscuraVersionProbeOptions,
  ValidateObscuraUrlOptions,
} from "./cli.js";
export {
  OBSCURA_GUARDED_VERSION,
  obscuraVersionIsGuarded,
  parseObscuraVersion,
  probeObscuraVersion,
  runObscuraCli,
  validateObscuraWebUrl,
} from "./cli.js";
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
export { resolveObscuraCommand, spawnObscuraProcess, validateObscuraCommand } from "./process.js";
export type {
  PlaywrightBrowser,
  PlaywrightBrowserContext,
  PlaywrightCdpSession,
  PlaywrightDialog,
  PlaywrightDownload,
  PlaywrightLocator,
  PlaywrightPage,
  PlaywrightRequest,
  PlaywrightRoute,
} from "./playwright.js";
export { DEFAULT_OBSCURA_SEARCH_PROFILE, type ObscuraSearchProfile, resolveObscuraSearchProfile } from "./search-profile.js";
export type {
  ObscuraCloseOptions,
  ObscuraExit,
  ObscuraProcessOptions,
  OwnedObscuraProcess,
} from "./types.js";
export { createObscuraWebTools, type ObscuraWebTools, type ObscuraWebToolsOptions } from "./web.js";

export const packageName = "@arnilo/prism-tools-web";
