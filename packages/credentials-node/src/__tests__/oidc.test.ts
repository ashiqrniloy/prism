/**
 * OIDC/JWKS verifier suite (plan 011 Task 1). Real WebCrypto key pairs and
 * tokens generated in-process; JWKS served by a scripted fake fetch.
 * Covers the frozen fixture list: valid RS256/ES256, expired/future-nbf,
 * wrong issuer/audience, alg:none + non-allowlisted, unknown-kid refetch,
 * JWKS outage warm/cold, cache poisoning, oversized claims, revocation,
 * tenant mapping, key confusion, SSRF, redirects, single-flight.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IdentityError, MediaContentError, pinnedFetch } from "@arnilo/prism";
import { createOidcIdentityVerifier, type OidcClaims } from "../oidc.js";

const ISSUER = "https://id.example.com/tenant";
const AUDIENCE = "prism-api";
const JWKS_URL = "https://id.example.com/tenant/.well-known/jwks.json";

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const b64urlBytes = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/** DER(ASN.1) → raw P1363 r||s conversion for JWS signatures (inverse of module's derToRaw). */
function rawToDer(raw: Uint8Array, coordBytes = 32): Uint8Array {
  const encodeInteger = (n: Uint8Array) => {
    let start = 0;
    while (start < n.length - 1 && n[start] === 0) start += 1;
    const body = Array.from(n.slice(start));
    if ((body[0] ?? 0) & 0x80) body.unshift(0);
    return [0x02, body.length, ...body];
  };
  const r = encodeInteger(raw.slice(0, coordBytes));
  const s = encodeInteger(raw.slice(coordBytes));
  const body = [...r, ...s];
  return new Uint8Array([0x30, body.length, ...body]);
}

interface TestKeys {
  readonly privateKey: CryptoKey;
  readonly publicJwk: JsonWebKey;
}

async function makeRsaKeys(): Promise<TestKeys> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  return { privateKey: pair.privateKey, publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey) };
}

async function makeEcKeys(): Promise<TestKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { privateKey: pair.privateKey, publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey) };
}

interface SignOptions {
  readonly alg?: "RS256" | "ES256" | string;
  readonly kid?: string;
  readonly claims?: Readonly<Record<string, unknown>>;
  readonly iss?: string;
  readonly aud?: string | readonly string[];
  readonly iat?: number;
  readonly exp?: number;
  readonly nbf?: number;
}

async function signToken(keys: TestKeys, options: SignOptions): Promise<string> {
  const header = { alg: options.alg ?? "RS256", typ: "JWT", ...(options.kid !== undefined ? { kid: options.kid } : { kid: "key-1" }) };
  const payload = {
    ...(options.claims ?? {}),
    ...(options.iss !== undefined ? { iss: options.iss } : { iss: ISSUER }),
    ...(options.aud !== undefined ? { aud: options.aud } : { aud: AUDIENCE }),
    ...(options.iat !== undefined ? { iat: options.iat } : { iat: Math.floor(Date.now() / 1000) }),
    ...(options.exp !== undefined ? { exp: options.exp } : { exp: Math.floor(Date.now() / 1000) + 3600 }),
    ...(options.nbf !== undefined ? { nbf: options.nbf } : {}),
  };
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const data = Buffer.from(signingInput, "ascii");
  if (options.alg === "ES256") {
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, data);
    return `${signingInput}.${b64urlBytes(rawToDer(new Uint8Array(signature)))}`;
  }
  if (options.alg === undefined || options.alg === "RS256") {
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, data);
    return `${signingInput}.${b64urlBytes(new Uint8Array(signature))}`;
  }
  // Unsupported algorithms (HS256, none, ...): syntactically valid but unverifiable token.
  return `${signingInput}.${b64urlBytes(new Uint8Array(32))}`;
}

type FetchResult = { status: number; body: unknown } | { status: number; statusText: string } | Error;

interface FakeFetch {
  (input: string | Request | URL, init?: RequestInit): Promise<Response>;
  calls: number;
}

