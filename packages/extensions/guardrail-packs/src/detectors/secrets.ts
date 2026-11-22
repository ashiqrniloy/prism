/**
 * Known credential shapes, shared by `secrets-hygiene` (tool arguments) and `output-secrets` (model
 * output). Every quantifier is bounded, so a hostile string cannot blow up the regex. Prism redaction
 * matches exact known values only (plan 092 Task 1), so these shapes ship with the packs.
 */
export const SECRET_PATTERN =
  /(?:sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.|xox[baprs]-[A-Za-z0-9-]{10,})/;
