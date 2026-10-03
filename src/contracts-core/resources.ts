/** Contracts-core resources family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { PermissionPolicy, TrustPolicy } from "../security.js";

export interface Resource {
  readonly uri: string;
  readonly mediaType?: string;
  readonly text?: string;
  readonly data?: Uint8Array;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ResourceLoader {
  load(uri: string, context?: ResourceLoadContext): Promise<Resource>;
  list?(context?: ResourceLoadContext): Promise<readonly Resource[]>;
}

export interface ResourceLoadContext {
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly permission?: PermissionPolicy;
  readonly trust?: TrustPolicy;
}

export interface SettingsProvider {
  get<T = unknown>(key: string): Promise<T | undefined> | T | undefined;
}

export interface CredentialRequest {
  readonly name: string;
  readonly provider?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Credential {
  readonly type: "bearer" | "api_key" | "basic" | "custom";
  readonly value: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CredentialResolver {
  resolve(request: CredentialRequest): Promise<Credential | undefined> | Credential | undefined;
  /**
   * Stores a value a host captured at an `env:`/`keyring:` ref (roadmap §2.3 `HostUi` `secret`).
   * Optional: a resolver without it answers `unavailable` to a `secret` request, so the default
   * `env:`-only resolver fails closed rather than holding a secret it cannot persist.
   */
  store?(ref: string, value: string): Promise<void> | void;
}

export interface CredentialResolverSource {
  readonly name: string;
  readonly resolver: CredentialResolver;
}

export interface OAuthLoginCallbacks {
  onAuth?(url: string): void | Promise<void>;
  onDeviceCode?(code: { readonly userCode: string; readonly verificationUri: string; readonly expiresAt?: string }): void | Promise<void>;
  onPrompt?(message: string): string | undefined | Promise<string | undefined>;
  onSelect?(prompt: { readonly message: string; readonly choices: readonly string[] }): string | undefined | Promise<string | undefined>;
  /** Aborts OAuth login flows and device-code polling when signaled. */
  readonly signal?: AbortSignal;
}

export interface OAuthCredentials {
  readonly access?: string;
  readonly refresh?: string;
  readonly expires?: string | number;
  readonly accountId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface OAuthProvider {
  readonly id: string;
  login(callbacks?: OAuthLoginCallbacks): Promise<OAuthCredentials> | OAuthCredentials;
  refresh?(credentials: OAuthCredentials): Promise<OAuthCredentials> | OAuthCredentials;
  /** Best-effort upstream revocation; the store delete is what fails closed locally. */
  revoke?(credentials: OAuthCredentials): Promise<void> | void;
  getCredential?(credentials: OAuthCredentials): Promise<Credential | undefined> | Credential | undefined;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface OAuthCredentialStore {
  set(provider: string, credentials: OAuthCredentials): void | Promise<void>;
}
