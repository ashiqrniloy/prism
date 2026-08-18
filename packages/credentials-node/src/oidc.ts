/**
 * OIDC/JWKS identity verifier adapter (plan 011 Task 1).
 *
 * `createOidcIdentityVerifier` returns a core {@link IdentityVerifier} that
 * validates a signed JWT against a pinned issuer/audience and a pinned JWKS
 * URL: signature (allowlisted algorithms), exp/nbf with bounded clock skew,
 * kid key selection with one bounded refetch, host revocation callback, and
 * host claim-to-identity mapping with frozen claim/identity bounds.
 *
 * Fail-closed by default: unknown issuer/audience/algorithm/key, JWKS fetch
 * or parse failure, oversized tokens/claims, and revocation-callback errors
 * all reject with an {@link IdentityError} carrying a frozen reason code
 * (scripts/phase11-freeze-manifest.json). SSRF policy applies to the JWKS
 * URL via `assertSsrfAllowedUrl`; SSRF denials surface the core
 * `MediaContentError` ("ssrf_denied") rather than an IdentityError so hosts
 * can distinguish a security denial from a verification failure.
 *
 * Native fetch + WebCrypto only; no JOSE dependency. RS256 (RSA PKCS#1 v1.5)
 * and ES256 (ECDSA P-256, JWS DER signature converted to WebCrypto P1363).
 */
import {
  type AgentIdentity,
  assertSsrfAllowedUrl,
  IdentityError,
  type IdentityLimits,
  type IdentityVerifier,
  type Principal,
  pinnedFetch,
  resolveIdentityLimits,
  type SsrfPolicy,
} from "@arnilo/prism";
import { ProviderTransportError, readBoundedResponseText } from "@arnilo/prism/providers/transport";

/** Signature algorithms this adapter can verify. Hosts may only narrow. */
export type OidcAlgorithm = "RS256" | "ES256";

/** Decoded JWT payload passed to `mapClaims` / `isRevoked`. */
export type OidcClaims = Readonly<Record<string, unknown>>;

/** A successful verification: a core verified identity. */
export type OidcIdentityVerifierResult = AgentIdentity;

/** Host mapping from verified claims to the identity fields Prism needs. */
interface OidcMappedIdentity {
  readonly tenantId: string;
  readonly principal: Principal;
  readonly scopes: readonly string[];
  readonly accountId?: string;
  readonly userId?: string;
  readonly sponsor?: Principal;
  readonly owner?: Principal;
  readonly delegatedFrom?: Principal;
  readonly credentialRefs?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly revokedAt?: string;
}

/** Adapter bounds; each value clamps to a hard maximum (see oidc-limits). */
interface OidcLimits {
  readonly maxJwksKeys?: number;
  readonly maxJwkBytes?: number;
  readonly jwksCacheTtlMs?: number;
  readonly jwksFetchTimeoutMs?: number;
  readonly maxTokenBytes?: number;
  readonly maxClaims?: number;
  readonly maxClaimBytes?: number;
  readonly clockSkewMs?: number;
  /** Reuses core identity caps (scopes, metadata, principal/credential ref bytes). */
  readonly identity?: IdentityLimits;
}

