import { isAbsolute, relative } from "node:path";
import type { Agent, AgentConfig, CheckpointStore, SecureAgentOptions, SessionStore, ToolDefinition, ToolRegistry } from "./contracts.js";
import { assertIdentityActive, assertIdentityMatchesOwnership } from "./identity.js";
import type { SecretRedactor } from "./redaction.js";

export type HostCompositionProfile = "personal" | "local-personal" | "business" | "business-worker" | "multi-tenant-worker";

export class HostCompositionError extends Error {
  constructor(
    message: string,
    readonly code = "ERR_PRISM_HOST_COMPOSITION",
  ) {
    super(message);
    this.name = "HostCompositionError";
  }
}

export interface HostCompositionGovernance {
  readonly modelRouter?: unknown;
  readonly budgetPolicy?: unknown;
  readonly rateLimitPolicy?: unknown;
  readonly supported?: boolean;
  readonly [key: string]: unknown;
}

export interface HostCompositionOptions {
  readonly profile?: HostCompositionProfile;
  readonly agent?: Agent | AgentConfig | SecureAgentOptions | Partial<AgentConfig>;
  readonly store?: SessionStore | CheckpointStore | { readonly kind?: string; readonly durable?: boolean; [key: string]: unknown };
  readonly checkpoints?: CheckpointStore;
  readonly workspaceRoot?: string;
  readonly sandboxRoots?: readonly string[];
  readonly credentialRefs?: readonly string[];
  readonly governance?: HostCompositionGovernance;
  readonly redactor?: SecretRedactor;
  /** Explicit opt-in for live network checks; inert by default. */
  readonly liveChecks?: boolean;
}

export interface HostCompositionToolReport {
  readonly name: string;
  readonly description?: string;
  readonly hasParameters: boolean;
}

export interface HostCompositionReport {
  readonly profile: "personal" | "business";
  readonly effectiveTools: readonly HostCompositionToolReport[];
  readonly credentialReferences: readonly string[];
  readonly ownership: {
    readonly tenantId?: string;
    readonly accountId?: string;
    readonly userId?: string;
  };
  readonly storage: {
    readonly kind: string;
    readonly durable: boolean;
  };
  readonly sandbox: {
    readonly workspaceRoot?: string;
    readonly roots: readonly string[];
    readonly isolated: boolean;
  };
  readonly governance: {
    readonly permission: boolean;
    readonly trust: boolean;
    readonly redactor: boolean;
    readonly validator: boolean;
    readonly modelRouting: boolean;
    readonly secure: boolean;
  };
  readonly readiness: {
    readonly ok: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
  };
}

function resolveAgentConfig(
  input: Agent | AgentConfig | SecureAgentOptions | Partial<AgentConfig> | undefined,
): AgentConfig | SecureAgentOptions | Partial<AgentConfig> | undefined {
  if (!input) return undefined;
  if ("config" in input && typeof input.config === "object" && input.config !== null) {
    return (input as Agent).config;
  }
  return input as AgentConfig | SecureAgentOptions | Partial<AgentConfig>;
}

function normalizeProfile(profile?: HostCompositionProfile): "personal" | "business" {
  if (!profile) return "personal";
  if (profile === "business" || profile === "business-worker" || profile === "multi-tenant-worker") {
    return "business";
  }
  return "personal";
}

function extractTools(toolsConfig: unknown): readonly ToolDefinition[] {
  if (!toolsConfig) return [];
  if (Array.isArray(toolsConfig)) return toolsConfig as readonly ToolDefinition[];
  if (typeof (toolsConfig as ToolRegistry).list === "function") {
    return (toolsConfig as ToolRegistry).list();
  }
  return [];
}

