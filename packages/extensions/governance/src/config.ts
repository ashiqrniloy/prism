import type { JsonSchema, ToolCapabilityKind } from "@arnilo/prism";
import type { GovernanceRequireConfig } from "./require.js";

/** Inline rule outcome. `approval` becomes `tool.call` `{ ask }` (kernel inline confirm or suspend). */
export type GovernanceOutcome = "allow" | "deny" | "approval";

/** Outcome when no rule matches and OPA is not configured. Roadmap §2.9: deny by default. */
export type GovernanceDefault = "allow" | "deny";

/** A ref-only header. A literal value fails validation (security: no inline secrets). */
export interface GovernanceSecretRef {
  readonly ref: string;
  readonly prefix?: string;
}

/** One inline rule. All present fields must match; an omitted field matches anything. */
export interface GovernanceRule {
  /** Tool names (exact). */
  readonly tools?: readonly string[];
  /** Tool effects, from the call's declared `effects`. */
  readonly effects?: readonly ToolCapabilityKind[];
  /** Session principal kind (`session.principal.kind`). */
  readonly principalKinds?: readonly string[];
  /** Session principal id (`session.principal.id`). */
  readonly principalIds?: readonly string[];
  /**
   * Plan 159 Task 8: scopes the verified identity must hold for a call this rule otherwise matches.
   * A missing scope is a deny, independent of `outcome` and of whether OPA is configured.
   */
  readonly scopes?: readonly string[];
  readonly outcome: GovernanceOutcome;
  readonly reason?: string;
}

export interface GovernanceOpaConfig {
  /** Base OPA URL, e.g. `https://opa:8181`. With `path`, the decision endpoint is `url + "/" + path`. */
  readonly url: string;
  /** Decision path, e.g. `v1/data/prism/allow`. Omitted means `url` is the full decision endpoint. */
  readonly path?: string;
  /** Ref-only request headers, resolved through `prism.credentials.resolve`. */
  readonly headers?: Readonly<Record<string, GovernanceSecretRef>>;
  readonly timeoutMs?: number;
  readonly policyId?: string;
  readonly policyVersion?: string;
}

export interface GovernanceAuditExportConfig {
  /** Page size for `governance.audit.export()`. Defaults to the frozen policy limit. */
  readonly pageSize?: number;
}

export interface GovernanceAuditConfig {
  readonly store: "memory" | "file";
  /** Required for `store: "file"`. */
  readonly path?: string;
  /** Default `true` when `audit` is set: an append failure denies the call. */
  readonly required?: boolean;
  readonly export?: GovernanceAuditExportConfig;
}

/** Opt in to the non-tool decision points (roadmap §2.4). Both default to off. */
export interface GovernanceHooksConfig {
  readonly runInput?: boolean;
  readonly modelRequest?: boolean;
}

/**
 * Identity verification (plan 159 Task 8, roadmap §2.9).
 *
 * Governance never builds a verifier: the host installs one as a service, and `verifier` names which
 * one. Verification failure, expiry, revocation, or a tenant mismatch rejects the run in `run.input`;
 * a missing service fails `createAgent` with `missing_service`.
 */
export interface GovernanceIdentityConfig {
  /** `oidc`: a host-built OIDC/JWKS verifier. `service`: any `IdentityVerifier`. */
  readonly verifier: "oidc" | "service";
  /** Service name to consume. Defaults to `identity.verifier.oidc` for `oidc`, else `identity.verifier`. */
  readonly service?: string;
}

export interface GovernanceConfig {
  readonly default?: GovernanceDefault;
  readonly rules?: readonly GovernanceRule[];
  readonly opa?: GovernanceOpaConfig;
  readonly audit?: GovernanceAuditConfig;
  readonly hooks?: GovernanceHooksConfig;
  /** Plan 159 Task 7: the `createSecureAgent` guarantees, re-expressed as config. */
  readonly require?: GovernanceRequireConfig;
  /** Plan 159 Task 8: verify the session principal before each run. Off when absent. */
  readonly identity?: GovernanceIdentityConfig;
}

const SECRET_REF_PATTERN = "^(env|keyring):[A-Za-z0-9_.\\-/]+$";

const secretRefSchema: JsonSchema = {
  type: "object",
  properties: {
    ref: { type: "string", pattern: SECRET_REF_PATTERN },
    prefix: { type: "string", maxLength: 64 },
  },
  required: ["ref"],
  additionalProperties: false,
};

const requireSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    principal: { type: "boolean" },
    ownership: { type: "boolean" },
  },
};

const ruleSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["outcome"],
  properties: {
    tools: { type: "array", items: { type: "string", minLength: 1, maxLength: 256 }, maxItems: 256 },
    effects: {
      type: "array",
      items: { type: "string", enum: ["read", "write", "execute", "network", "external"] },
      maxItems: 5,
    },
    principalKinds: { type: "array", items: { type: "string", minLength: 1, maxLength: 64 }, maxItems: 32 },
    principalIds: { type: "array", items: { type: "string", minLength: 1, maxLength: 256 }, maxItems: 64 },
    scopes: { type: "array", items: { type: "string", minLength: 1, maxLength: 512 }, maxItems: 64 },
    outcome: { type: "string", enum: ["allow", "deny", "approval"] },
    reason: { type: "string", minLength: 1, maxLength: 512 },
  },
};

const identitySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verifier"],
  properties: {
    verifier: { type: "string", enum: ["oidc", "service"] },
    service: { type: "string", minLength: 1, maxLength: 128 },
  },
};

export const governanceConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    default: { type: "string", enum: ["allow", "deny"], default: "deny" },
    rules: { type: "array", items: ruleSchema, maxItems: 500, default: [] },
    opa: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: { type: "string", minLength: 1, maxLength: 2048 },
        path: { type: "string", minLength: 1, maxLength: 1024 },
        headers: {
          type: "object",
          additionalProperties: secretRefSchema,
        },
        timeoutMs: { type: "integer", minimum: 1, maximum: 30_000 },
        policyId: { type: "string", minLength: 1, maxLength: 512 },
        policyVersion: { type: "string", minLength: 1, maxLength: 256 },
      },
    },
    audit: {
      type: "object",
      additionalProperties: false,
      required: ["store"],
      properties: {
        store: { type: "string", enum: ["memory", "file"] },
        path: { type: "string", minLength: 1, maxLength: 4096 },
        required: { type: "boolean" },
        export: {
          type: "object",
          additionalProperties: false,
          properties: { pageSize: { type: "integer", minimum: 1, maximum: 500 } },
        },
      },
    },
    hooks: {
      type: "object",
      additionalProperties: false,
      properties: {
        runInput: { type: "boolean" },
        modelRequest: { type: "boolean" },
      },
    },
    require: requireSchema,
    identity: identitySchema,
  },
};
