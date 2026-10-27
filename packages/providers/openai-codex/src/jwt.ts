/**
 * The one thing the OpenAI Codex sign-in needs from JWT: verifying the ID token the token endpoint
 * returns, before anything is stored. Signature (RS256 via WebCrypto), `iss`, `aud`, `exp`, `nonce`.
 *
 * Kept separate from `oauth.ts` so the claim and signature rules are testable without a network.
 * No decoding path here is used for authorization decisions: every caller gets the verified payload,
 * and an unverified one is never returned.
 */

/** A JWK as the OIDC JWKS endpoint returns it; only the RSA fields are read. */
export interface JwtKey {
  readonly kid?: string;
  readonly kty?: string;
  readonly alg?: string;
  readonly n?: string;
  readonly e?: string;
  readonly use?: string;
}

/** Why an ID token was refused. Closed on purpose: a test asserts each one fails closed. */
export type IdTokenFailure = "format" | "alg" | "key" | "signature" | "issuer" | "audience" | "expiry" | "nonce";

/** A refused ID token. The message names the rule, never the token or its claims' values. */
export class IdTokenError extends Error {
  constructor(
    readonly failure: IdTokenFailure,
    message: string,
  ) {
    super(message);
    this.name = "IdTokenError";
  }
}

export interface IdTokenParts {
  readonly header: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
  /** `header.payload` as signed bytes. */
  readonly signingInput: Uint8Array<ArrayBuffer>;
  readonly signature: Uint8Array<ArrayBuffer>;
}

/** A copy on a plain ArrayBuffer, which is what WebCrypto's `BufferSource` requires. */
function ownedBytes(view: Uint8Array | Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(view.length);
  bytes.set(view);
  return bytes;
}

function decodeSegment(segment: string, failure: IdTokenFailure, what: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new IdTokenError(failure, `openai-codex: the ID token ${what} is not JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new IdTokenError(failure, `openai-codex: the ID token ${what} is not an object`);
  return parsed as Record<string, unknown>;
}

/** Splits a compact JWS. Structure only — nothing is trusted until {@link verifyIdToken} returns. */
export function decodeIdToken(idToken: string): IdTokenParts {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new IdTokenError("format", "openai-codex: the ID token is not a compact JWS");
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];
  if (!rawHeader || !rawPayload || !rawSignature) throw new IdTokenError("format", "openai-codex: the ID token has an empty segment");
  return {
    header: decodeSegment(rawHeader, "format", "header"),
    payload: decodeSegment(rawPayload, "format", "payload"),
    signingInput: ownedBytes(new TextEncoder().encode(`${rawHeader}.${rawPayload}`)),
    signature: ownedBytes(Buffer.from(rawSignature, "base64url")),
  };
}

export interface VerifyIdTokenOptions {
  /** The JWKS document (`{ keys: [...] }`) from the issuer's discovery `jwks_uri`. */
  readonly jwks: { readonly keys?: readonly JwtKey[] } | undefined;
  /** The issuer the discovery document declared. */
  readonly issuer: string;
  /** The issued client ID the token's `aud` must contain. */
  readonly audience: string;
  /** The `nonce` this login generated. */
  readonly nonce: string;
  /** Epoch milliseconds. */
  readonly now: number;
}

/**
 * Verifies signature and claims and returns the payload. Anything unverified throws {@link IdTokenError}:
 * a bad signature, a missing or non-RSA key, `aud` that does not name this client, `exp` in the past,
 * `iss` other than the discovery issuer, or a `nonce` that is not the one this login sent.
 */
export async function verifyIdToken(idToken: string, options: VerifyIdTokenOptions): Promise<Record<string, unknown>> {
  const parts = decodeIdToken(idToken);
  if (parts.header.alg !== "RS256") throw new IdTokenError("alg", "openai-codex: the ID token is not RS256");
  const keys = (options.jwks?.keys ?? []).filter((key) => (key.kty ?? "RSA") === "RSA" && key.n !== undefined && key.e !== undefined);
  if (keys.length === 0) throw new IdTokenError("key", "openai-codex: the JWKS has no RSA key to verify the ID token");
  // A `kid` narrows the candidates; without one every RSA key is tried, which is still a real
  // signature check rather than a decode.
  const candidates = typeof parts.header.kid === "string" ? keys.filter((key) => key.kid === parts.header.kid) : keys;
  if (candidates.length === 0) throw new IdTokenError("key", "openai-codex: no JWKS key matches the ID token's kid");
  let signatureOk = false;
  for (const jwk of candidates) {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, parts.signature, parts.signingInput)) {
      signatureOk = true;
      break;
    }
  }
  if (!signatureOk) throw new IdTokenError("signature", "openai-codex: the ID token signature is invalid");
  const { payload } = parts;
  if (payload.iss !== options.issuer) throw new IdTokenError("issuer", "openai-codex: the ID token issuer is not the discovery issuer");
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(options.audience)) throw new IdTokenError("audience", "openai-codex: the ID token audience is not this client");
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= options.now)
    throw new IdTokenError("expiry", "openai-codex: the ID token is expired");
  if (payload.nonce !== options.nonce) throw new IdTokenError("nonce", "openai-codex: the ID token nonce does not match this login");
  return payload;
}
