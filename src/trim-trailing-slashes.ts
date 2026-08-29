/**
 * Trims trailing "/" characters with a linear index scan.
 *
 * Shared replacement for `value.replace(/\/+$/, "")` (CodeQL js/polynomial-redos):
 * no regex is evaluated, so hostile long inputs cannot backtrack. Semantics are
 * identical — only trailing "/" characters (U+002F) are removed; "" and "/" stay "".
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}
