export class DocumentReaderError extends Error {
  readonly code = "ERR_PRISM_DOCUMENT_READER";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocumentReaderError";
  }
}
