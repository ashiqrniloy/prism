import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Credential, CredentialRecord, CredentialRequest, OAuthCredentials } from "@arnilo/prism";
import {
  CredentialStoreError,
  CredentialStoreUnavailableError,
  createFileCredentialStore,
  createKeychainCredentialStore,
  openEncryptedCredentialStore,
  probeKeychainAvailability,
  type StoredCredentialStore,
} from "@arnilo/prism-core/credentials/node";
import type { PrismCodeConfig } from "./config.js";
import type { PrismCodeCredentialStoreChoice, PrismCodeState } from "./home.js";
import type { CredentialResolver } from "./providers.js";

// ---------------------------------------------------------------------------
// In-Memory StoredCredentialStore (explicit "don't save" choice only)
// ---------------------------------------------------------------------------

export class MemoryStoredCredentialStore implements StoredCredentialStore {
  private readonly records = new Map<string, CredentialRecord>();
  private readonly oauthRecords = new Map<string, OAuthCredentials>();

  private credKey(name: string, provider?: string): string {
    return `${provider ?? "default"}:${name}`;
  }

  private oauthKey(provider: string, accountId?: string): string {
    return `${provider}:${accountId ?? "default"}`;
  }

  resolve(request: CredentialRequest): Credential | undefined {
    const key = this.credKey(request.name, request.provider);
    return this.records.get(key)?.credential;
  }

  get(request: Pick<CredentialRequest, "name" | "provider">): Credential | undefined {
    return this.resolve(request as CredentialRequest);
  }

  set(record: CredentialRecord): void {
    const key = this.credKey(record.name, record.provider);
    this.records.set(key, record);
  }

  delete(request: Pick<CredentialRequest, "name" | "provider">): boolean {
    const key = this.credKey(request.name, request.provider);
    return this.records.delete(key);
  }

  setOAuth(provider: string, credentials: OAuthCredentials, accountId?: string): void {
    const key = this.oauthKey(provider, accountId);
    this.oauthRecords.set(key, credentials);
  }

  getOAuth(provider: string, accountId?: string): OAuthCredentials | undefined {
    const key = this.oauthKey(provider, accountId);
    return this.oauthRecords.get(key);
  }

  deleteOAuth(provider: string, accountId?: string): boolean {
    const key = this.oauthKey(provider, accountId);
    return this.oauthRecords.delete(key);
  }

  list(): CredentialRecord[] {
    return Array.from(this.records.values());
  }

  listOAuth(): Array<{ provider: string; accountId?: string; credentials: OAuthCredentials }> {
    return Array.from(this.oauthRecords.entries()).map(([k, credentials]) => {
      const [provider, accountId] = k.split(":");
      return { provider: provider ?? "", accountId, credentials };
    });
  }
}

/** Fail-closed placeholder until the user picks a store (TUI) or a credential is actually needed. */
export class UnavailableStoredCredentialStore implements StoredCredentialStore {
  constructor(private readonly message: string) {}

  private fail(): never {
    throw new CredentialStoreUnavailableError(this.message);
  }

  resolve(): Credential | undefined {
    this.fail();
  }
  get(): Credential | undefined {
    this.fail();
  }
  set(): void {
    this.fail();
  }
  delete(): boolean {
    this.fail();
  }
  setOAuth(): void {
    this.fail();
  }
  getOAuth(): OAuthCredentials | undefined {
    this.fail();
  }
  deleteOAuth(): boolean {
    this.fail();
  }
  list(): CredentialRecord[] {
    this.fail();
  }
  listOAuth(): Array<{ provider: string; accountId?: string; credentials: OAuthCredentials }> {
    this.fail();
  }
}

// ---------------------------------------------------------------------------
// Ambient Provider Environment Variables
// ---------------------------------------------------------------------------

export const PROVIDER_ENV_VARS: Readonly<Record<string, readonly string[]>> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  "openai-codex": ["OPENAI_ACCESS_TOKEN", "OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  xai: ["XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  alibaba: ["DASHSCOPE_API_KEY"],
  kimi: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
  "kimi-coding": ["KIMI_API_KEY", "MOONSHOT_API_KEY"],
  moonshot: ["MOONSHOT_API_KEY"],
  clinepass: ["CLINEPASS_API_KEY"],
  commandcode: ["COMMANDCODE_API_KEY"],
  neuralwatt: ["NEURALWATT_API_KEY"],
  "opencode-go": ["OPENCODE_GO_API_KEY"],
  typesafe: ["TYPESAFE_API_KEY"],
  laya: ["LAYA_API_KEY"],
  zai: ["ZAI_API_KEY"],
  hyper: ["HYPER_API_KEY"],
  azure: ["AZURE_OPENAI_API_KEY", "AZURE_API_KEY"],
  bedrock: ["AWS_ACCESS_KEY_ID"],
  vertex: ["GOOGLE_APPLICATION_CREDENTIALS"],
  // Web backends resolve through the same credential path (store first, then env).
  brave: ["BRAVE_API_KEY", "BRAVE_SEARCH_TOKEN"],
  firecrawl: ["FIRECRAWL_API_KEY"],
};

