export class PolicyError extends Error {
  readonly code: string;
  constructor(message: string, code = "ERR_PRISM_POLICY") {
    super(message);
    this.name = "PolicyError";
    this.code = code;
  }
}
