import { INJECTION_DETECTOR_IDS } from "../detectors/index.js";
import { GuardrailPackError } from "./errors.js";
import { assertKnownOptions, readContentAction, readSubset } from "./options.js";
import type { GuardrailPackDefinition } from "./types.js";

const PACK = "injection-markers";
const MAX_TOOLS = 16;

function readTools(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TOOLS) {
    throw new GuardrailPackError(`${PACK} options.tools must be a non-empty array of at most ${MAX_TOOLS} tool names`);
  }
  return value.map((name) => {
    if (typeof name !== "string" || !name.trim()) throw new GuardrailPackError(`${PACK} options.tools entries must be non-empty strings`);
    return name;
  });
}

/**
 * Prompt-injection markers in tool results marked `untrusted_external`: instruction-override phrasing,
 * role spoofing, and exfiltration links. Options: `detectors` (default all), `action` (default `flag`),
 * and `tools` (tools scanned whatever their trust marking, for example MCP tools, which are not marked).
 */
export const injectionMarkersPack: GuardrailPackDefinition = {
  id: PACK,
  version: 1,
  description: "Flags (or redacts, or denies) prompt-injection markers in untrusted tool results.",
  build(options) {
    assertKnownOptions(PACK, options, ["detectors", "action", "tools"]);
    const detectors = readSubset(PACK, "detectors", options.detectors, INJECTION_DETECTOR_IDS, INJECTION_DETECTOR_IDS);
    const action = readContentAction(PACK, options.action, "flag");
    const tools = readTools(options.tools);
    return {
      rules: detectors.map((detector) => ({
        id: detector,
        stage: "tool_result" as const,
        detector,
        action,
        untrustedOnly: true,
        ...(tools ? { alsoScanTools: tools } : {}),
        reason: `Untrusted tool result carries a prompt-injection marker (${detector})`,
      })),
    };
  },
};
