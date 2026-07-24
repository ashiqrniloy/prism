export class WorkToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkToolError";
    this.code = code;
  }
}
