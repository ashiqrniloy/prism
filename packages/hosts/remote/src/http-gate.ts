import { RemoteError } from "./errors.js";

export const rejection = (status: number, code: string) => Response.json({ error: code }, { status });

// Host/Origin matching parity with hosts/mcp-server/src/server.ts hostOriginRejection.
export function hostOriginRejection(
  request: Request,
  options: { allowedHosts?: readonly string[]; allowedOrigins?: readonly string[] },
): Response | undefined {
  if (options.allowedHosts?.length) {
    const host = request.headers.get("host")?.toLowerCase();
    if (!host || !options.allowedHosts.some((allowed) => allowed.toLowerCase() === host)) return rejection(403, "forbidden_host");
  }
  if (options.allowedOrigins?.length) {
    const origin = request.headers.get("origin");
    if (origin && !options.allowedOrigins.some((allowed) => allowed.toLowerCase() === origin.toLowerCase()))
      return rejection(403, "forbidden_origin");
  }
  return undefined;
}

export async function readBody(request: Request, cap: number): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > cap) {
        void reader.cancel().catch(() => {});
        throw new RemoteError("body_too_large", "body_too_large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
