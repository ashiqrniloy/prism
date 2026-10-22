import { MemoryLimitError, MemoryScopeError, MemoryValidationError } from "./errors.js";
import type { RagAccessConstraint, SourceAccessGrant } from "./types.js";
import { requireNonEmptyString } from "./util.js";

/** Bounded group list on one query/grant. */
export const HARD_ACL_GROUP_CAP = 32;
/** One `setSourceAccess` call. */
export const HARD_ACL_GRANT_BATCH_CAP = 1_024;
const ID_MAX = 256;

function requireId(value: unknown, label: string): string {
  const id = requireNonEmptyString(value, label);
  if (id.length > ID_MAX) throw new MemoryValidationError(`${label} exceeds ${ID_MAX} characters`);
  if (id.includes("\0")) throw new MemoryValidationError(`${label} must not contain NUL`);
  return id;
}

function uniqueIds(values: readonly string[] | undefined, label: string, cap: number): readonly string[] {
  const raw = values ?? [];
  if (raw.length > cap) throw new MemoryLimitError(`${label} exceeds hard cap ${cap}`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const id = requireId(value, label === "groupIds" ? "groupId" : "principalId");
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return Object.freeze(out);
}

function requireAccessVersion(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new MemoryValidationError("accessVersion must be an integer >= 1");
  }
  return value as number;
}

/** Normalize a host-verified retrieve/query constraint. Deny-by-default: empty groups are fine. */
export function assertAccessConstraint(authorization: RagAccessConstraint): RagAccessConstraint {
  const principalId = requireId(authorization.principalId, "principalId");
  const tenantId = requireId(authorization.tenantId, "tenantId");
  const groupIds = uniqueIds(authorization.groupIds as readonly string[] | undefined, "groupIds", HARD_ACL_GROUP_CAP);
  const accessVersion = authorization.accessVersion === undefined ? undefined : requireAccessVersion(authorization.accessVersion);
  return Object.freeze({
    principalId,
    tenantId,
    groupIds,
    ...(accessVersion !== undefined ? { accessVersion } : {}),
  });
}

/** Replace-set of per-source grants; duplicate sourceIds fail closed. */
export function assertAccessGrants(grants: readonly SourceAccessGrant[]): readonly SourceAccessGrant[] {
  if (grants.length > HARD_ACL_GRANT_BATCH_CAP) throw new MemoryLimitError(`grants exceeds hard cap ${HARD_ACL_GRANT_BATCH_CAP}`);
  const seen = new Set<string>();
  const out: SourceAccessGrant[] = [];
  for (const grant of grants) {
    const sourceId = requireId(grant.sourceId, "sourceId");
    if (seen.has(sourceId)) throw new MemoryValidationError("duplicate sourceId in setSourceAccess");
    seen.add(sourceId);
    out.push(
      Object.freeze({
        sourceId,
        principalIds: uniqueIds(grant.principalIds as readonly string[] | undefined, "principalIds", HARD_ACL_GRANT_BATCH_CAP),
        groupIds: uniqueIds(grant.groupIds as readonly string[] | undefined, "groupIds", HARD_ACL_GROUP_CAP),
        accessVersion: requireAccessVersion(grant.accessVersion),
      }),
    );
  }
  return out;
}

export function grantAllows(
  grant: { readonly principalIds: readonly string[]; readonly groupIds: readonly string[]; readonly accessVersion: number },
  authorization: RagAccessConstraint,
): boolean {
  if (authorization.accessVersion !== undefined && grant.accessVersion !== authorization.accessVersion) return false;
  if (grant.principalIds.includes(authorization.principalId)) return true;
  for (const groupId of authorization.groupIds ?? []) if (grant.groupIds.includes(groupId)) return true;
  return false;
}

export function sourceIdFromRecord(record: { readonly metadata?: { readonly _rag?: unknown } }): string | undefined {
  const rag = record.metadata?._rag;
  if (typeof rag !== "object" || rag === null || Array.isArray(rag)) return undefined;
  const sourceId = (rag as { sourceId?: unknown }).sourceId;
  return typeof sourceId === "string" && sourceId.length > 0 ? sourceId : undefined;
}

export function assertAuthorizationTenant(authorization: RagAccessConstraint, tenantId: string): void {
  if (authorization.tenantId !== tenantId) throw new MemoryScopeError("authorization tenantId does not match query scope");
}