export interface OidcIdentityVerifierOptions {
  /** Exact `iss` required; any other issuer fails closed. */
  readonly issuer: string;
  /** `aud` value(s); the token must contain at least one of them. */
  readonly audience: string | readonly string[];
  /** Pinned JWKS URL (SSRF-checked; never discovered at runtime). */
  readonly jwksUrl: string;
  /** Maps verified, bounded claims to identity fields; must supply tenantId. */
  readonly mapClaims: (claims: OidcClaims) => OidcMappedIdentity;
  /** Signature algorithms allowed; may only narrow the default RS256+ES256. */
  readonly algorithms?: readonly OidcAlgorithm[];
  readonly clockSkewMs?: number;
  /** Revocation probe; a throw or `true` fails closed. */
  readonly isRevoked?: (claims: OidcClaims) => boolean | Promise<boolean>;
  readonly limits?: OidcLimits;
  /** Extra allow-listing for the JWKS host (default policy denies private hosts). */
  readonly ssrf?: SsrfPolicy;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

const REASON = {
  issuerMismatch: "ERR_PRISM_OIDC_ISSUER_MISMATCH",
  audienceMismatch: "ERR_PRISM_OIDC_AUDIENCE_MISMATCH",
  algorithm: "ERR_PRISM_OIDC_ALGORITHM",
  signature: "ERR_PRISM_OIDC_SIGNATURE",
  expired: "ERR_PRISM_OIDC_EXPIRED",
  notYetValid: "ERR_PRISM_OIDC_NOT_YET_VALID",
  jwksFetch: "ERR_PRISM_OIDC_JWKS_FETCH",
  jwksKeyMissing: "ERR_PRISM_OIDC_JWKS_KEY_MISSING",
  jwksParse: "ERR_PRISM_OIDC_JWKS_PARSE",
  claimsBounds: "ERR_PRISM_OIDC_CLAIMS_BOUNDS",
  revoked: "ERR_PRISM_OIDC_REVOKED",
  tenantMapping: "ERR_PRISM_OIDC_TENANT_MAPPING",
} as const;

const DEFAULT_OIDC_LIMITS: ResolvedOidcLimits = {
  maxJwksKeys: 32,
  maxJwkBytes: 8 * 1024,
  jwksCacheTtlMs: 600_000,
  jwksFetchTimeoutMs: 5_000,
  maxTokenBytes: 16 * 1024,
  maxClaims: 64,
  maxClaimBytes: 4 * 1024,
  clockSkewMs: 30_000,
};

const HARD_OIDC_LIMITS: ResolvedOidcLimits = {
  maxJwksKeys: 128,
  maxJwkBytes: 64 * 1024,
  jwksCacheTtlMs: 3_600_000,
  jwksFetchTimeoutMs: 30_000,
  maxTokenBytes: 256 * 1024,
  maxClaims: 256,
  maxClaimBytes: 16 * 1024,
  clockSkewMs: 300_000,
};

interface ResolvedOidcLimits {
  readonly maxJwksKeys: number;
  readonly maxJwkBytes: number;
  readonly jwksCacheTtlMs: number;
  readonly jwksFetchTimeoutMs: number;
  readonly maxTokenBytes: number;
  readonly maxClaims: number;
  readonly maxClaimBytes: number;
  readonly clockSkewMs: number;
}

function resolveOidcLimits(input: OidcLimits = {}): ResolvedOidcLimits {
  return {
    maxJwksKeys: bounded(input.maxJwksKeys, DEFAULT_OIDC_LIMITS.maxJwksKeys, HARD_OIDC_LIMITS.maxJwksKeys),
    maxJwkBytes: bounded(input.maxJwkBytes, DEFAULT_OIDC_LIMITS.maxJwkBytes, HARD_OIDC_LIMITS.maxJwkBytes),
    jwksCacheTtlMs: bounded(input.jwksCacheTtlMs, DEFAULT_OIDC_LIMITS.jwksCacheTtlMs, HARD_OIDC_LIMITS.jwksCacheTtlMs),
    jwksFetchTimeoutMs: bounded(input.jwksFetchTimeoutMs, DEFAULT_OIDC_LIMITS.jwksFetchTimeoutMs, HARD_OIDC_LIMITS.jwksFetchTimeoutMs),
    maxTokenBytes: bounded(input.maxTokenBytes, DEFAULT_OIDC_LIMITS.maxTokenBytes, HARD_OIDC_LIMITS.maxTokenBytes),
    maxClaims: bounded(input.maxClaims, DEFAULT_OIDC_LIMITS.maxClaims, HARD_OIDC_LIMITS.maxClaims),
    maxClaimBytes: bounded(input.maxClaimBytes, DEFAULT_OIDC_LIMITS.maxClaimBytes, HARD_OIDC_LIMITS.maxClaimBytes),
    clockSkewMs: bounded(input.clockSkewMs, DEFAULT_OIDC_LIMITS.clockSkewMs, HARD_OIDC_LIMITS.clockSkewMs),
  };
}

function bounded(input: number | undefined, fallback: number, hard: number): number {
  if (input === undefined) return fallback;
  if (!Number.isFinite(input) || input <= 0) throw new IdentityError(`invalid limit ${input}`, "ERR_PRISM_OIDC_CLAIMS_BOUNDS");
  return Math.min(input, hard);
}

interface JwkKey {
  readonly kid?: string;
  readonly kty?: string;
  readonly use?: string;
  readonly alg?: string;
  readonly [field: string]: unknown;
}

interface JwksCacheEntry {
  readonly keys: readonly JwkKey[];
  readonly fetchedAt: number;
}

const DEFAULT_ALGORITHMS: readonly OidcAlgorithm[] = ["RS256", "ES256"];
const JWKS_DOC_SLACK_BYTES = 64 * 1024;

export function createOidcIdentityVerifier(options: OidcIdentityVerifierOptions): IdentityVerifier {
  const limits = resolveOidcLimits(options.limits);
  const algorithms = resolveAlgorithms(options.algorithms);
  const identityLimits = resolveIdentityLimits(options.limits?.identity);
  const now = options.now ?? Date.now;
  const audience = Array.isArray(options.audience) ? options.audience : [options.audience];

  // Single-entry, single-flight JWKS cache; one pinned URL per verifier.
  let cache: JwksCacheEntry | undefined;
  let inflight: Promise<JwksCacheEntry> | undefined;

  async function loadJwks(): Promise<JwksCacheEntry> {
    if (inflight) return inflight;
    inflight = fetchJwks().then(
      (entry) => {
        inflight = undefined;
        cache = entry;
        return entry;
      },
      (error) => {
        inflight = undefined;
        throw error;
      },
    );
    return inflight;
  }

  async function fetchJwks(): Promise<JwksCacheEntry> {
    assertSsrfAllowedUrl(options.jwksUrl, options.ssrf);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limits.jwksFetchTimeoutMs);
    try {
      // Default path: DNS-pinned, redirect-free, byte-bounded fetch via the core
      // pinnedFetch primitive (0.2.1 task 4); hosts may inject their own fetch.
      const response = await (options.fetch
        ? options.fetch(options.jwksUrl, {
            signal: controller.signal,
            // Never follow JWKS redirects: a redirected fetch bypasses the pinned-origin check.
            redirect: "manual",
          })
        : pinnedFetch(
            new URL(options.jwksUrl),
            { signal: controller.signal, redirect: "manual" },
            {
              errorPrefix: "OIDC JWKS",
              hostnameErrorPrefix: "OIDC JWKS",
              ssrf: options.ssrf,
            },
          ));
      if (response.status < 200 || response.status >= 300) {
        throw new IdentityError(`JWKS endpoint returned ${response.status}`, REASON.jwksFetch);
      }
      const text = await readBoundedResponseText(response, {
        maxResponseBodyBytes: limits.maxJwksKeys * limits.maxJwkBytes + JWKS_DOC_SLACK_BYTES,
      });
      if (text.length > limits.maxJwksKeys * limits.maxJwkBytes + JWKS_DOC_SLACK_BYTES) {
        throw new IdentityError("JWKS document exceeds size bound", REASON.jwksParse);
      }
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { keys?: unknown }).keys)) {
        throw new IdentityError("JWKS document has no keys array", REASON.jwksParse);
      }
      const keys = (parsed as { keys: unknown[] }).keys;
      if (keys.length > limits.maxJwksKeys) {
        throw new IdentityError(`JWKS has ${keys.length} keys (max ${limits.maxJwksKeys})`, REASON.jwksParse);
      }
      const boundedKeys: JwkKey[] = [];
      for (const entry of keys) {
        if (typeof entry !== "object" || entry === null || typeof (entry as JwkKey).kid !== "string") {
          throw new IdentityError("JWKS key entry is malformed", REASON.jwksParse);
        }
        if (JSON.stringify(entry).length > limits.maxJwkBytes) {
          throw new IdentityError("JWKS key exceeds size bound", REASON.jwksParse);
        }
        boundedKeys.push(entry as JwkKey);
      }
      return { keys: boundedKeys, fetchedAt: now() };
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      if (error instanceof ProviderTransportError && error.code === "response_body_overflow") {
        // Oversized JWKS bodies fail closed as a parse/bounds error (poisoning path),
        // never as a rotatable transport failure.
        throw new IdentityError("JWKS document exceeds size bound", REASON.jwksParse);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new IdentityError(`JWKS fetch failed: ${message}`, REASON.jwksFetch);
    } finally {
      clearTimeout(timer);
    }
  }

  async function getKeys(refetch: boolean): Promise<readonly JwkKey[]> {
    if (refetch) return (await loadJwks()).keys;
    if (cache && now() - cache.fetchedAt < limits.jwksCacheTtlMs) return cache.keys;
    if (!cache) return (await loadJwks()).keys;
    // Cache present but stale: refresh, keeping stale keys on transport failure
    // (rotation-friendly) but failing closed on parse/bounds failures (poisoning).
    try {
      return (await loadJwks()).keys;
    } catch (error) {
      if (error instanceof IdentityError && error.reason === REASON.jwksFetch) return cache.keys;
      throw error;
    }
  }

  function findKey(keys: readonly JwkKey[], kid: string, alg: OidcAlgorithm): JwkKey | undefined {
    return keys.find((key) => {
      if (key.kid !== kid) return false;
      if (key.use !== undefined && key.use !== "sig") return false;
      if (key.alg !== undefined && key.alg !== alg) return false;
      return true;
    });
  }

  return {
    async verify(input: unknown): Promise<AgentIdentity> {
      const token = extractToken(input);
      if (token.length > limits.maxTokenBytes) {
        throw new IdentityError(`token exceeds ${limits.maxTokenBytes} bytes`, REASON.claimsBounds);
      }
      const { header, payload } = parseToken(token);
      const alg = header.alg;
      if (!isOidcAlgorithm(alg) || !algorithms.includes(alg)) {
        throw new IdentityError(`algorithm ${alg} is not allowed`, REASON.algorithm);
      }
      if (typeof header.kid !== "string" || header.kid.length === 0) {
        throw new IdentityError("token has no kid", REASON.jwksKeyMissing);
      }
      if (payload.iss !== options.issuer) {
        throw new IdentityError(`issuer mismatch: ${String(payload.iss)}`, REASON.issuerMismatch);
      }
      if (!audienceMatches(payload.aud, audience)) {
        throw new IdentityError("audience mismatch", REASON.audienceMismatch);
      }
      const nowMs = now();
      const exp = numericClaim(payload.exp);
      if (exp === undefined) {
        throw new IdentityError("token has no exp; fail closed", REASON.expired);
      }
      if (nowMs - limits.clockSkewMs > exp * 1000) {
        throw new IdentityError("token expired", REASON.expired);
      }
      const nbf = numericClaim(payload.nbf);
      if (nbf !== undefined && nowMs + limits.clockSkewMs < nbf * 1000) {
        throw new IdentityError("token not yet valid", REASON.notYetValid);
      }
      assertClaimBounds(payload, limits);

      // Signature: unknown kid triggers exactly one bounded refetch, then fails closed.
      let refetched = false;
      let keys = await getKeys(false);
      let key = findKey(keys, header.kid, alg);
      if (!key && !refetched) {
        refetched = true;
        keys = await getKeys(true);
        key = findKey(keys, header.kid, alg);
      }
      if (!key) {
        throw new IdentityError(`no JWKS key for kid ${header.kid}`, REASON.jwksKeyMissing);
      }
      const [headerB64, payloadB64, signatureB64] = token.split(".");
      await verifySignature(alg, key, `${headerB64}.${payloadB64}`, signatureB64);

      const claims = payload as OidcClaims;
      if (options.isRevoked) {
        let revoked: boolean;
        try {
          revoked = await options.isRevoked(claims);
        } catch {
          throw new IdentityError("revocation check failed; fail closed", REASON.revoked);
        }
        if (revoked) throw new IdentityError("token is revoked", REASON.revoked);
      }
      const mapped = options.mapClaims(claims);
      assertMappedIdentity(mapped, identityLimits);
      const iat = numericClaim(payload.iat);
      return {
        ...mapped,
        issuedAt: new Date((iat ?? Math.floor(nowMs / 1000)) * 1000).toISOString(),
        ...(exp !== undefined ? { expiresAt: new Date(exp * 1000).toISOString() } : {}),
        verified: true,
      };
    },
  };
}

