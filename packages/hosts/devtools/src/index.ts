/**
 * `@arnilo/prism-hosts/devtools`: a loopback developer inspector over one Prism `Agent`.
 *
 * `serveDevtools(agent, { port })` serves the page and its JSON routes. Each route reads the public
 * `Agent` API only. The `prism-devtools` bin serves a manifest-built agent with the same server.
 */

export { type DevtoolsArgs, DevtoolsArgsError, type DevtoolsModel, parseDevtoolsArgs } from "./args.js";
export {
  compareInspectorRuns,
  type InspectorCompareSide,
  type InspectorCompareWinner,
  type InspectorComparison,
  parseInspectorCompareBody,
} from "./compare.js";
export { DevtoolsError } from "./errors.js";
export { REPLAY_DEFAULT_LIMIT, REPLAY_MAX_LIMIT, type ReplayPage, replayPage } from "./replay.js";
export {
  DEVTOOLS_DEFAULT_HOSTNAME,
  DEVTOOLS_DEFAULT_PORT,
  type DevtoolsOptions,
  type DevtoolsServer,
  type ServeDevtoolsOptions,
  serveDevtools,
} from "./serve.js";
