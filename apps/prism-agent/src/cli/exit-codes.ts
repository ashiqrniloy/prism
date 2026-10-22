export type TerminalStatus = "completed" | "stopped" | "failed" | "suspended";

export type CitationVerdict = "passed" | "failed" | "pending";

/**
 * Precedence 2 > 3 > 1 > 4 > 0. Code 2 is a usage or config failure before this table.
 * A dropped continuation leaves the citation verdict `pending`, which is not code 4.
 */
export function exitCode(terminal: TerminalStatus | undefined, verify?: CitationVerdict): number {
  if (terminal === "suspended") return 3;
  if (terminal === "failed" || terminal === undefined) return 1;
  if (verify === "failed") return 4;
  return 0;
}

export function verdictOf(value: unknown): CitationVerdict | undefined {
  if (typeof value !== "object" || value === null || !("verdict" in value)) return undefined;
  const verdict = value.verdict;
  if (verdict === "passed" || verdict === "failed" || verdict === "pending") return verdict;
  return undefined;
}
