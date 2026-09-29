/** Terminal output is untrusted. Keep readable text, never pass control instructions to OpenTUI. */
export function sanitizeTerminalText(text: string): string {
  return text
    .replace(
      /\x1b\][\s\S]*?(?:\x07|\x1b\\|$)|\u009d[\s\S]*?(?:\x07|\u009c|$)|\x1b[PX^_][\s\S]*?(?:\x1b\\|$)|\x1b\[[0-?]*[ -/]*[@-~]?|\u009b[0-?]*[ -/]*[@-~]?|\x1b[\s\S]?/g,
      "",
    )
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}
