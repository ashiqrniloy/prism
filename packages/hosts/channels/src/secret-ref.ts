import type { Agent, CredentialResolver, SecretRedactor } from "@arnilo/prism";
import { createEnvRefCredentialResolver, redactSecrets } from "@arnilo/prism";

export const CHANNEL_TOKEN_LITERAL_CODE = "ERR_PRISM_CHANNEL_TOKEN_LITERAL";

export class ChannelTokenLiteralError extends Error {
  readonly code = CHANNEL_TOKEN_LITERAL_CODE;
  constructor(message = "Channel credential must be a ref (env: or keyring:), not a literal secret") {
    super(message);
    this.name = "ChannelTokenLiteralError";
  }
}

/** A lazily resolved channel secret (the kit's `SecretSource` shape). `connect*` builds it from a ref. */
export type ChannelSecretSource = () => Promise<string>;

/**
 * Resolves an `env:`/`keyring:` ref through the agent's directly assigned credentials slot, else the
 * kernel's `env:` resolver. A literal fails with {@link ChannelTokenLiteralError}; an unresolved ref fails closed.
 */
export async function resolveChannelSecretRef(agent: Agent, ref: string): Promise<string> {
  if (typeof ref !== "string" || (!ref.startsWith("env:") && !ref.startsWith("keyring:"))) {
    throw new ChannelTokenLiteralError();
  }
  const assigned = agent.config?.slots?.credentials;
  const resolver: CredentialResolver = typeof assigned === "object" ? assigned : createEnvRefCredentialResolver();
  const resolved = (await resolver.resolve(ref, { package: "@arnilo/prism-channels" }))?.value;
  if (!resolved || resolved.trim().length === 0) {
    throw new Error(`Failed to resolve channel credential reference: ${ref}`);
  }
  return resolved;
}

export function createChannelRedactor(secret: string | readonly string[], agentRedactor?: SecretRedactor): SecretRedactor {
  const secrets = typeof secret === "string" ? [secret] : secret;
  return {
    redact<T>(value: T): T {
      const masked = redactSecrets(value, secrets);
      return agentRedactor ? agentRedactor.redact(masked) : masked;
    },
  };
}
