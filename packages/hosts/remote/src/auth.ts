import { randomBytes, timingSafeEqual } from "node:crypto";
import { secrets } from "bun";
import { RemoteError } from "./errors.js";

export function resolveToken(ref?: string): string | Promise<string> {
  if (ref === undefined) return randomBytes(32).toString("hex");
  if (/^env:[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) {
    const value = process.env[ref.slice(4)];
    if (value) return value;
    throw new RemoteError("unauthorized", "token reference unavailable");
  }
  if (/^keyring:.+$/.test(ref)) {
    return secrets.get({ service: "prism", name: ref.slice(8) }).then(
      (value) => {
        if (!value) throw new RemoteError("unauthorized", "token reference unavailable");
        return value;
      },
      () => {
        throw new RemoteError("unauthorized", "token reference unavailable");
      },
    );
  }
  throw new RemoteError("literal_secret", "literal_secret: token must be an env: or keyring: reference");
}

export function bearerMatches(request: Request, token: string): boolean {
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
