/**
 * A devtools failure with a stable code. `status` is the HTTP status a route answers with; construction
 * errors (a non-loopback bind without a token, a literal token) never reach a response.
 */
export class DevtoolsError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "ERR_PRISM_DEVTOOLS", status = 400) {
    super(message);
    this.name = "DevtoolsError";
    this.code = code;
    this.status = status;
  }
}
