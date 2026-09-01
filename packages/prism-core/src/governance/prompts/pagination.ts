import { PromptValidationError } from "./errors.js";
import type { PromptLimits } from "./limits.js";
import type { PromptListQuery } from "./types.js";
import type { NormalizedOwnership } from "./util.js";

interface PromptCursor {
  readonly tenantId: string;
  readonly accountId: string;
  readonly userId: string;
  readonly name?: string;
  readonly label?: string;
  readonly order: "asc" | "desc";
  readonly lastName: string;
  readonly lastVersion: number;
}

export function encodePromptCursor(
  scope: NormalizedOwnership,
  query: Pick<PromptListQuery, "name" | "label" | "order">,
  lastName: string,
  lastVersion: number,
): string {
  return Buffer.from(
    JSON.stringify({
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      userId: scope.userId,
      name: query.name,
      label: query.label,
      order: query.order === "desc" ? "desc" : "asc",
      lastName,
      lastVersion,
    }),
  ).toString("base64url");
}

export function decodePromptCursor(
  encoded: string | undefined,
  scope: NormalizedOwnership,
  query: Pick<PromptListQuery, "name" | "label" | "order">,
  limits: PromptLimits,
): PromptCursor | undefined {
  if (encoded === undefined) return undefined;
  if (typeof encoded !== "string" || encoded.length === 0 || Buffer.byteLength(encoded, "utf8") > limits.maxCursorBytes) {
    throw new PromptValidationError("cursor is invalid", "ERR_PRISM_PROMPT_CURSOR");
  }
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<PromptCursor>;
    const order = query.order === "desc" ? "desc" : "asc";
    if (
      value.tenantId !== scope.tenantId ||
      value.accountId !== scope.accountId ||
      value.userId !== scope.userId ||
      value.name !== query.name ||
      value.label !== query.label ||
      value.order !== order ||
      typeof value.lastName !== "string" ||
      !Number.isSafeInteger(value.lastVersion) ||
      (value.lastVersion as number) < 1
    ) {
      throw new Error("cursor query mismatch");
    }
    return value as PromptCursor;
  } catch {
    throw new PromptValidationError("cursor is invalid", "ERR_PRISM_PROMPT_CURSOR");
  }
}

export function comparePromptPosition(name: string, version: number, cursor: PromptCursor | undefined, order: "asc" | "desc"): number {
  if (!cursor) return 1;
  const byName = name.localeCompare(cursor.lastName);
  const result = byName || version - cursor.lastVersion;
  return order === "asc" ? result : -result;
}

export type { PromptCursor };
