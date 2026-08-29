export class ObscuraError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ObscuraError";
    this.code = code;
  }
}
