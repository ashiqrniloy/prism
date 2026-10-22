/** Guardrail pack config/compile error (plan 092 Task 2). Config mistakes fail closed at compile time. */
export class GuardrailPackError extends Error {
  readonly code = "ERR_PRISM_GUARDRAIL_PACK";

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "GuardrailPackError";
  }
}
