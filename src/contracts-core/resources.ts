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

/** A resolved secret (roadmap §2.5). The kernel never logs, event-stamps, or returns it to a package. */
export interface Secret {
  readonly type: "bearer" | "api_key" | "basic" | "custom";
  readonly value: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Context for a credentials-slot call (roadmap §2.5). */
export interface CredentialContext {
  /** The package asking, when the kernel knows it. */
  readonly package?: string;
  /** Aborts a resolver that talks to a backend or a person. */
  readonly signal?: AbortSignal;
}

/**
 * The `credentials` slot (roadmap §2.5): `resolve(ref, ctx)` for reads, plus optional `store` and
 * `delete`. A resolver without `store` answers `unavailable` to a `secret` host request, so the
 * default `env:`-only resolver fails closed rather than holding a secret it cannot persist.
 */
export interface CredentialResolver {
  resolve(ref: string, ctx: CredentialContext): Promise<Secret | undefined> | Secret | undefined;
  store?(ref: string, secret: Secret, ctx: CredentialContext): Promise<void> | void;
  delete?(ref: string, ctx: CredentialContext): Promise<void> | void;
}

/** The keyring's stored OAuth record shape: `Secret` metadata converted for durable storage. */
export interface OAuthCredentials {
  readonly access?: string;
  readonly refresh?: string;
  readonly expires?: string | number;
  readonly accountId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