function makeFetch(handler: (url: string) => FetchResult): FakeFetch {
  const fetchImpl = (async (input: string | Request | URL): Promise<Response> => {
    fetchImpl.calls += 1;
    const result = handler(String(input));
    if (result instanceof Error) throw result;
    if ("statusText" in result) return new Response(null, { status: result.status, statusText: result.statusText });
    return new Response(JSON.stringify(result.body), { status: result.status });
  }) as FakeFetch;
  fetchImpl.calls = 0;
  return fetchImpl;
}

const jwksBody = (keys: readonly JsonWebKey[], kid: string) => ({
  keys: keys.map((key) => ({ ...key, kid, use: "sig", alg: key.kty === "RSA" ? "RS256" : "ES256" })),
});

interface MappedIdentity {
  readonly tenantId: string;
  readonly principal: { readonly kind: "user"; readonly id: string };
  readonly scopes: readonly string[];
}

const defaultMapClaims = (claims: OidcClaims): MappedIdentity => ({
  tenantId: String(claims.tid),
  principal: { kind: "user", id: String(claims.sub) },
  scopes: Array.isArray(claims.scp) ? (claims.scp as string[]) : [],
});

interface VerifierOverrides {
  readonly fetchImpl?: FakeFetch;
  readonly keys?: readonly JsonWebKey[];
  readonly now?: () => number;
  readonly mapClaims?: (claims: OidcClaims) => MappedIdentity;
  readonly isRevoked?: (claims: OidcClaims) => boolean | Promise<boolean>;
  readonly limits?: {
    readonly maxJwksKeys?: number;
    readonly maxJwkBytes?: number;
    readonly maxTokenBytes?: number;
    readonly maxClaims?: number;
    readonly maxClaimBytes?: number;
    readonly identity?: { readonly maxScopes?: number };
  };
}

function makeVerifier(overrides: VerifierOverrides = {}) {
  const kid = "key-1";
  const fetchImpl = overrides.fetchImpl ?? makeFetch(() => ({ status: 200, body: jwksBody(overrides.keys ?? [], kid) }));
  return {
    fetchImpl,
    verifier: createOidcIdentityVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUrl: JWKS_URL,
      mapClaims: overrides.mapClaims ?? defaultMapClaims,
      fetch: fetchImpl,
      ...(overrides.now !== undefined ? { now: overrides.now } : {}),
      ...(overrides.isRevoked !== undefined ? { isRevoked: overrides.isRevoked } : {}),
      ...(overrides.limits !== undefined ? { limits: overrides.limits } : {}),
    }),
  };
}

function assertOidcError(error: unknown, reason: string): void {
  assert.ok(error instanceof IdentityError, `expected IdentityError, got ${String(error)}`);
  assert.equal(error.reason, reason);
}

/** node:assert.rejects/throws validation function: assert then signal pass. */
const rejectsWith = (reason: string) => (error: unknown) => {
  assertOidcError(error, reason);
  return true;
};

