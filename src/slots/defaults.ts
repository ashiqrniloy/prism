import { createDefaultCompactor } from "../compaction.js";
import type { Credential, CredentialRequest, CredentialResolver } from "../contracts.js";
import { defaultLoop } from "../loop/index.js";
import { createMemorySessionStore } from "../session-stores.js";
import type { SlotContracts } from "./types.js";

/** `env:NAME` resolver: only a ref of the form `env:NAME` resolves; anything else is `undefined`. */
export function createEnvRefCredentialResolver(env: Readonly<Record<string, string | undefined>> = process.env): CredentialResolver {
  return {
    resolve(request: CredentialRequest): Credential | undefined {
      const ref = request.name;
      if (!ref.startsWith("env:")) return undefined;
      const envName = ref.slice("env:".length);
      if (envName.length === 0) return undefined;
      const value = env[envName];
      return value ? { type: "api_key", value, metadata: { source: "env", envName } } : undefined;
    },
    // No `store`: this resolver reads the environment, it cannot persist into it. A `secret` request
    // therefore answers `unavailable` and the asking package fails closed. Phase 5's keyring resolver
    // implements it.
  };
}

/** The kernel defaults for all four slots. A fresh memory store is created per call. */
export function createSlotDefaults(): SlotContracts {
  return {
    loop: defaultLoop,
    compaction: createDefaultCompactor(),
    store: createMemorySessionStore(),
    credentials: createEnvRefCredentialResolver(),
  };
}