function resolveAlgorithms(input: readonly OidcAlgorithm[] | undefined): readonly OidcAlgorithm[] {
  if (input === undefined) return DEFAULT_ALGORITHMS;
  if (input.length === 0) throw new IdentityError("algorithms may not be empty", REASON.algorithm);
  for (const alg of input) {
    if (!DEFAULT_ALGORITHMS.includes(alg)) {
      throw new IdentityError(`algorithm ${alg} may not be widened beyond RS256/ES256`, REASON.algorithm);
    }
  }
  return input;
}

function extractToken(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof input === "object" && input !== null && typeof (input as { token?: unknown }).token === "string") {
    return (input as { token: string }).token;
  }
  throw new IdentityError("invalid token input shape", REASON.signature);
}

function parseToken(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new IdentityError("malformed token", REASON.signature);
  const [headerB64, payloadB64, signatureB64] = parts;
  if (signatureB64.length === 0) throw new IdentityError("token is unsigned", REASON.signature);
  const header = parseJsonPart(headerB64, "header");
  const payload = parseJsonPart(payloadB64, "payload");
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new IdentityError("payload is not an object", REASON.signature);
  }
  return { header: header as Record<string, unknown>, payload: payload as Record<string, unknown> };
}

function parseJsonPart(b64: string, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    throw new IdentityError(`malformed token ${label}`, REASON.signature);
  }
}

