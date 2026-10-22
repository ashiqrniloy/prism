import type { GuardrailPackDefinition } from "./types.js";

/**
 * Known credential shapes, all quantifier-bounded so a hostile argument string cannot blow up the regex.
 * Prism redaction matches exact known values only (plan 092 Task 1), so these patterns ship with the pack.
 */
const SECRET_PATTERN =
  /(?:sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.|xox[baprs]-[A-Za-z0-9-]{10,})/;

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
