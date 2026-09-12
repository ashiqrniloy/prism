/**
 * Artifact delivery links (plan 070 Task 8 split of runtime/server/artifacts.ts, moved
 * verbatim): HMAC-SHA256 signing and fail-closed verification (signature, byte cap, shape,
 * expiry) of expiring delivery tokens. The timing-safe compare is security-critical.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { type ArtifactDeliveryToken, ArtifactError } from "@arnilo/prism";
import { HARD_DELIVERY_LINK_TOKEN_BYTES } from "./artifacts-limits.js";

/** Sign an expiring delivery token: base64url(payload).base64url(HMAC-SHA256). */
export function signArtifactDeliveryLink(token: ArtifactDeliveryToken, secret: string): string {
  const payload = Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/** Verify signature + expiry and parse a delivery link. Fail-closed on any tamper/expiry. */
export function verifyArtifactDeliveryLink(
  link: string,
  secret: string,
  maxBytes: number = HARD_DELIVERY_LINK_TOKEN_BYTES,
): ArtifactDeliveryToken {
  if (typeof link !== "string" || link.length === 0) throw new ArtifactError("Delivery link is required", "invalid_link");
  if (Buffer.byteLength(link, "utf8") > maxBytes) throw new ArtifactError("Delivery link exceeds byte limit", "link_too_large");
  const dot = link.lastIndexOf(".");
  if (dot <= 0 || dot === link.length - 1) throw new ArtifactError("Delivery link is invalid", "invalid_link");
  const payload = link.slice(0, dot);
  const signature = link.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    throw new ArtifactError("Delivery link signature invalid", "invalid_link");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new ArtifactError("Delivery link is invalid", "invalid_link");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ArtifactError("Delivery link is invalid", "invalid_link");
  const token = parsed as Record<string, unknown>;
  if (
    typeof token.artifactId !== "string" ||
    typeof token.threadId !== "string" ||
    !Number.isSafeInteger(token.version) ||
    typeof token.issuedAt !== "string" ||
    typeof token.expiresAt !== "string"
  ) {
    throw new ArtifactError("Delivery link is invalid", "invalid_link");
  }
  const expiresAt = Date.parse(token.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new ArtifactError("Delivery link expired", "link_expired");
  return {
    artifactId: token.artifactId,
    threadId: token.threadId,
    version: token.version as number,
    ...(typeof token.tenantId === "string" ? { tenantId: token.tenantId } : {}),
    ...(typeof token.accountId === "string" ? { accountId: token.accountId } : {}),
    ...(typeof token.userId === "string" ? { userId: token.userId } : {}),
    issuedAt: token.issuedAt,
    expiresAt: token.expiresAt,
  };
}
