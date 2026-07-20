import { A2AError } from "./errors.js";
import type { A2AAgentCard, A2AAgentCardSignature } from "./a2a-types.js";

export interface SignA2AAgentCardOptions {
  readonly privateKey: CryptoKey;
  readonly keyId: string;
  readonly expiresAt: string;
  readonly issuedAt?: string;
}

export interface VerifyA2AAgentCardOptions {
  readonly publicKey: CryptoKey;
  readonly keyId?: string;
  readonly now?: Date;
  readonly maxAgeMs?: number;
}

export function createA2AAgentCard(card: A2AAgentCard): A2AAgentCard {
  validateCard(card);
  return deepFreeze(structuredClone(card));
}

export async function signA2AAgentCard(card: A2AAgentCard, options: SignA2AAgentCardOptions): Promise<A2AAgentCard> {
  validateCard(card);
  if (!options.keyId.trim()) throw new A2AError("keyId is required", 400, "ERR_PRISM_A2A_CARD");
  const issuedAt = options.issuedAt ?? new Date().toISOString();
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(options.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) throw new A2AError("Card signature expiry is invalid", 400, "ERR_PRISM_A2A_CARD");
  const protectedHeader = base64url(new TextEncoder().encode(canonicalJson({ alg: "ES256", typ: "JOSE", kid: options.keyId, iat: issuedAt, exp: options.expiresAt })));
  const payload = base64url(new TextEncoder().encode(canonicalCard(card)));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, options.privateKey, new TextEncoder().encode(`${protectedHeader}.${payload}`));
  const signed: A2AAgentCardSignature = { protected: protectedHeader, signature: base64url(new Uint8Array(signature)) };
  return deepFreeze({ ...structuredClone(card), signatures: [...(card.signatures ?? []), signed] });
}

export async function verifyA2AAgentCard(card: A2AAgentCard, options: VerifyA2AAgentCardOptions): Promise<void> {
  validateCard(card);
  if (!card.signatures?.length) throw new A2AError("Agent card is unsigned", 403, "ERR_PRISM_A2A_CARD_SIGNATURE");
  const payload = base64url(new TextEncoder().encode(canonicalCard(card)));
  let matched = false;
  for (const candidate of card.signatures) {
    try {
      const header = parseProtected(candidate.protected);
      if (header.alg !== "ES256" || header.typ !== "JOSE") continue;
      if (options.keyId !== undefined && header.kid !== options.keyId) continue;
      const now = (options.now ?? new Date()).getTime();
      const issued = Date.parse(header.iat);
      const expires = Date.parse(header.exp);
      if (!Number.isFinite(issued) || !Number.isFinite(expires) || now < issued || now >= expires) continue;
      if (options.maxAgeMs !== undefined && (options.maxAgeMs < 1 || now - issued > options.maxAgeMs)) continue;
      const valid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        options.publicKey,
        fromBase64url(candidate.signature).buffer as ArrayBuffer,
        new TextEncoder().encode(`${candidate.protected}.${payload}`),
      );
      if (valid) { matched = true; break; }
    } catch { continue; }
  }
  if (!matched) throw new A2AError("Agent card signature is invalid or expired", 403, "ERR_PRISM_A2A_CARD_SIGNATURE");
}

export function canonicalizeA2AAgentCard(card: A2AAgentCard): string {
  validateCard(card);
  return canonicalCard(card);
}

function canonicalCard(card: A2AAgentCard): string {
  const { signatures: _signatures, ...unsigned } = card;
  return canonicalJson(unsigned);
}

function validateCard(card: A2AAgentCard): void {
  let serialized: string; try { serialized = JSON.stringify(card); } catch { throw new A2AError("Agent card must be JSON", 400, "ERR_PRISM_A2A_CARD"); }
  if (Buffer.byteLength(serialized) > 1024 * 1024 || card.supportedInterfaces.length > 16 || card.skills.length > 256) throw new A2AError("Agent card exceeds collection/byte limits", 400, "ERR_PRISM_A2A_CARD");
  if (!card.name?.trim() || !card.description?.trim() || !card.version?.trim()) throw new A2AError("Agent card identity is incomplete", 400, "ERR_PRISM_A2A_CARD");
  if (!card.supportedInterfaces.length || !card.supportedInterfaces.every((item) => item.protocolBinding === "JSONRPC" && item.protocolVersion === "1.0" && isHttpsUrl(item.url))) throw new A2AError("Agent card requires an HTTPS JSONRPC 1.0 interface", 400, "ERR_PRISM_A2A_CARD");
  if (!card.defaultInputModes.includes("text/plain") || !card.defaultOutputModes.includes("text/plain")) throw new A2AError("Agent card must support text/plain", 400, "ERR_PRISM_A2A_CARD");
  const ids = new Set<string>();
  for (const skill of card.skills) {
    if (!skill.id.trim() || !skill.name.trim() || !skill.description.trim() || ids.has(skill.id) || skill.tags.length > 64 || [skill.id, skill.name, skill.description, ...skill.tags].some((value) => Buffer.byteLength(value) > 16 * 1024)) throw new A2AError("Agent card skill is invalid", 400, "ERR_PRISM_A2A_CARD");
    ids.add(skill.id);
  }
}

function parseProtected(value: string): { readonly alg: string; readonly typ: string; readonly kid: string; readonly iat: string; readonly exp: string } {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64url(value)));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid protected header");
  const record = parsed as Record<string, unknown>;
  if (typeof record.alg !== "string" || typeof record.typ !== "string" || typeof record.kid !== "string" || typeof record.iat !== "string" || typeof record.exp !== "string") throw new Error("invalid protected header");
  return { alg: record.alg, typ: record.typ, kid: record.kid, iat: record.iat, exp: record.exp };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new A2AError("Non-finite card number", 400, "ERR_PRISM_A2A_CARD");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new A2AError("Agent card is not canonical JSON", 400, "ERR_PRISM_A2A_CARD");
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function fromBase64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid base64url");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
