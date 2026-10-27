/**
 * Trims trailing "/" characters with a linear index scan.
 *
 * Shared replacement for `value.replace(/\/+$/, "")` (CodeQL js/polynomial-redos):
 * no regex is evaluated, so hostile long inputs cannot backtrack. Semantics are
 * identical — only trailing "/" characters (U+002F) are removed; "" and "/" stay "".
 */
export declare function trimTrailingSlashes(value: string): string;
