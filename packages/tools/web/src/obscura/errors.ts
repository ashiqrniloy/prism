export class ObscuraError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ObscuraError";
    this.code = code;
  }
}
