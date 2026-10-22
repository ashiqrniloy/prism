import type { Agent, SecretRedactor } from "@arnilo/prism";
import { redactSecrets } from "@arnilo/prism";

export const CHANNEL_TOKEN_LITERAL_CODE = "ERR_PRISM_CHANNEL_TOKEN_LITERAL";

export class ChannelTokenLiteralError extends Error {
  readonly code = CHANNEL_TOKEN_LITERAL_CODE;
  constructor(message = "Channel credential must be a ref (env: or keyring:), not a literal secret") {
    super(message);
    this.name = "ChannelTokenLiteralError";
  }
}

export async function resolveChannelSecretRef(agent: Agent, ref: string): Promise<string> {
  if (typeof ref !== "string" || (!ref.startsWith("env:") && !ref.startsWith("keyring:"))) {
    throw new ChannelTokenLiteralError();
  }
  let resolved: string | undefined;
  if (ref.startsWith("env:")) {
    const varName = ref.slice(4);
    resolved = process.env[varName];
  } else if (ref.startsWith("keyring:")) {
    const credSlot = agent.config?.slots?.credentials;
    if (credSlot && typeof credSlot === "object" && "resolve" in credSlot && typeof credSlot.resolve === "function") {
      const cred = await credSlot.resolve(ref, { package: "@arnilo/prism-channels" });
      resolved = typeof cred === "string" ? cred : (cred as { secret?: string })?.secret;
    }
  }
  if (!resolved || typeof resolved !== "string" || resolved.trim().length === 0) {
    throw new Error(`Failed to resolve channel credential reference: ${ref}`);
  }
  return resolved;
}

export function createChannelRedactor(secret: string, agentRedactor?: SecretRedactor): SecretRedactor {
  return {
    redact<T>(value: T): T {
      const masked = redactSecrets(value, [secret]);
      return agentRedactor ? agentRedactor.redact(masked) : masked;
    },
  };
}
