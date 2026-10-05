import type { CredentialResolver, Secret } from "../contracts.js";

/** `env:NAME` resolver: only a ref of the form `env:NAME` resolves; anything else is `undefined`. */
export function createEnvRefCredentialResolver(env: Readonly<Record<string, string | undefined>> = process.env): CredentialResolver {
  return {
    resolve(ref: string): Secret | undefined {
      if (!ref.startsWith("env:")) return undefined;
      const envName = ref.slice("env:".length);
      const value = envName.length === 0 ? undefined : env[envName];
      return value ? { type: "api_key", value, metadata: { source: "env", envName } } : undefined;
    },
    // No `store`: this resolver reads the environment, it cannot persist into it. A `secret` request
    // therefore answers `unavailable` and the asking package fails closed. Phase 5's keyring resolver
    // implements `store`.
  };
}
