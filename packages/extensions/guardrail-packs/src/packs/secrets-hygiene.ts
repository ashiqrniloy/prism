import { SECRET_PATTERN } from "../detectors/secrets.js";
import type { GuardrailPackDefinition } from "./types.js";

/** Canned secret hygiene: any tool argument carrying credential-shaped material is denied. */
export const secretsHygienePack: GuardrailPackDefinition = {
  id: "secrets-hygiene",
  version: 1,
  description: "Blocks tool calls whose arguments carry secret-shaped material (API keys, tokens, private keys).",
  build() {
    return {
      rules: [
        {
          id: "no-secret-material-in-arguments",
          pattern: SECRET_PATTERN,
          reason: "Tool arguments contain secret-shaped material",
        },
      ],
    };
  },
};
