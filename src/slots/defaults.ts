import { createDefaultCompactor } from "../compaction.js";
import { createEnvRefCredentialResolver } from "../credentials/index.js";
import { defaultLoop } from "../loop/index.js";
import { createMemorySessionStore } from "../session-stores.js";
import type { SlotContracts } from "./types.js";

/** The kernel defaults for all four slots. A fresh memory store is created per call. */
export function createSlotDefaults(): SlotContracts {
  return {
    loop: defaultLoop,
    compaction: createDefaultCompactor(),
    store: createMemorySessionStore(),
    credentials: createEnvRefCredentialResolver(),
  };
}
