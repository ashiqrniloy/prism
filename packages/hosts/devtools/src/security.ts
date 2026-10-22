/**
 * Bearer-token guard for the devtools server. A token is a ref (`env:NAME`), never a literal: the
 * value is read from the environment at serve time and compared in constant time on every request.
 */
import { timingSafeEqual } from "node:crypto";
import { DevtoolsError } from "./errors.js";

const ENV_REF = /^env:([A-Za-z_][A-Za-z0-9_]*)$/;

export const DEVTOOLS_JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

export interface DevtoolsHostOriginOptions {
  readonly allowedHosts?: readonly string[];
  readonly allowedOrigins?: readonly string[];
}

/**
 * Host/Origin matching parity with hosts/remote/src/http-gate.ts hostOriginRejection.
 * Rejects requests with unexpected Host or Origin headers to protect loopback devtools from DNS rebinding.
 */
export function hostOriginRejection(request: Request, options: DevtoolsHostOriginOptions): Response | undefined {
  if (options.allowedHosts?.length) {
    const host = request.headers.get("host")?.toLowerCase();
    if (!host || !options.allowedHosts.some((allowed) => allowed.toLowerCase() === host)) {
      return new Response(
        JSON.stringify({
          error: {
            code: "ERR_PRISM_DEVTOOLS_FORBIDDEN_HOST",
            message: "Forbidden host",
          },
        }),
        { status: 403, headers: DEVTOOLS_JSON_HEADERS },
      );
    }
  }
  if (options.allowedOrigins?.length) {
    const origin = request.headers.get("origin");
    if (origin && !options.allowedOrigins.some((allowed) => allowed.toLowerCase() === origin.toLowerCase())) {
      return new Response(
        JSON.stringify({
          error: {
            code: "ERR_PRISM_DEVTOOLS_FORBIDDEN_ORIGIN",
            message: "Forbidden origin",
          },
        }),
        { status: 403, headers: DEVTOOLS_JSON_HEADERS },
      );
    }
  }
  return undefined;
}

/** Resolves a token ref to its value. `undefined` in, `undefined` out: the server then runs without a guard. */
export function resolveDevtoolsToken(
  ref: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  if (ref === undefined) return undefined;
  const match = ENV_REF.exec(ref);
  if (!match) {
    throw new DevtoolsError(
      "token must be an env: ref (for example env:PRISM_DEVTOOLS_TOKEN); a literal token is refused",
      "ERR_PRISM_DEVTOOLS_TOKEN_LITERAL",
    );
  }
  const value = env[match[1]!];
  if (!value) throw new DevtoolsError(`token ref ${ref} is not set`, "ERR_PRISM_DEVTOOLS_TOKEN_UNSET");
  return value;
}

/** True when the request carries `Authorization: Bearer <token>`. Constant time over the header bytes. */
export function bearerMatches(request: Request, token: string): boolean {
  const presented = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}
