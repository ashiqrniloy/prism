export type EnterprisePostgresErrorCode =
  | "ERR_PRISM_ENTERPRISE_POSTGRES_CONFIG"
  | "ERR_PRISM_ENTERPRISE_POSTGRES_MIGRATION"
  | "ERR_PRISM_ENTERPRISE_POSTGRES_SCHEMA"
  | "ERR_PRISM_ENTERPRISE_POSTGRES_OWNERSHIP"
  | "ERR_PRISM_ENTERPRISE_POSTGRES_BOUNDS"
  | "ERR_PRISM_ENTERPRISE_POSTGRES_CONFLICT"
  | "ERR_PRISM_ENTERPRISE_POSTGRES_RETRYABLE";

/** Bounded public error for enterprise PostgreSQL configuration and persistence failures. */
export class EnterprisePostgresError extends Error {
  constructor(
    message: string,
    readonly code: EnterprisePostgresErrorCode,
  ) {
    super(message);
    this.name = "EnterprisePostgresError";
  }
}

export function asEnterprisePostgresError(error: unknown, code: EnterprisePostgresErrorCode, message: string): EnterprisePostgresError {
  return error instanceof EnterprisePostgresError ? error : new EnterprisePostgresError(message, code);
}
