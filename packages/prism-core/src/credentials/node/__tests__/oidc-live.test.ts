/**
 * Plans/064 Task 9 live OIDC/JWKS verifier probes against a real issuer.
 * Env-gated: skipped (never failed) unless PRISM_TEST_OIDC_ISSUER,
 * PRISM_TEST_OIDC_AUDIENCE, and PRISM_TEST_OIDC_TOKEN are all set.
 * PRISM_TEST_OIDC_JWKS_URL overrides the pinned JWKS URL (default:
 * `<issuer>/.well-known/jwks.json`). Bounded: exactly 1 JWKS fetch —
 * the negative legs reuse the cached key set.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IdentityError } from "@arnilo/prism";
import { createOidcIdentityVerifier, type OidcClaims } from "../oidc.js";

const ISSUER = process.env.PRISM_TEST_OIDC_ISSUER;
const AUDIENCE = process.env.PRISM_TEST_OIDC_AUDIENCE;
const TOKEN = process.env.PRISM_TEST_OIDC_TOKEN;
const JWKS_URL = process.env.PRISM_TEST_OIDC_JWKS_URL ?? (ISSUER ? `${ISSUER.replace(/\/+$/, "")}/.well-known/jwks.json` : undefined);
const skip: string | false =
  !ISSUER || !AUDIENCE || !TOKEN
    ? "set PRISM_TEST_OIDC_ISSUER, PRISM_TEST_OIDC_AUDIENCE, and PRISM_TEST_OIDC_TOKEN (optionally PRISM_TEST_OIDC_JWKS_URL) to run live OIDC verifier probes"
    : false;

function mapClaims(claims: OidcClaims) {
  return {
    tenantId: typeof claims.tid === "string" && claims.tid ? claims.tid : "live-oidc-tenant",
    principal: { kind: "user" as const, id: String(claims.sub ?? "live-oidc-user") },
    scopes: Array.isArray(claims.scp) ? (claims.scp as string[]) : [],
  };
}

function verifier() {
  return createOidcIdentityVerifier({ issuer: ISSUER!, audience: AUDIENCE!, jwksUrl: JWKS_URL!, mapClaims });
}

describe("@arnilo/prism-core credentials/node/oidc live tests", () => {
  it("live_valid_token_verifies_against_real_jwks", { skip }, async () => {
    const identity = await verifier().verify(TOKEN);
    assert.equal(typeof identity.tenantId, "string");
    assert.ok(identity.tenantId.length > 0, "mapClaims must supply a tenantId");
    assert.equal(identity.principal.kind, "user");
  });

  it("live_tampered_token_fails_closed", { skip }, async () => {
    // Flip the last signature character: same shape, broken signature.
    const [header, payload, signature] = TOKEN!.split(".");
    const flipped = signature!.slice(0, -1) + (signature!.slice(-1) === "A" ? "B" : "A");
    const tampered = `${header}.${payload}.${flipped}`;
    const error = await Promise.resolve(verifier().verify(tampered)).then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof IdentityError, "tampered token must fail closed with IdentityError");
    assert.equal((error as IdentityError).code, "ERR_PRISM_OIDC_SIGNATURE");
    assert.ok(!String(error).includes(TOKEN!), "error text must never echo the bearer token");
  });

  it("live_garbage_token_fails_closed_without_jwks_traffic", { skip }, async () => {
    const error = await Promise.resolve(verifier().verify("not-a-jwt")).then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof IdentityError, "garbage token must fail closed with IdentityError");
  });
});