function sanitizeCredentialRefs(refs: readonly string[] = [], redactor?: SecretRedactor): readonly string[] {
  const sanitized: string[] = [];
  for (const ref of refs) {
    if (!ref || typeof ref !== "string") continue;
    const trimmed = ref.trim();
    if (!trimmed) continue;
    // Credential references must be identifier names (env vars or vault keys), never raw secrets.
    if (/^(?:sk-|ghp_|ey|Bearer\s+)/i.test(trimmed)) {
      sanitized.push("[REDACTED_SECRET_VALUE]");
      continue;
    }
    if (redactor && typeof redactor.redact === "function") {
      sanitized.push(redactor.redact(trimmed));
    } else {
      sanitized.push(trimmed);
    }
  }
  return Object.freeze(sanitized);
}

function isContainedPath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

function resolveStorage(store: unknown, checkpoints: unknown): { kind: string; durable: boolean } {
  const target = store ?? checkpoints;
  if (!target || typeof target !== "object") {
    return { kind: "none", durable: false };
  }

  const record = target as Record<string, unknown>;
  const constructorName = (target as { constructor?: { name?: string } }).constructor?.name ?? "";
  const declaredKind = typeof record.kind === "string" ? record.kind.toLowerCase() : "";

  // Explicit in-memory implementations are NEVER durable.
  if (
    constructorName.includes("Memory") ||
    declaredKind.includes("memory") ||
    record.durable === false ||
    record.durability === "ephemeral"
  ) {
    return { kind: declaredKind || "memory", durable: false };
  }

  // Postgres, SQLite, or explicitly durable stores
  if (
    record.durable === true ||
    record.durability === "durable" ||
    constructorName.includes("Postgres") ||
    constructorName.includes("Sqlite") ||
    declaredKind.includes("postgres") ||
    declaredKind.includes("sqlite")
  ) {
    return { kind: declaredKind || constructorName.toLowerCase() || "durable", durable: true };
  }

  // Any store with saveCheckpoint / appendEntry / queryEntries without explicit durable: true is in-memory
  if (
    typeof record.saveCheckpoint === "function" ||
    typeof record.appendEntry === "function" ||
    typeof record.queryEntries === "function" ||
    typeof record.append === "function"
  ) {
    return { kind: declaredKind || "memory", durable: false };
  }

  // Unknown store without explicit durable flag is treated as non-durable memory
  return { kind: declaredKind || "memory", durable: false };
}

/**
 * Inspects a host composition in an inert, bounded, and secret-redacting manner.
 * Performs zero network calls by default.
 */
