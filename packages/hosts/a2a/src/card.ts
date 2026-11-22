import { createPrivateKey, sign } from "node:crypto";
import { A2A_PROTOCOL_VERSION, canonicalJson, PRISM_DECISIONS_EXTENSION } from "./codec.js";
import { A2AClientError, A2AConfigError } from "./errors.js";

export interface A2AAgentInterface {
  readonly url: string;
  readonly protocolBinding: "JSONRPC" | "GRPC" | "HTTP+JSON";
  readonly protocolVersion: string;
  readonly tenant?: string;
}

export interface A2AAgentExtension {
  readonly uri: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface A2AAgentCapabilities {
  readonly streaming?: boolean;
  readonly pushNotifications?: boolean;
  readonly extendedAgentCard?: boolean;
  readonly extensions?: readonly A2AAgentExtension[];
}

export interface A2AAgentSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly examples?: readonly string[];
  readonly inputModes?: readonly string[];
  readonly outputModes?: readonly string[];
}

export interface A2AAgentCardSignature {
  readonly protected: string;
  readonly signature: string;
  readonly header?: Readonly<Record<string, unknown>>;
}

/** Agent Card (spec §4.4.1). `serveA2A` fills `capabilities` from what it implements. */
export interface A2AAgentCard {
  readonly name: string;
  readonly description: string;
  readonly supportedInterfaces: readonly A2AAgentInterface[];
  readonly version: string;
  readonly capabilities?: A2AAgentCapabilities;
  readonly defaultInputModes: readonly string[];
  readonly defaultOutputModes: readonly string[];
  readonly skills: readonly A2AAgentSkill[];
  readonly provider?: { readonly organization: string; readonly url: string };
  readonly iconUrl?: string;
  readonly documentationUrl?: string;
  /** Declared only; the host's `authorize` verifies whatever is declared here. */
  readonly securitySchemes?: Readonly<Record<string, unknown>>;
  readonly securityRequirements?: readonly unknown[];
  readonly signatures?: readonly A2AAgentCardSignature[];
}

const MAX_CARD_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Validates the host's card and states what this server implements: streaming on, push notifications and
 * the extended card off, and the Prism decisions extension declared. A card that claims otherwise is refused.
 */
export function buildServedCard(card: A2AAgentCard): A2AAgentCard {
  let serialized: string;
  try {
    serialized = JSON.stringify(card);
  } catch {
    throw new A2AConfigError("card must be JSON");
  }
  if (Buffer.byteLength(serialized) > MAX_CARD_BYTES) throw new A2AConfigError("card exceeds 1 MiB");
  for (const field of ["name", "description", "version"] as const) {
    if (typeof card[field] !== "string" || card[field].trim().length === 0) throw new A2AConfigError(`card.${field} is required`);
  }
  if (!Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length === 0 || card.supportedInterfaces.length > 16) {
    throw new A2AConfigError("card.supportedInterfaces must list 1 to 16 interfaces");
  }
  const jsonRpc = card.supportedInterfaces.filter((entry) => entry.protocolBinding === "JSONRPC");
  if (jsonRpc.length === 0) throw new A2AConfigError("card must declare a JSONRPC interface");
  for (const entry of card.supportedInterfaces) {
    if (entry.protocolBinding !== "JSONRPC") throw new A2AConfigError("serveA2A serves the JSONRPC binding only");
    if (entry.protocolVersion !== A2A_PROTOCOL_VERSION) throw new A2AConfigError("card interfaces must declare protocolVersion 1.0");
    assertServableUrl(entry.url);
  }
  if (card.signatures !== undefined) throw new A2AConfigError("card.signatures is set by serveA2A from options.signing");
  for (const field of ["defaultInputModes", "defaultOutputModes"] as const) {
    const modes = card[field];
    if (!Array.isArray(modes) || modes.length === 0 || modes.some((mode) => typeof mode !== "string")) {
      throw new A2AConfigError(`card.${field} must list media types`);
    }
  }
  if (!Array.isArray(card.skills) || card.skills.length > 256) throw new A2AConfigError("card.skills must be an array of at most 256");
  const ids = new Set<string>();
  for (const skill of card.skills) {
    if (!skill?.id?.trim() || !skill.name?.trim() || !skill.description?.trim() || !Array.isArray(skill.tags) || ids.has(skill.id)) {
      throw new A2AConfigError("card.skills entries need a unique id, a name, a description and tags");
    }
    ids.add(skill.id);
  }
  const requested = card.capabilities ?? {};
  if (requested.pushNotifications) throw new A2AConfigError("serveA2A does not support push notifications");
  if (requested.extendedAgentCard) throw new A2AConfigError("serveA2A does not serve an extended Agent Card");
  const extensions = (requested.extensions ?? []).filter((entry) => entry.uri !== PRISM_DECISIONS_EXTENSION);
  return structuredClone({
    ...card,
    capabilities: {
      ...requested,
      streaming: true,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [
        ...extensions,
        {
          uri: PRISM_DECISIONS_EXTENSION,
          description: "Answers TASK_STATE_INPUT_REQUIRED: a data part { decisions: [{ approvalId, outcome }] } resumes the task.",
          required: false,
        },
      ],
    },
  });
}

