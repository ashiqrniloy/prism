import { assertKnownOptions, CONTENT_STAGES, readContentAction, readSubset } from "./options.js";
import type { GuardrailPackDefinition } from "./types.js";

const PACK = "output-secrets";

/**
 * The `secrets-hygiene` shapes applied to content. Options: `stages` (default `output`) and `action`
 * (default `redact`).
 */
export const outputSecretsPack: GuardrailPackDefinition = {
  id: PACK,
  version: 1,
  description: "Redacts (or flags, or denies) secret-shaped material (API keys, tokens, private keys) in model output.",
  build(options) {
    assertKnownOptions(PACK, options, ["stages", "action"]);
    const stages = readSubset(PACK, "stages", options.stages, CONTENT_STAGES, ["output"]);
    const action = readContentAction(PACK, options.action, "redact");
    return {
      rules: stages.map((stage) => ({
        id: stage === "output" ? "no-secret-material-in-output" : `no-secret-material-in-${stage.replace("_", "-")}`,
        stage,
        detector: "secret",
        action,
        reason: "Content carries secret-shaped material",
      })),
    };
  },
};
