import type { ProviderRequestOptions } from "@arnilo/prism";

export function opencodeHeaders(options: ProviderRequestOptions | undefined): Record<string, string> {
  return {
    ...options?.headers,
    ...(options?.sessionId ? { "x-opencode-session": safeSessionId(options.sessionId) } : {}),
  };
}

function safeSessionId(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 128);
}
