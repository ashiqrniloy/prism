/**
 * Failure diagnostics for scripts/coverage-summary.mjs (plan 071 Task 15).
 *
 * A failing coverage child used to surface as a bare `no coverage data (suite
 * failed)` row: the child's output was captured and dropped, so the reason was
 * unrecoverable (observed once on @arnilo/prism-memory during plan 071 Task 9,
 * green again on the next run). These helpers keep a bounded tail of that output
 * and the row shape that records it, and they are deliberately side-effect free
 * so the formatter and the shape can be unit-tested without running the eleven
 * coverage children.
 *
 * Redaction lives in the caller (coverage-summary.mjs): the tail is scrubbed
 * there with the public `createSecretRedactor` helper before it is printed or
 * written, so this module stays dependency-free.
 */

/** Lines of child output kept as the failure diagnostic. */
export const TAIL_LINES = 40;
/** Hard cap on the recorded tail: one pathological line must not bloat the artifact. */
export const MAX_TAIL_CHARS = 8192;

/**
 * Last `lines` lines of a child's stdout+stderr, as a string. CRLF-safe (the
 * `\r` never survives), ANSI-safe (codes pass through untouched), "" for empty
 * input, and char-bounded so a single enormous line cannot grow the artifact.
 */
export function tailOf(output, lines = TAIL_LINES, maxChars = MAX_TAIL_CHARS) {
  const all = String(output ?? "").split(/\r?\n/);
  while (all.length && all.at(-1) === "") all.pop();
  const tail = all.slice(-lines).join("\n");
  return tail.length > maxChars ? `[…truncated]\n${tail.slice(-maxChars)}` : tail;
}

/**
 * The extra artifact fields a failed child adds to its row, and `{}` for a
 * passing one. The green row shape stays byte-identical (scripts/phase23-coverage
 * .test.mjs compares it run to run), and a row is only ever `status: "failed"`
 * here — threshold failures keep their existing `pass: false` + `belowThreshold`
 * shape, which already carries the reason.
 */
export function failureRow(run) {
  if (run.ok && run.lines !== undefined) return {};
  return { status: "failed", exitCode: run.exitCode ?? null, tail: run.tail ?? "" };
}