function numericClaim(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function audienceMatches(tokenAudience: unknown, expected: readonly string[]): boolean {
  if (typeof tokenAudience === "string") return expected.includes(tokenAudience);
  if (Array.isArray(tokenAudience)) return tokenAudience.some((entry) => typeof entry === "string" && expected.includes(entry));
  return false;
}

function assertClaimBounds(payload: Record<string, unknown>, limits: ResolvedOidcLimits): void {
  const keys = Object.keys(payload);
  if (keys.length > limits.maxClaims) {
    throw new IdentityError(`token has ${keys.length} claims (max ${limits.maxClaims})`, REASON.claimsBounds);
  }
  if (JSON.stringify(payload).length > limits.maxClaimBytes) {
    throw new IdentityError(`claims exceed ${limits.maxClaimBytes} bytes`, REASON.claimsBounds);
  }
}

function assertMappedIdentity(mapped: OidcMappedIdentity, limits: ReturnType<typeof resolveIdentityLimits>): void {
  if (typeof mapped.tenantId !== "string" || mapped.tenantId.length === 0) {
    throw new IdentityError("mapClaims must supply a tenantId", REASON.tenantMapping);
  }
  if (
    typeof mapped.principal !== "object" ||
    mapped.principal === null ||
    typeof mapped.principal.id !== "string" ||
    mapped.principal.id.length === 0
  ) {
    throw new IdentityError("mapClaims must supply a principal with an id", REASON.tenantMapping);
  }
  if (!Array.isArray(mapped.scopes) || mapped.scopes.some((scope) => typeof scope !== "string")) {
    throw new IdentityError("mapClaims must supply a string scope array", REASON.tenantMapping);
  }
  if (mapped.scopes.length > limits.maxScopes) {
    throw new IdentityError(`mapped scopes exceed ${limits.maxScopes}`, REASON.claimsBounds);
  }
  const scopeBytes = mapped.scopes.reduce((total, scope) => total + Buffer.byteLength(scope, "utf8"), 0);
  if (scopeBytes > limits.maxScopeBytes) {
    throw new IdentityError(`mapped scope bytes exceed ${limits.maxScopeBytes}`, REASON.claimsBounds);
  }
  if (Buffer.byteLength(mapped.principal.id, "utf8") > limits.maxPrincipalIdBytes) {
    throw new IdentityError(`principal id exceeds ${limits.maxPrincipalIdBytes} bytes`, REASON.claimsBounds);
  }
  if (mapped.metadata !== undefined && JSON.stringify(mapped.metadata).length > limits.maxMetadataBytes) {
    throw new IdentityError(`metadata exceeds ${limits.maxMetadataBytes} bytes`, REASON.claimsBounds);
  }
  if (mapped.credentialRefs !== undefined) {
    const refBytes = mapped.credentialRefs.reduce((total, ref) => total + Buffer.byteLength(ref, "utf8"), 0);
    if (refBytes > limits.maxCredentialRefBytes) {
      throw new IdentityError(`credential refs exceed ${limits.maxCredentialRefBytes} bytes`, REASON.claimsBounds);
    }
  }
}

function isOidcAlgorithm(value: unknown): value is OidcAlgorithm {
  return value === "RS256" || value === "ES256";
}

async function verifySignature(alg: OidcAlgorithm, key: JwkKey, signingInput: string, signatureB64: string): Promise<void> {
  try {
    const signature = Buffer.from(signatureB64, "base64url");
    const data = Buffer.from(signingInput, "ascii");
    if (alg === "RS256") {
      const cryptoKey = await crypto.subtle.importKey("jwk", key as JsonWebKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
        "verify",
      ]);
      const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, data);
      if (!valid) throw new IdentityError("signature verification failed", REASON.signature);
    } else {
      const cryptoKey = await crypto.subtle.importKey("jwk", key as JsonWebKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, cryptoKey, derToRawSignature(signature, 32), data);
      if (!valid) throw new IdentityError("signature verification failed", REASON.signature);
    }
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    // importKey rejects mismatched kty/crv (key confusion) — fail closed as a signature failure.
    throw new IdentityError("signature verification failed", REASON.signature);
  }
}

