import type { GuardrailRule } from "../contracts.js";
import { PII_DETECTOR_IDS } from "../detectors/index.js";
import { assertKnownOptions, CONTENT_STAGES, readContentAction, readSubset } from "./options.js";
import type { GuardrailPackDefinition } from "./types.js";

const PACK = "pii";

/**
 * Personal data in content: email, phone, payment card (Luhn-checked), and national-id shapes. One rule
 * per detector and stage (`<detector>-<stage>`), so a record names what fired and where.
 * Options: `detectors` (default all), `stages` (default `output` and `tool_result`), `action` (default `redact`).
 */
export const piiPack: GuardrailPackDefinition = {
  id: PACK,
  version: 1,
  description: "Redacts (or flags, or denies) email addresses, phone numbers, payment cards, and national ids in content.",
  build(options) {
    assertKnownOptions(PACK, options, ["detectors", "stages", "action"]);
    const detectors = readSubset(PACK, "detectors", options.detectors, PII_DETECTOR_IDS, PII_DETECTOR_IDS);
    const stages = readSubset(PACK, "stages", options.stages, CONTENT_STAGES, ["output", "tool_result"]);
    const action = readContentAction(PACK, options.action, "redact");
    const rules: GuardrailRule[] = [];
    for (const stage of stages) {
      for (const detector of detectors) {
        rules.push({ id: `${detector}-${stage}`, stage, detector, action, reason: `Content carries personal data (${detector})` });
      }
    }
    return { rules };
  },
};
