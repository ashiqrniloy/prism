/** Contracts-core resources family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { PermissionPolicy, TrustPolicy } from "../security.js";
import type { OAuthCredentials } from "./extensions.js";

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
}

export interface CredentialResolverSource {
  readonly name: string;
  readonly resolver: CredentialResolver;
}

export interface OAuthCredentialStore {
  set(provider: string, credentials: OAuthCredentials): void | Promise<void>;
}

// ponytail: AgentLoopStrategy orchestrates shared runtime primitives via
// LoopContext; it never re-implements provider calls, retry, abort, store, or
// events. Single-shot is the default; loops are opt-in. T is host-defined,
// Prism never instantiates it. No domain control-flow vocabulary (boundary
// guard); artifact types are generic over host T.