/** JWS ECDSA signatures are DER (ASN.1 SEQUENCE of two INTEGERs); WebCrypto wants P1363 r||s. */
function derToRawSignature(der: Uint8Array, coordBytes: number): Uint8Array<ArrayBuffer> {
  const malformed = () => new IdentityError("malformed ECDSA signature", REASON.signature);
  let pos = 0;
  const readLength = (): number => {
    if (pos >= der.length) throw malformed();
    const first = der[pos++];
    if ((first & 0x80) === 0) return first;
    const count = first & 0x7f;
    if (count === 0 || count > 4) throw malformed();
    let length = 0;
    for (let i = 0; i < count; i++) {
      if (pos >= der.length) throw malformed();
      length = length * 256 + der[pos++];
    }
    return length;
  };
  const readInteger = (): Uint8Array => {
    if (pos >= der.length || der[pos++] !== 0x02) throw malformed();
    const length = readLength();
    if (pos + length > der.length) throw malformed();
    const start = pos;
    pos += length;
    let first = start;
    while (first < pos - 1 && der[first] === 0) first += 1;
    const bytes = der.slice(first, pos);
    if (bytes.length > coordBytes) throw malformed();
    const raw = new Uint8Array(coordBytes);
    raw.set(bytes, coordBytes - bytes.length);
    return raw;
  };
  if (pos >= der.length || der[pos++] !== 0x30) throw malformed();
  readLength();
  const r = readInteger();
  const s = readInteger();
  const out = new Uint8Array(coordBytes * 2);
  out.set(r);
  out.set(s, coordBytes);
  return out;
}
