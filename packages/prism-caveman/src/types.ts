import type { SessionEntry } from "@arnilo/prism";

import type { ResolveUpstreamRootOptions } from "./upstream.js";

export type CavemanLevel = "off" | "lite" | "full" | "ultra" | "wenyan-lite" | "wenyan" | "wenyan-ultra" | "micro";

export interface CavemanAppendOptions {
  readonly expectedParentId?: string;
}

export interface CavemanExtensionOptions extends ResolveUpstreamRootOptions {
  readonly defaultLevel?: CavemanLevel;
  readonly showStatus?: boolean;
  readonly appendEntry: (entry: SessionEntry, options?: CavemanAppendOptions) => Promise<void>;
  readonly getEntries: () => readonly SessionEntry[] | Promise<readonly SessionEntry[]>;
  readonly configPath?: string;
}

export interface CavemanExtensionState {
  readonly upstreamRoot: string;
  readonly level: CavemanLevel;
}
