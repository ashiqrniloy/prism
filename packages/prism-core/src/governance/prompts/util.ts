import { createHash } from "node:crypto";
import { PromptIntegrityError, PromptOwnershipError, PromptValidationError } from "./errors.js";
import { assertBytes, type PromptLimits } from "./limits.js";
import type { PromptOwnership, PromptRecord, PutPromptInput } from "./types.js";

export interface NormalizedOwnership {
  readonly tenantId: string;
  readonly accountId: string;
  readonly userId: string;
}

export function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

export function normalizeOwnership(input?: PromptOwnership, fallback?: PromptOwnership): NormalizedOwnership {
  const source = {
    tenantId: input?.tenantId ?? (fallback?.tenantId === "" ? undefined : fallback?.tenantId),
    accountId: input?.accountId ?? (fallback?.accountId === "" ? undefined : fallback?.accountId),
    userId: input?.userId ?? (fallback?.userId === "" ? undefined : fallback?.userId),
  };
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
      throw new PromptOwnershipError(`${key} must be a non-empty string`);
    }
  }
  return {
    tenantId: source.tenantId ?? "",
    accountId: source.accountId ?? "",
    userId: source.userId ?? "",
  };
}

export function scopeKey(scope: NormalizedOwnership, name: string): string {
  return JSON.stringify([scope.tenantId, scope.accountId, scope.userId, name]);
}

export function publicOwnership(scope: NormalizedOwnership): PromptOwnership {
  return {
    ...(scope.tenantId === "" ? {} : { tenantId: scope.tenantId }),
    ...(scope.accountId === "" ? {} : { accountId: scope.accountId }),
    ...(scope.userId === "" ? {} : { userId: scope.userId }),
  };
}

export function requireName(value: unknown, limits: PromptLimits): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new PromptValidationError("name must be non-empty");
  assertBytes(value, limits.maxNameBytes, "name");
  return value;
}

export function requireLabel(value: unknown, limits: PromptLimits): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new PromptValidationError("label must be non-empty");
  assertBytes(value, limits.maxLabelBytes, "label");
  return value;
}

export function requireVersion(value: unknown, label = "version"): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new PromptValidationError(`${label} must be a positive safe integer`);
  }
  return value as number;
}

export function preparePrompt(
  input: PutPromptInput,
  version: number,
  scope: NormalizedOwnership,
  limits: PromptLimits,
  now: () => number,
): PromptRecord {
  throwIfAborted(input.signal);
  const name = requireName(input.name, limits);
  if (typeof input.body !== "string" || input.body.length === 0) throw new PromptValidationError("body must be non-empty");
  assertBytes(input.body, limits.maxBodyBytes, "body");
  const labels = normalizeLabels(input.labels, limits);
  const metadata = normalizeMetadata(input.metadata, limits);
  const createdAt = input.createdAt ?? new Date(now()).toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw new PromptValidationError("createdAt must be an ISO timestamp");
  return freezeRecord({
    ...publicOwnership(scope),
    name,
    version: requireVersion(version),
    body: input.body,
    hash: hashPromptBody(input.body),
    labels,
    ...(metadata === undefined ? {} : { metadata }),
    createdAt,
  });
}

export function normalizeStoredPrompt(
  row: {
    readonly tenant_id?: unknown;
    readonly account_id?: unknown;
    readonly user_id?: unknown;
    readonly name?: unknown;
    readonly version?: unknown;
    readonly body?: unknown;
    readonly hash?: unknown;
    readonly labels?: unknown;
    readonly metadata?: unknown;
    readonly created_at?: unknown;
  },
  limits: PromptLimits,
): PromptRecord {
  const scope = normalizeOwnership({
    tenantId: row.tenant_id === undefined || row.tenant_id === null || row.tenant_id === "" ? undefined : String(row.tenant_id),
    accountId: row.account_id === undefined || row.account_id === null || row.account_id === "" ? undefined : String(row.account_id),
    userId: row.user_id === undefined || row.user_id === null || row.user_id === "" ? undefined : String(row.user_id),
  });
  const name = requireName(row.name, limits);
  const version = requireVersion(Number(row.version));
  if (typeof row.body !== "string" || row.body.length === 0) throw new PromptIntegrityError("stored prompt body is invalid");
  assertBytes(row.body, limits.maxBodyBytes, "stored body");
  const hash = String(row.hash ?? "");
  if (hash !== hashPromptBody(row.body)) throw new PromptIntegrityError(`stored prompt hash mismatch for ${name}@${version}`);
  const labels = parseLabels(row.labels, limits);
  const metadata = parseMetadata(row.metadata, limits);
  const createdAt = String(row.created_at ?? "");
  if (!Number.isFinite(Date.parse(createdAt))) throw new PromptIntegrityError("stored prompt timestamp is invalid");
  return freezeRecord({
    ...publicOwnership(scope),
    name,
    version,
    body: row.body,
    hash,
    labels,
    ...(metadata === undefined ? {} : { metadata }),
    createdAt,
  });
}

export function hashPromptBody(body: string): string {
  return `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`;
}

export function normalizeLabels(labels: readonly string[] | undefined, limits: PromptLimits): readonly string[] {
  if (labels === undefined) return Object.freeze([]);
  if (!Array.isArray(labels) || labels.length > limits.maxLabels) {
    throw new PromptValidationError(`labels must contain at most ${limits.maxLabels} entries`);
  }
  const output = labels.map((label) => requireLabel(label, limits));
  if (new Set(output).size !== output.length) throw new PromptValidationError("labels must be unique");
  return Object.freeze(output);
}

function parseLabels(value: unknown, limits: PromptLimits): readonly string[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new PromptIntegrityError("stored prompt labels are invalid");
    }
  }
  if (!Array.isArray(parsed)) throw new PromptIntegrityError("stored prompt labels are invalid");
  try {
    return normalizeLabels(parsed as string[], limits);
  } catch (error) {
    throw new PromptIntegrityError(`stored prompt labels are invalid: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function parseMetadata(value: unknown, limits: PromptLimits): Readonly<Record<string, unknown>> | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new PromptIntegrityError("stored prompt metadata is invalid");
    }
  }
  try {
    return normalizeMetadata(parsed as Readonly<Record<string, unknown>>, limits);
  } catch (error) {
    throw new PromptIntegrityError(`stored prompt metadata is invalid: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function normalizeMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  limits: PromptLimits,
): Readonly<Record<string, unknown>> | undefined {
  if (metadata === undefined) return undefined;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new PromptValidationError("metadata must be a JSON object");
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(metadata);
  } catch (error) {
    throw new PromptValidationError(`metadata must be JSON serializable: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  if (encoded === undefined) throw new PromptValidationError("metadata must be a JSON object");
  assertBytes(encoded, limits.maxMetadataBytes, "metadata");
  return deepFreeze(JSON.parse(encoded) as Readonly<Record<string, unknown>>);
}

function freezeRecord(record: PromptRecord): PromptRecord {
  return Object.freeze({ ...record, labels: Object.freeze([...record.labels]), ...(record.metadata ? { metadata: record.metadata } : {}) });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
