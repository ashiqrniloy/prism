/** Model-presence failures of the loop/model contract (roadmap §2.12.9 K1). */
export type ModelErrorCode =
  /** `createAgent` got no `model`, and the loop slot's strategy does not declare `usesModel: false`. There is no default model or provider. */
  | "model_required"
  /** A provider turn ran on an agent created without a model. */
  | "no_model"
  /** The loop does not accept a per-run `RunOptions.model`. */
  | "run_model_unsupported"
  /** The loop declares a `runModel` mode other than `passthrough` or `none`. */
  | "invalid_run_model_mode";

export class ModelError extends Error {
  readonly code: ModelErrorCode;

  constructor(code: ModelErrorCode, message: string) {
    super(message);
    this.name = "ModelError";
    this.code = code;
  }
}
