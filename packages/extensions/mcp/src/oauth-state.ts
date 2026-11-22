import type { Secret } from "@arnilo/prism";
import type { OAuthDiscoveryState, StoredOAuthClientInformation, StoredOAuthTokens } from "@modelcontextprotocol/client";
import { type McpClientAuthState, McpOAuthError } from "./auth.js";

/** The `Secret.metadata` key that holds the sign-in record. */
export const MCP_OAUTH_RECORD_KEY = "mcpOAuth";
/** The secret value written while no access token exists yet (the keyring requires a value). */
export const MCP_OAUTH_PENDING_MARKER = "mcp-oauth-pending";
/** Bound on the whole serialized record: the hard `tokenRecordBytes` cap, since it holds five records. */
export const MCP_OAUTH_RECORD_BYTES = 64 * 1024;

/** Every `McpClientAuthState` record, kept together under one credential ref. */
export interface McpOAuthRecord {
  readonly v: 1;
  readonly redirectUri?: string;
  readonly tokens?: StoredOAuthTokens;
  readonly client?: StoredOAuthClientInformation;
  readonly discovery?: OAuthDiscoveryState;
  readonly verifier?: string;
  readonly authorizationState?: { readonly state: string; readonly authorizationServerUrl?: string };
}

/** What the state needs from `prism.credentials`. */
export interface McpOAuthCredentialSlot {
  resolve(ref: string): Promise<Secret | undefined>;
  store(ref: string, secret: Secret): Promise<void>;
  delete(ref: string): Promise<void>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads the record out of a stored secret. A malformed field is dropped, never half-trusted. */
export function parseMcpOAuthRecord(secret: Secret | undefined): McpOAuthRecord {
  const raw = isObject(secret?.metadata) ? secret.metadata[MCP_OAUTH_RECORD_KEY] : undefined;
  if (!isObject(raw) || raw.v !== 1) return { v: 1 };
  const authorizationState =
    isObject(raw.authorizationState) && typeof raw.authorizationState.state === "string"
      ? (raw.authorizationState as unknown as McpOAuthRecord["authorizationState"])
      : undefined;
  return {
    v: 1,
    ...(typeof raw.redirectUri === "string" ? { redirectUri: raw.redirectUri } : {}),
    ...(isObject(raw.tokens) && typeof raw.tokens.access_token === "string" ? { tokens: raw.tokens as unknown as StoredOAuthTokens } : {}),
    ...(isObject(raw.client) && typeof raw.client.client_id === "string"
      ? { client: raw.client as unknown as StoredOAuthClientInformation }
      : {}),
    ...(isObject(raw.discovery) ? { discovery: raw.discovery as unknown as OAuthDiscoveryState } : {}),
    ...(typeof raw.verifier === "string" ? { verifier: raw.verifier } : {}),
    ...(authorizationState ? { authorizationState } : {}),
  };
}

/** The record as a secret: the access token is the value (so the kernel redacts it), the rest is metadata. */
export function mcpOAuthRecordToSecret(record: McpOAuthRecord): Secret {
  return record.tokens
    ? { type: "bearer", value: record.tokens.access_token, metadata: { [MCP_OAUTH_RECORD_KEY]: record } }
    : { type: "custom", value: MCP_OAUTH_PENDING_MARKER, metadata: { [MCP_OAUTH_RECORD_KEY]: record } };
}

export interface McpOAuthSessionState {
  readonly state: McpClientAuthState;
  /** The redirect URI saved with the record, if any. */
  readonly savedRedirectUri: string | undefined;
  /** Records the redirect URI in use; it is written with the next save. */
  setRedirectUri(redirectUri: string): void;
}

/**
 * Loads the record once and writes it back through the credentials slot on every change, so a
 * reconnect reads the current value and a refresh lands in the store. `clear("all")` deletes the ref.
 */
export async function loadMcpOAuthSessionState(ref: string, slot: McpOAuthCredentialSlot): Promise<McpOAuthSessionState> {
  let record = parseMcpOAuthRecord(await slot.resolve(ref));
  let redirectUri = record.redirectUri;
  let writes: Promise<void> = Promise.resolve();

  const save = (patch: Partial<Omit<McpOAuthRecord, "v">>, drop: readonly (keyof McpOAuthRecord)[] = []): Promise<void> => {
    const next: Record<string, unknown> = { ...record, ...patch, ...(redirectUri !== undefined ? { redirectUri } : {}) };
    for (const key of drop) delete next[key];
    const candidate = next as unknown as McpOAuthRecord;
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > MCP_OAUTH_RECORD_BYTES) {
      return Promise.reject(new McpOAuthError("ERR_PRISM_MCP_OAUTH_TOKEN_STORE", `OAuth record exceeds ${MCP_OAUTH_RECORD_BYTES} bytes`));
    }
    record = candidate;
    // Writes are ordered, so a later save never lands before an earlier one.
    writes = writes.then(() => slot.store(ref, mcpOAuthRecordToSecret(candidate)));
    return writes;
  };

  const state: McpClientAuthState = {
    loadTokens: async () => record.tokens,
    saveTokens: (tokens) => save({ tokens }),
    loadDiscovery: async () => record.discovery,
    saveDiscovery: (discovery) => save({ discovery }),
    loadClientInformation: async () => record.client,
    saveClientInformation: (client) => save({ client }),
    loadCodeVerifier: async () => record.verifier,
    saveCodeVerifier: (verifier) => save({ verifier }),
    loadAuthorizationState: async () => record.authorizationState,
    saveAuthorizationState: (authorizationState) => save({ authorizationState }),
    async clear(scope) {
      if (scope === "all") {
        record = { v: 1 };
        writes = writes.then(() => slot.delete(ref));
        return writes;
      }
      const key = scope === "verifier" ? "verifier" : scope;
      if (record[key] === undefined) return;
      return save({}, [key]);
    },
  };

  return {
    state,
    savedRedirectUri: record.redirectUri,
    setRedirectUri(next) {
      redirectUri = next;
    },
  };
}
