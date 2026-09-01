import type { PonytailMode } from "./types.js";
import { MAX_INJECTED_INSTRUCTION_BYTES } from "./upstream.js";
import type { UpstreamPonytailInstructions } from "./upstream-hooks.js";

export function buildPonytailInstructions(api: UpstreamPonytailInstructions, mode: PonytailMode): string | undefined {
  if (mode === "off") return undefined;
  const text = api.getPonytailInstructions(mode);
  if (text.length > MAX_INJECTED_INSTRUCTION_BYTES) {
    return `${text.slice(0, MAX_INJECTED_INSTRUCTION_BYTES - 1)}…`;
  }
  return text;
}
