import type { CredentialResolver } from "../contracts.js";
/** `env:NAME` resolver: only a ref of the form `env:NAME` resolves; anything else is `undefined`. */
export declare function createEnvRefCredentialResolver(env?: Readonly<Record<string, string | undefined>>): CredentialResolver;