export function inspectHostComposition(options: HostCompositionOptions): HostCompositionReport {
  const normalizedProfile = normalizeProfile(options.profile);
  const config = resolveAgentConfig(options.agent);
  const redactor = options.redactor ?? config?.redactor;

  // 1. Effective tools
  const rawTools = extractTools(config?.tools);
  const effectiveTools: HostCompositionToolReport[] = rawTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    hasParameters: Boolean(tool.parameters && Object.keys(tool.parameters).length > 0),
  }));

  // 2. Credential references (identifier references only, raw values redacted)
  const credRefs = sanitizeCredentialRefs(options.credentialRefs, redactor);

  // 3. Ownership
  const rawOwnership = config?.ownership;
  const ownership = {
    tenantId: typeof rawOwnership?.tenantId === "string" ? rawOwnership.tenantId.trim() : undefined,
    accountId: typeof rawOwnership?.accountId === "string" ? rawOwnership.accountId.trim() : undefined,
    userId: typeof rawOwnership?.userId === "string" ? rawOwnership.userId.trim() : undefined,
  };

  // 4. Storage durability
  const storage = resolveStorage(options.store, options.checkpoints ?? config?.runState?.checkpoints);

  // 5. Sandbox capabilities
  const workspaceRoot = options.workspaceRoot;
  const sandboxRoots = options.sandboxRoots ?? [];
  let isolated = true;
  if (workspaceRoot && sandboxRoots.length > 0) {
    for (const root of sandboxRoots) {
      if (!isContainedPath(workspaceRoot, root)) {
        isolated = false;
        break;
      }
    }
  }

  // 6. Governance coverage
  const hasValidator = Boolean(
    (config && "validator" in config && typeof (config as { validator?: unknown }).validator === "function") ||
      (config &&
        "toolArgumentValidator" in config &&
        typeof (config as { toolArgumentValidator?: { validate?: unknown } }).toolArgumentValidator?.validate === "function"),
  );
  const isSecure = Boolean((config as { secure?: boolean } | undefined)?.secure);
  const governance = {
    permission: Boolean(config?.permission && typeof config.permission.check === "function"),
    trust: Boolean(config?.trust && typeof config.trust.check === "function"),
    redactor: Boolean(redactor && typeof redactor.redact === "function"),
    validator: hasValidator,
    modelRouting: Boolean(options.governance?.modelRouter || (config as Record<string, unknown> | undefined)?.modelRouter),
    secure: isSecure,
  };

  // 7. Readiness analysis
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required redactor check
  if (!governance.redactor) {
    errors.push("Missing required secret redactor");
  }

  // Required provider or model configuration
  const hasProvider = Boolean(config?.provider);
  const hasModel = Boolean(config?.model);
  if (!hasProvider && !hasModel) {
    errors.push("Missing required provider or model configuration");
  }

  // Ownership presence
  const hasAnyOwner = Boolean(ownership.tenantId || ownership.userId || ownership.accountId);
  if (!hasAnyOwner) {
    errors.push("Ownership scope is required");
  }

  // Profile-specific readiness
  if (normalizedProfile === "personal") {
    if (!ownership.userId) {
      errors.push("Personal composition requires userId in ownership");
    }
    if (!isolated) {
      errors.push("Sandbox roots must be contained within workspaceRoot");
    }
  } else {
    // business composition
    if (!ownership.tenantId) {
      errors.push("Business worker requires non-empty tenantId in ownership");
    }

    // Verified identity verification
    const identity = config?.identity;
    if (identity) {
      if (!identity.principal?.id || !identity.tenantId) {
        errors.push("Business worker identity cannot be empty or fabricated");
      } else {
        try {
          assertIdentityActive(identity);
          if (rawOwnership) {
            assertIdentityMatchesOwnership(identity, rawOwnership);
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    }

    // Storage durability verification (memory-only persistence is NOT permitted in business readiness)
    if (!storage.durable) {
      errors.push("Business composition requires durable storage; in-memory storage is not permitted in production readiness");
    }

    // Sandbox isolation verification
    if (!isolated || (sandboxRoots.length > 0 && !workspaceRoot)) {
      errors.push("Mixed sandbox workspace detected; business worker requires strict workspace containment");
    }

    // Governance coverage
    if (options.governance?.supported === false) {
      errors.push("Unsupported governance configuration");
    }
    if (!governance.permission) {
      errors.push("Business composition requires a permission policy");
    }
    if (!governance.trust) {
      errors.push("Business composition requires a trust policy");
    }
  }

  return {
    profile: normalizedProfile,
    effectiveTools: Object.freeze(effectiveTools),
    credentialReferences: credRefs,
    ownership: Object.freeze(ownership),
    storage: Object.freeze(storage),
    sandbox: Object.freeze({
      ...(workspaceRoot ? { workspaceRoot } : {}),
      roots: Object.freeze([...sandboxRoots]),
      isolated,
    }),
    governance: Object.freeze(governance),
    readiness: Object.freeze({
      ok: errors.length === 0,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
    }),
  };
}

/**
 * Asserts that a host composition meets all readiness requirements for its profile.
 * Throws HostCompositionError on failure.
 */
export function assertHostCompositionReadiness(options: HostCompositionOptions): HostCompositionReport {
  const report = inspectHostComposition(options);
  if (!report.readiness.ok) {
    throw new HostCompositionError(report.readiness.errors.join("; "));
  }
  return report;
}
