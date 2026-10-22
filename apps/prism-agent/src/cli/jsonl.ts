/** One kernel event, unchanged, plus a newline. The caller writes it immediately. */
export function jsonlLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export interface LineIO {
  write(line: string): void;
  writeError(text: string): void;
}

export function writeEvent(io: LineIO, value: unknown): void {
  io.write(jsonlLine(value));
}

export function exitLine(code: number): { readonly type: "prism-agent.exit"; readonly code: number } {
  return { type: "prism-agent.exit", code };
}
