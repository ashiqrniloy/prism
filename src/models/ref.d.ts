import type { ModelRef, ModelSpec, ResolvedRunOptions, RunOptions } from "../contracts.js";
export type ModelRefErrorCode = "model_ref_invalid";
/** A `ModelRef` that cannot name a provider and a model. The message never carries a credential value. */
export declare class ModelRefError extends TypeError {
    readonly code: ModelRefErrorCode;
    constructor(message: string);
}
/**
 * `"provider/model"` splits on the first `/`, so a model id may itself contain slashes
 * (`gateway/vendor/model-name`). An object keeps every field it carries. Fails closed as
 * `ModelRefError` on an empty or non-string part, and on a `credential` that is not an `env:` /
 * `keyring:` ref; the error text never includes the offending credential.
 */
export declare function parseModelRef(ref: ModelRef): ModelSpec;
/** Parse `RunOptions.model` once at the run's edge; every reader inside the run sees a `ModelSpec`. */
export declare function resolveRunOptions<T extends RunOptions>(options: T): Omit<T, "model"> & ResolvedRunOptions;
