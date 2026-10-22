/** Model-presence failures of the loop/model contract (roadmap §2.12.9 K1). */
export type ModelErrorCode = "model_required" | "no_model" | "run_model_unsupported" | "invalid_run_model_mode";

export class ModelError extends Error {
  readonly code: ModelErrorCode;

  constructor(code: ModelErrorCode, message: string) {
    super(message);
    this.name = "ModelError";
    this.code = code;
  }
}
