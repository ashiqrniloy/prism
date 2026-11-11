import type { OwnershipScope } from "@arnilo/prism";

/** Ordered, present scope columns for dialect-local parameter binding; empty strings stay scoped. */
export function ownershipColumns(scope: OwnershipScope): [string, string][] {
  const columns: [string, string][] = [];
  if (scope.tenantId !== undefined) columns.push(["tenant_id", scope.tenantId]);
  if (scope.accountId !== undefined) columns.push(["account_id", scope.accountId]);
  if (scope.userId !== undefined) columns.push(["user_id", scope.userId]);
  return columns;
}
