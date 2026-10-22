export class EvalError extends Error {
  readonly code: string;

  constructor(message: string, code = "ERR_PRISM_EVAL", options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "EvalError";
    this.code = code;
  }
}

export class EvalScoreError extends EvalError {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, "ERR_PRISM_EVAL_SCORE", options);
    this.name = "EvalScoreError";
  }
}

export class EvalDatasetError extends EvalError {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, "ERR_PRISM_EVAL_DATASET", options);
    this.name = "EvalDatasetError";
  }
}
