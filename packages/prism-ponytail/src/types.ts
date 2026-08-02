import type { SessionEntry } from "@arnilo/prism";

import type { ResolveUpstreamRootOptions } from "./upstream.js";

export type PonytailMode = "off" | "lite" | "full" | "ultra";

export interface PonytailAppendOptions {
  readonly expectedParentId?: string;
}

export interface PonytailExtensionOptions extends ResolveUpstreamRootOptions {
  readonly defaultMode?: PonytailMode;
  readonly quietStartup?: boolean;
  readonly appendEntry: (entry: SessionEntry, options?: PonytailAppendOptions) => Promise<void>;
  readonly getEntries: () => readonly SessionEntry[] | Promise<readonly SessionEntry[]>;
  readonly configPath?: string;
}

export interface PonytailExtensionState {
  readonly upstreamRoot: string;
  readonly mode: PonytailMode;
}