/** Reverse map: provider env var name → provider id (used by the resolver for stored keys). */
function providerForEnvVar(ref: string): string | undefined {
  for (const [provider, envVars] of Object.entries(PROVIDER_ENV_VARS)) {
    if (envVars.includes(ref)) return provider;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// PrismCodeCredentialManager
// ---------------------------------------------------------------------------

export const PRISM_CODE_KEYCHAIN_SERVICE = "prism-code";
export const PRISM_CREDENTIALS_PASSPHRASE_ENV = "PRISM_CREDENTIALS_PASSPHRASE";

export interface PrismCodeCredentialManagerOptions {
  /** Explicit store; when omitted the OS keychain is used and never silently replaced. */
  readonly store?: StoredCredentialStore;
  readonly serviceName?: string;
  /** Test/embedding seam: session-only in-memory store instead of the keychain. */
  readonly disableKeychain?: boolean;
}

export class PrismCodeCredentialManager {
  private store: StoredCredentialStore;

  constructor(options?: PrismCodeCredentialManagerOptions) {
    if (options?.store) {
      this.store = options.store;
    } else if (options?.disableKeychain) {
      this.store = new MemoryStoredCredentialStore();
    } else {
      this.store = createKeychainCredentialStore({ service: options?.serviceName ?? PRISM_CODE_KEYCHAIN_SERVICE });
    }
  }

  getStore(): StoredCredentialStore {
    return this.store;
  }

  /** Install the store chosen after the TUI picker; the manager identity stays the same. */
  setStore(store: StoredCredentialStore): void {
    this.store = store;
  }

  /**
   * Resolves API key for a provider:
   * 1. Secret store (secure keychain / vault)
   * 2. Ambient environment variables (without rewriting them)
   */
  async getApiKey(provider: string, credentialName = "apiKey"): Promise<string | undefined> {
    try {
      const stored = await this.store.get({ name: credentialName, provider });
      if (stored && typeof stored === "object" && "value" in stored && typeof stored.value === "string") {
        return stored.value;
      }
    } catch {
      // Ignore store read error and fall back to ambient env
    }

    const envVars = PROVIDER_ENV_VARS[provider.toLowerCase()] ?? [`${provider.toUpperCase()}_API_KEY`];
    for (const v of envVars) {
      const val = process.env[v];
      if (val && val.length > 0) return val;
    }

    return undefined;
  }

  /**
   * Saves API key securely to the credential store.
   * Never logs or prints secrets.
   */
  async setApiKey(provider: string, apiKey: string, credentialName = "apiKey"): Promise<void> {
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new Error("Cannot save empty API key");
    }
    await this.store.set({
      name: credentialName,
      provider,
      credential: {
        type: "api_key",
        value: apiKey.trim(),
      },
    });
  }

  async getOAuth(provider: string, accountId?: string): Promise<OAuthCredentials | undefined> {
    return this.store.getOAuth(provider, accountId);
  }

  async setOAuth(provider: string, credentials: OAuthCredentials, accountId?: string): Promise<void> {
    await this.store.setOAuth(provider, credentials, accountId);
  }

  async delete(provider: string, credentialName = "apiKey"): Promise<boolean> {
    return this.store.delete({ name: credentialName, provider });
  }

  async deleteOAuth(provider: string, accountId?: string): Promise<boolean> {
    return this.store.deleteOAuth(provider, accountId);
  }

  /**
   * Returns true if the provider has stored credentials, ambient env credentials,
   * or requires no credentials (ambient / mock / ollama).
   */
  async hasCredentials(provider: string): Promise<boolean> {
    const id = provider.toLowerCase();
    if (id === "mock" || id === "ollama") return true;

    // Check store
    try {
      const stored = await this.store.get({ name: "apiKey", provider: id });
      if (stored && typeof stored === "object" && "value" in stored && stored.value) {
        return true;
      }
      const oauth = await this.store.getOAuth(id);
      if (oauth?.access) return true;
    } catch {
      // Fall through to ambient env check
    }

    // Check ambient env
    const envVars = PROVIDER_ENV_VARS[id] ?? [`${id.toUpperCase()}_API_KEY`];
    for (const v of envVars) {
      const val = process.env[v];
      if (val && val.length > 0) return true;
    }

    return false;
  }

  /**
   * Async CredentialResolver adapter for SDK / provider instantiation.
   * Ambient env first (the ref may itself be a variable name), then the store under the same
   * keys `setApiKey` writes: `{ name: "apiKey", provider }` for provider env vars, `{ name: ref }` otherwise.
   */
  createResolver(): CredentialResolver {
    return async (ref: string) => {
      if (process.env[ref]) return process.env[ref];
      try {
        const provider = providerForEnvVar(ref);
        const credential = provider ? await this.store.get({ name: "apiKey", provider }) : await this.store.get({ name: ref });
        if (credential && typeof credential === "object" && "value" in credential && typeof credential.value === "string") {
          return credential.value;
        }
      } catch {
        // A locked/unavailable store must not break ambient env resolution.
      }
      return undefined;
    };
  }
}

// ---------------------------------------------------------------------------
// Durable store selection
// ---------------------------------------------------------------------------

export interface SelectCredentialStoreOptions {
  readonly config: PrismCodeConfig;
  readonly state: PrismCodeState;
  /** `~/.prism`; `auth.json` / `credentials.enc` live here. */
  readonly home: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Probe seam for tests; defaults to the real keychain probe. */
  readonly probeKeychain?: () => Promise<{ readonly status: "available" | "unavailable" }>;
}

export interface CredentialStoreSelection {
  readonly manager: PrismCodeCredentialManager;
  /** Effective choice; `undefined` only while the TUI picker answer is pending (`needsChoice`). */
  readonly choice?: PrismCodeCredentialStoreChoice;
  readonly needsChoice: boolean;
  /** Operator-facing note (no store selected, saved choice degraded); never contains secrets. */
  readonly notice?: string;
  /** Install the selected store after the picker; persists nothing (the caller records state). */
  apply(choice: PrismCodeCredentialStoreChoice, options?: { readonly passphrase?: string }): Promise<void>;
}

async function buildStore(
  choice: PrismCodeCredentialStoreChoice,
  home: string,
  env: NodeJS.ProcessEnv,
  passphrase?: string,
): Promise<StoredCredentialStore> {
  switch (choice) {
    case "keychain":
      return createKeychainCredentialStore({ service: PRISM_CODE_KEYCHAIN_SERVICE });
    case "file":
      return createFileCredentialStore({ path: join(home, "auth.json") });
    case "memory":
      return new MemoryStoredCredentialStore();
    case "encrypted-file": {
      const path = join(home, "credentials.enc");
      const getPassphrase = (): string => {
        const fromEnv = env[PRISM_CREDENTIALS_PASSPHRASE_ENV];
        if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
        if (passphrase !== undefined && passphrase.length > 0) return passphrase;
        throw new CredentialStoreError(
          "credential_passphrase_missing",
          `encrypted credential store needs ${PRISM_CREDENTIALS_PASSPHRASE_ENV} or the interactive passphrase prompt`,
        );
      };
      if (existsSync(path) && passphrase === undefined && !env[PRISM_CREDENTIALS_PASSPHRASE_ENV]) {
        throw new CredentialStoreError(
          "credential_passphrase_missing",
          `encrypted credential store ${path} needs ${PRISM_CREDENTIALS_PASSPHRASE_ENV} or the interactive passphrase prompt`,
        );
      }
      return openEncryptedCredentialStore({ path, getPassphrase });
    }
  }
}

function ready(choice: PrismCodeCredentialStoreChoice, store: StoredCredentialStore): CredentialStoreSelection {
  return {
    manager: new PrismCodeCredentialManager({ store }),
    choice,
    needsChoice: false,
    async apply() {
      // No pending choice; nothing to install.
    },
  };
}

/**
 * Selects the durable credential store:
 * explicit `credentials.store` → keychain probe (auto only) → saved `state.json` choice →
 * a TUI picker answer (`needsChoice`, applied later via `apply`). Never prompts by itself, so
 * headless and ACP fail closed with an actionable message when a credential is needed and absent.
 */
export async function selectCredentialStore(options: SelectCredentialStoreOptions): Promise<CredentialStoreSelection> {
  const env = options.env ?? process.env;
  const configured = options.config.credentials?.store ?? "auto";

  if (configured !== "auto") {
    return ready(configured, await buildStore(configured, options.home, env));
  }

  const probe = await (options.probeKeychain ?? (() => probeKeychainAvailability({ service: PRISM_CODE_KEYCHAIN_SERVICE })))();
  if (probe.status === "available") {
    return ready("keychain", createKeychainCredentialStore({ service: PRISM_CODE_KEYCHAIN_SERVICE }));
  }

  const saved = options.state.credentialStore;
  if (saved) {
    try {
      return ready(saved, await buildStore(saved, options.home, env));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unavailable = new UnavailableStoredCredentialStore(message);
      return {
        manager: new PrismCodeCredentialManager({ store: unavailable }),
        needsChoice: false,
        notice: `prism-code: saved credential store "${saved}" is unavailable: ${message}`,
        async apply() {},
      };
    }
  }

  const notice =
    "prism-code: no credential store selected; environment API keys still work. Set credentials.store in prism-code.json or run the TUI once to choose.";
  const manager = new PrismCodeCredentialManager({ store: new UnavailableStoredCredentialStore(notice) });
  return {
    manager,
    needsChoice: true,
    notice,
    async apply(choice, applyOptions) {
      manager.setStore(await buildStore(choice, options.home, env, applyOptions?.passphrase));
    },
  };
}