describe("createOidcIdentityVerifier", () => {
  it("verifies a valid RS256 token and maps claims to a verified identity", async () => {
    const keys = await makeRsaKeys();
    const { verifier, fetchImpl } = makeVerifier({ keys: [keys.publicJwk] });
    const token = await signToken(keys, {
      claims: { sub: "user-1", tid: "tenant-1", scp: ["read", "write"] },
    });
    const identity = await verifier.verify(token);
    assert.equal(identity.verified, true);
    assert.equal(identity.tenantId, "tenant-1");
    assert.equal(identity.principal.id, "user-1");
    assert.deepEqual(identity.scopes, ["read", "write"]);
    assert.ok(identity.issuedAt.length > 0);
    assert.ok(identity.expiresAt !== undefined && identity.expiresAt > identity.issuedAt);
    assert.equal(fetchImpl.calls, 1);
  });

  it("verifies a valid ES256 token (DER signature converted to P1363)", async () => {
    const keys = await makeEcKeys();
    const { verifier } = makeVerifier({ keys: [keys.publicJwk] });
    const token = await signToken(keys, { alg: "ES256", claims: { sub: "user-2", tid: "tenant-1" } });
    const identity = await verifier.verify(token);
    assert.equal(identity.principal.id, "user-2");
  });

  it("accepts { token } object input shape", async () => {
    const keys = await makeRsaKeys();
    const { verifier } = makeVerifier({ keys: [keys.publicJwk] });
    const token = await signToken(keys, { claims: { sub: "user-1", tid: "tenant-1" } });
    const identity = await verifier.verify({ token });
    assert.equal(identity.principal.id, "user-1");
  });

  it("caches JWKS and serves a second verify from cache", async () => {
    const keys = await makeRsaKeys();
    const { verifier, fetchImpl } = makeVerifier({ keys: [keys.publicJwk] });
    const token = await signToken(keys, { claims: { sub: "u", tid: "t" } });
    await verifier.verify(token);
    await verifier.verify(token);
    assert.equal(fetchImpl.calls, 1);
  });

  it("single-flights concurrent cold-cache verifies (one JWKS fetch)", async () => {
    const keys = await makeRsaKeys();
    const { verifier, fetchImpl } = makeVerifier({ keys: [keys.publicJwk] });
    const token = await signToken(keys, { claims: { sub: "u", tid: "t" } });
    await Promise.all([verifier.verify(token), verifier.verify(token), verifier.verify(token)]);
    assert.equal(fetchImpl.calls, 1);
  });

  it("fails closed on expired token", async () => {
    const keys = await makeRsaKeys();
    const { verifier } = makeVerifier({ keys: [keys.publicJwk] });
    const token = await signToken(keys, {
      claims: { sub: "u", tid: "t" },
      exp: Math.floor(Date.now() / 1000) - 3600,
    });
    await assert.rejects(async () => verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_EXPIRED"));
  });

  it("accepts an expired token within clock skew", async () => {
    const keys = await makeRsaKeys();
    const nowMs = Date.now();
    const { verifier } = makeVerifier({ keys: [keys.publicJwk], now: () => nowMs });
    const token = await signToken(keys, { claims: { sub: "u", tid: "t" }, exp: Math.floor(nowMs / 1000) - 10 });
    const identity = await verifier.verify(token);
    assert.equal(identity.verified, true);
  });

  it("rejects a token missing exp (fail closed)", async () => {
    const keys = await makeRsaKeys();
    const { verifier } = makeVerifier({ keys: [keys.publicJwk] });
    const signingInput = `${b64url({ alg: "RS256", typ: "JWT", kid: "key-1" })}.${b64url({
      iss: ISSUER,
      aud: AUDIENCE,
      iat: Math.floor(Date.now() / 1000),
      sub: "u",
      tid: "t",
    })}`;
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, Buffer.from(signingInput, "ascii"));
    await assert.rejects(
      async () => verifier.verify(`${signingInput}.${b64urlBytes(new Uint8Array(signature))}`),
      rejectsWith("ERR_PRISM_OIDC_EXPIRED"),
    );
  });

  it("rejects a token not yet valid (future nbf beyond skew)", async () => {
    const keys = await makeRsaKeys();
    const nowMs = Date.now();
    const { verifier } = makeVerifier({ keys: [keys.publicJwk], now: () => nowMs });
    const token = await signToken(keys, { claims: { sub: "u", tid: "t" }, nbf: Math.floor(nowMs / 1000) + 3600 });
    await assert.rejects(async () => verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_NOT_YET_VALID"));
  });

  it("rejects wrong issuer", async () => {
    const keys = await makeRsaKeys();
    const { verifier } = makeVerifier({ keys: [keys.publicJwk] });
    const token = await signToken(keys, { claims: { sub: "u", tid: "t" }, iss: "https://evil.example.com" });
    await assert.rejects(async () => verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_ISSUER_MISMATCH"));
  });

  it("rejects wrong audience and accepts a matching one from an array", async () => {
    const keys = await makeRsaKeys();
    const { verifier } = makeVerifier({ keys: [keys.publicJwk] });
    const wrong = await signToken(keys, { claims: { sub: "u", tid: "t" }, aud: "other-api" });
    await assert.rejects(async () => verifier.verify(wrong), rejectsWith("ERR_PRISM_OIDC_AUDIENCE_MISMATCH"));
    const arrayAud = await signToken(keys, { claims: { sub: "u", tid: "t" }, aud: ["other-api", AUDIENCE] });
    const identity = await verifier.verify(arrayAud);
    assert.equal(identity.verified, true);
  });

  it("rejects alg:none and non-allowlisted algorithms", async () => {
    const keys = await makeRsaKeys();
    const { verifier } = makeVerifier({ keys: [keys.publicJwk] });
    const none = await signToken(keys, { alg: "none", claims: { sub: "u", tid: "t" } });
    await assert.rejects(async () => verifier.verify(none), rejectsWith("ERR_PRISM_OIDC_ALGORITHM"));
    const hs256 = await signToken(keys, { alg: "HS256", claims: { sub: "u", tid: "t" } });
    await assert.rejects(async () => verifier.verify(hs256), rejectsWith("ERR_PRISM_OIDC_ALGORITHM"));
  });

  it("honors a narrowed algorithm allow-list and rejects widening", async () => {
    const keys = await makeRsaKeys();
    const fetchImpl = makeFetch(() => ({ status: 200, body: jwksBody([keys.publicJwk], "key-1") }));
    const esOnly = createOidcIdentityVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUrl: JWKS_URL,
      mapClaims: defaultMapClaims,
      algorithms: ["ES256"],
      fetch: fetchImpl,
    });
    const token = await signToken(keys, { claims: { sub: "u", tid: "t" } });
    await assert.rejects(async () => esOnly.verify(token), rejectsWith("ERR_PRISM_OIDC_ALGORITHM"));
    assert.throws(
      () =>
        createOidcIdentityVerifier({
          issuer: ISSUER,
          audience: AUDIENCE,
          jwksUrl: JWKS_URL,
          mapClaims: defaultMapClaims,
          algorithms: ["RS256", "HS256"] as never,
        }),
      rejectsWith("ERR_PRISM_OIDC_ALGORITHM"),
    );
  });

  it("refetches JWKS exactly once on unknown kid, then fails closed", async () => {
    const keys = await makeRsaKeys();
    const { verifier, fetchImpl } = makeVerifier({ keys: [keys.publicJwk] });
    const token = await signToken(keys, { kid: "key-2", claims: { sub: "u", tid: "t" } });
    await assert.rejects(async () => verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_JWKS_KEY_MISSING"));
    assert.equal(fetchImpl.calls, 2); // warm cache → one bounded refetch → fail
  });

  it("rejects a token without a kid", async () => {
    const keys = await makeRsaKeys();
    const { verifier } = makeVerifier({ keys: [keys.publicJwk] });
    const token = await signToken(keys, { kid: "", claims: { sub: "u", tid: "t" } });
    await assert.rejects(async () => verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_JWKS_KEY_MISSING"));
  });

  it("fails closed on JWKS outage with a cold cache and serves a warm cache", async () => {
    const keys = await makeRsaKeys();
    let failing = true;
    const fetchImpl = makeFetch(() => {
      if (failing) return new Error("network down");
      return { status: 200, body: jwksBody([keys.publicJwk], "key-1") };
    });
    const { verifier } = makeVerifier({ fetchImpl, keys: [keys.publicJwk] });
    const token = await signToken(keys, { claims: { sub: "u", tid: "t" } });
    await assert.rejects(async () => verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_JWKS_FETCH"));
    failing = false;
    await verifier.verify(token); // warms cache
    failing = true;
    const identity = await verifier.verify(token); // cache hit, no fetch
    assert.equal(identity.verified, true);
  });

  it("fails closed on JWKS cache poisoning (non-array keys doc)", async () => {
    const keys = await makeRsaKeys();
    let poisoned = false;
    const fetchImpl = makeFetch(() => {
      if (poisoned) return { status: 200, body: { keys: "not-an-array" } };
      return { status: 200, body: jwksBody([keys.publicJwk], "key-1") };
    });
    const nowMs = Date.now();
    let elapsed = 0;
    const { verifier } = makeVerifier({ fetchImpl, keys: [keys.publicJwk], now: () => nowMs + elapsed });
    const token = await signToken(keys, { claims: { sub: "u", tid: "t" } });
    await verifier.verify(token);
    poisoned = true;
    elapsed = 60 * 60 * 1000; // past TTL
    await assert.rejects(async () => verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_JWKS_PARSE"));
  });

  it("bounds JWKS key count and per-key bytes", async () => {
    const keys = await makeRsaKeys();
    const token = await signToken(keys, { claims: { sub: "u", tid: "t" } });

    const manyKeys = makeVerifier({
      fetchImpl: makeFetch(() => ({ status: 200, body: jwksBody([keys.publicJwk, keys.publicJwk], "key-1") })),
      limits: { maxJwksKeys: 1 },
    });
    await assert.rejects(async () => manyKeys.verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_JWKS_PARSE"));

    const fatKey = makeVerifier({
      fetchImpl: makeFetch(() => ({ status: 200, body: jwksBody([keys.publicJwk], "key-1") })),
      limits: { maxJwkBytes: 64 },
    });
    await assert.rejects(async () => fatKey.verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_JWKS_PARSE"));
  });

  it("bounds token size, claim count, and claim bytes", async () => {
    const keys = await makeRsaKeys();
    const token = await signToken(keys, { claims: { sub: "u", tid: "t" } });

    const tokenBytes = makeVerifier({ keys: [keys.publicJwk], limits: { maxTokenBytes: 100 } });
    await assert.rejects(async () => tokenBytes.verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_CLAIMS_BOUNDS"));

    const claimCount = makeVerifier({ keys: [keys.publicJwk], limits: { maxClaims: 3 } });
    const many = await signToken(keys, { claims: { sub: "u", tid: "t", a: 1, b: 2 } });
    await assert.rejects(async () => claimCount.verifier.verify(many), rejectsWith("ERR_PRISM_OIDC_CLAIMS_BOUNDS"));

    const claimBytes = makeVerifier({ keys: [keys.publicJwk], limits: { maxClaimBytes: 64 } });
    await assert.rejects(async () => claimBytes.verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_CLAIMS_BOUNDS"));
  });

  it("consults the revocation callback and fails closed on true or throw", async () => {
    const keys = await makeRsaKeys();
    const token = await signToken(keys, { claims: { sub: "u", tid: "t" } });

    const revoked = makeVerifier({ keys: [keys.publicJwk], isRevoked: () => true });
    await assert.rejects(async () => revoked.verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_REVOKED"));

    const clear = makeVerifier({ keys: [keys.publicJwk], isRevoked: () => false });
    const identity = await clear.verifier.verify(token);
    assert.equal(identity.verified, true);

    const broken = makeVerifier({
      keys: [keys.publicJwk],
      isRevoked: () => {
        throw new Error("revocation store down");
      },
    });
    await assert.rejects(async () => broken.verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_REVOKED"));
  });

  it("requires tenantId from mapClaims", async () => {
    const keys = await makeRsaKeys();
    const { verifier } = makeVerifier({
      keys: [keys.publicJwk],
      mapClaims: (claims) => ({
        tenantId: "",
        principal: { kind: "user", id: String(claims.sub) },
        scopes: [],
      }),
    });
    const token = await signToken(keys, { claims: { sub: "u" } });
    await assert.rejects(async () => verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_TENANT_MAPPING"));
  });

  it("applies core identity limits to the mapped identity", async () => {
    const keys = await makeRsaKeys();
    const { verifier } = makeVerifier({
      keys: [keys.publicJwk],
      limits: { identity: { maxScopes: 1 } },
    });
    const token = await signToken(keys, { claims: { sub: "u", tid: "t", scp: ["a", "b"] } });
    await assert.rejects(async () => verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_CLAIMS_BOUNDS"));
  });

  it("fails closed on algorithm/key mismatch: RSA JWKS cannot serve an ES256 token", async () => {
    const rsa = await makeRsaKeys();
    const ec = await makeEcKeys();
    const { verifier } = makeVerifier({ keys: [rsa.publicJwk] });
    const token = await signToken(ec, { alg: "ES256", claims: { sub: "u", tid: "t" } });
    await assert.rejects(async () => verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_JWKS_KEY_MISSING"));
  });

  it("fails closed on key confusion: same kid, different key material", async () => {
    const good = await makeRsaKeys();
    const evil = await makeRsaKeys();
    const { verifier } = makeVerifier({ keys: [good.publicJwk] });
    // Signed by a different RSA key that reuses the advertised kid.
    const token = await signToken(evil, { claims: { sub: "u", tid: "t" } });
    await assert.rejects(async () => verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_SIGNATURE"));
  });

  it("rejects a tampered signature", async () => {
    const keys = await makeRsaKeys();
    const { verifier } = makeVerifier({ keys: [keys.publicJwk] });
    const token = await signToken(keys, { claims: { sub: "u", tid: "t" } });
    const [header] = token.split(".");
    const tampered = `${header}.${b64url({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "u",
      tid: "t",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.${"AAAA"}`;
    await assert.rejects(async () => verifier.verify(tampered), rejectsWith("ERR_PRISM_OIDC_SIGNATURE"));
  });

  it("rejects malformed token input shapes", async () => {
    const keys = await makeRsaKeys();
    const { verifier } = makeVerifier({ keys: [keys.publicJwk] });
    await assert.rejects(async () => verifier.verify(42), rejectsWith("ERR_PRISM_OIDC_SIGNATURE"));
    await assert.rejects(async () => verifier.verify("not-a-jwt"), rejectsWith("ERR_PRISM_OIDC_SIGNATURE"));
    await assert.rejects(async () => verifier.verify({ token: 42 }), rejectsWith("ERR_PRISM_OIDC_SIGNATURE"));
  });

  it("applies SSRF policy to the JWKS URL (private host denied before any fetch)", async () => {
    const keys = await makeRsaKeys();
    const fetchImpl = makeFetch(() => ({ status: 200, body: jwksBody([keys.publicJwk], "key-1") }));
    const verifier = createOidcIdentityVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUrl: "http://127.0.0.1:8080/.well-known/jwks.json",
      mapClaims: defaultMapClaims,
      fetch: fetchImpl,
    });
    const token = await signToken(keys, { claims: { sub: "u", tid: "t" } });
    await assert.rejects(
      async () => verifier.verify(token),
      (error: unknown) => {
        assert.ok(error instanceof MediaContentError);
        assert.equal(error.code, "ssrf_denied");
        return true;
      },
    );
    assert.equal(fetchImpl.calls, 0);
  });

  it("never follows JWKS redirects (pinned origin preserved)", async () => {
    const keys = await makeRsaKeys();
    const fetchImpl = makeFetch(() => ({ status: 302, statusText: "Found" }));
    const { verifier } = makeVerifier({ fetchImpl });
    const token = await signToken(keys, { claims: { sub: "u", tid: "t" } });
    await assert.rejects(async () => verifier.verify(token), rejectsWith("ERR_PRISM_OIDC_JWKS_FETCH"));
  });

  it("default JWKS path pins DNS through the core pinnedFetch primitive", async () => {
    // The default (no fetchImpl) JWKS fetch routes through pinnedFetch: a JWKS
    // URL resolving to a private address fails closed as ssrf_denied before any
    // connect (rebinding defense); redirect rejection is covered in pinned-fetch.test.ts.
    await assert.rejects(
      () =>
        pinnedFetch(new URL(JWKS_URL), undefined, {
          resolver: async () => [{ address: "10.0.0.1", family: 4 }],
        }),
      (error: unknown) => error instanceof MediaContentError && error.code === "ssrf_denied",
    );
  });
});
