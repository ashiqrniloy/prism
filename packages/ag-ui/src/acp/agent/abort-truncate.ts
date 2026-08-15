/** abort-truncate (0.2.5 plan 025 Task 1 split). Moved verbatim from agent.ts; public surface unchanged behind the barrel. */
export function abortOn(source: AbortSignal): AbortController {
  const controller = new AbortController();
  if (source.aborted) controller.abort(source.reason);
  else source.addEventListener("abort", () => controller.abort(source.reason), { once: true });
  return controller;
}

export function truncate(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let bytes = 0;
  let out = "";
  for (const char of value) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maxBytes - 3) break;
    bytes += size;
    out += char;
  }
  return `${out}…`;
}
