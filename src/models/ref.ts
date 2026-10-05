import type { ModelRef, ModelSpec, ResolvedRunOptions, RunOptions } from "../contracts.js";
import { SECRET_REF } from "../packages/schema.js";

export type ModelRefErrorCode = "model_ref_invalid";

/** A `ModelRef` that cannot name a provider and a model. The message never carries a credential value. */
export class ModelRefError extends TypeError {
  readonly code: ModelRefErrorCode = "model_ref_invalid";
  constructor(message: string) {
    super(message);
    this.name = "ModelRefError";
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * `"provider/model"` splits on the first `/`, so a model id may itself contain slashes
 * (`gateway/vendor/model-name`). An object keeps every field it carries. Fails closed as
 * `ModelRefError` on an empty or non-string part, and on a `credential` that is not an `env:` /
 * `keyring:` ref; the error text never includes the offending credential.
 */
export function parseModelRef(ref: ModelRef): ModelSpec {
  if (typeof ref === "string") {
    const slash = ref.indexOf("/");
    const provider = slash < 0 ? "" : ref.slice(0, slash);
    const model = slash < 0 ? "" : ref.slice(slash + 1);
    if (!nonEmpty(provider) || !nonEmpty(model)) throw new ModelRefError('A model reference string must be "provider/model"');
    return { provider, model };
  }
  if (typeof ref !== "object" || ref === null) throw new ModelRefError("A model reference must be a string or a model object");
  if (!nonEmpty(ref.provider)) throw new ModelRefError("A model reference needs a non-empty string provider");
  if (!nonEmpty(ref.model)) throw new ModelRefError("A model reference needs a non-empty string model");
  if (ref.baseUrl !== undefined && !nonEmpty(ref.baseUrl)) throw new ModelRefError("A model reference baseUrl must be a non-empty string");
  if (ref.credential !== undefined && (typeof ref.credential !== "string" || !SECRET_REF.test(ref.credential))) {
    throw new ModelRefError("A model reference credential must be an env:NAME or keyring:name reference, never a literal secret");
  }
  return ref;
}

/** Parse `RunOptions.model` once at the run's edge; every reader inside the run sees a `ModelSpec`. */
export function resolveRunOptions<T extends RunOptions>(options: T): Omit<T, "model"> & ResolvedRunOptions {
  return (options.model === undefined ? options : { ...options, model: parseModelRef(options.model) }) as Omit<T, "model"> &
    ResolvedRunOptions;
}
