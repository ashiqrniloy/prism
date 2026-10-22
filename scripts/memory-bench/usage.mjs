/** Shared wire-usage checks for the public and lifecycle harnesses (plan 188.7 Task 2). */
export function missingUsageCount(rows) {
  return rows.filter((row) => row.status >= 200 && row.status < 300 && !row.rawUsage?.input_tokens && !row.rawUsage?.prompt_tokens).length;
}

export function sumUsage(rows) {
  return {
    inputTokens: rows.reduce((n, row) => n + (row.inputTokens ?? 0), 0),
    cacheReadTokens: rows.reduce((n, row) => n + (row.cacheReadTokens ?? 0), 0),
    outputTokens: rows.reduce((n, row) => n + (row.outputTokens ?? 0), 0),
  };
}