/** The JSON-RPC endpoint path, taken from the first JSONRPC interface. */
export function endpointPathOf(card: A2AAgentCard): string {
  const entry = card.supportedInterfaces.find((item) => item.protocolBinding === "JSONRPC");
  return new URL(entry?.url ?? "https://invalid/").pathname;
}

function assertServableUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new A2AConfigError("card interface url is invalid");
  }
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return;
  throw new A2AConfigError("card interface url must be https (http only on a loopback host)");
}

/**
 * Appends one detached JWS (ES256, `typ: JOSE`) over the RFC 8785 canonical card without `signatures`.
 * `privateKeyPem` is a PKCS#8 P-256 key resolved from a ref; it never leaves this function.
 */
export function signAgentCard(card: A2AAgentCard, privateKeyPem: string, keyId: string): A2AAgentCard {
  const { signatures: _drop, ...unsigned } = card;
  const header = Buffer.from(canonicalJson({ alg: "ES256", kid: keyId, typ: "JOSE" })).toString("base64url");
  const payload = Buffer.from(canonicalJson(unsigned)).toString("base64url");
  let signature: Buffer;
  try {
    const key = createPrivateKey(privateKeyPem);
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("not P-256");
    signature = sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  } catch {
    throw new A2AConfigError("card signing key must be a PKCS#8 P-256 private key");
  }
  return { ...unsigned, signatures: [{ protected: header, signature: signature.toString("base64url") }] };
}

/** What `connectA2A` reads from a peer's card: the card itself and the JSON-RPC endpoint it will call. */
export interface PeerCard {
  readonly card: A2AAgentCard;
  readonly endpoint: URL;
  readonly streaming: boolean;
}

/**
 * Client-side card validation, separate from {@link buildServedCard}: any declared capabilities are accepted,
 * but the card must name a JSONRPC `1.0` interface whose origin is the card's own origin or one the host
 * listed in `allowedOrigins`. A card on another origin cannot redirect the proxy (and its token) elsewhere.
 */
export function readPeerCard(value: unknown, cardUrl: URL, allowedOrigins: ReadonlySet<string>): PeerCard {
  const invalid = (message: string) => new A2AClientError("a2a_invalid_card", `Agent Card ${message}`);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid("is not an object");
  const card = value as Record<string, unknown>;
  for (const field of ["name", "description", "version"] as const) {
    const text = card[field];
    if (typeof text !== "string" || text.trim().length === 0 || text.length > 1024) throw invalid(`${field} is invalid`);
  }
  const interfaces = card.supportedInterfaces;
  if (!Array.isArray(interfaces) || interfaces.length === 0 || interfaces.length > 16) throw invalid("supportedInterfaces is invalid");
  const jsonRpc = interfaces.find(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      (entry as A2AAgentInterface).protocolBinding === "JSONRPC" &&
      typeof (entry as A2AAgentInterface).protocolVersion === "string" &&
      /^1\.0(?:\.\d+)?$/.test((entry as A2AAgentInterface).protocolVersion) &&
      typeof (entry as A2AAgentInterface).url === "string",
  ) as A2AAgentInterface | undefined;
  if (!jsonRpc) throw invalid("declares no JSONRPC 1.0 interface");
  let endpoint: URL;
  try {
    endpoint = new URL(jsonRpc.url);
  } catch {
    throw invalid("interface url is invalid");
  }
  if (endpoint.origin !== cardUrl.origin && !allowedOrigins.has(endpoint.origin)) {
    throw invalid("names an endpoint on another origin");
  }
  const capabilities = card.capabilities;
  const streaming = capabilities !== null && typeof capabilities === "object" && (capabilities as A2AAgentCapabilities).streaming === true;
  return { card: structuredClone(value) as A2AAgentCard, endpoint, streaming };
}
