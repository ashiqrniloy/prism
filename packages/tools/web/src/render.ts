/** A snippet is capped so ten results stay readable; the full text stays in `value`. */
export const SEARCH_SNIPPET_CHARS = 300;
/** At most this many provider highlights per result, each this long. */
export const SEARCH_HIGHLIGHTS_PER_RESULT = 2;
export const SEARCH_HIGHLIGHT_CHARS = 200;
/** One scraped row's rendered data, so a batch cannot dominate the prompt. */
const SCRAPE_ROW_CHARS = 1_000;

/**
 * Model-facing text for search results: a numbered list that costs far fewer tokens than the JSON
 * `value` and is easier to act on. Never interpreted — a title or snippet is collapsed to one line
 * so it can never start a new numbered entry, and no link is synthesized from snippet text.
 */
export function renderSearchResults(value: unknown): string {
  const rows = record(value)?.results;
  if (!Array.isArray(rows) || rows.length === 0) return "No results.";
  const lines: string[] = [];
  let index = 0;
  for (const row of rows) {
    const result = record(row);
    const url = singleLine(result?.url);
    if (result === undefined || url === undefined) continue;
    index += 1;
    const title = singleLine(result.title);
    lines.push(title === undefined ? `${index}. ${url}` : `${index}. ${title}\n   ${url}`);
    const published = singleLine(result.publishedAt);
    const snippet = singleLine(result.snippet);
    const summary = [published, snippet === undefined ? undefined : clip(snippet, SEARCH_SNIPPET_CHARS)].filter(Boolean).join(" — ");
    if (summary) lines.push(`   ${summary}`);
    const highlights = Array.isArray(result.highlights) ? result.highlights : [];
    for (const highlight of highlights.slice(0, SEARCH_HIGHLIGHTS_PER_RESULT)) {
      const line = singleLine(highlight);
      if (line !== undefined) lines.push(`   · ${clip(line, SEARCH_HIGHLIGHT_CHARS)}`);
    }
  }
  return lines.length === 0 ? "No results." : lines.join("\n");
}

/** Model-facing text for a batch scrape: one numbered entry per URL with its row as JSON text. */
export function renderScrapeResults(value: unknown): string {
  const rows = record(value)?.results;
  if (!Array.isArray(rows) || rows.length === 0) return "No results.";
  const lines: string[] = [];
  let index = 0;
  for (const row of rows) {
    const entry = record(row);
    const url = singleLine(entry?.url);
    if (entry === undefined || url === undefined) continue;
    index += 1;
    lines.push(`${index}. ${url}`);
    const body = entry.error === undefined ? JSON.stringify(entry.data ?? null) : `error: ${singleLine(entry.error) ?? "unknown"}`;
    lines.push(`   ${clip(singleLine(body) ?? body, SCRAPE_ROW_CHARS)}`);
  }
  return lines.length === 0 ? "No results." : lines.join("\n");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
/** Collapse every run of whitespace: untrusted text must not be able to fake a line or a result. */
function singleLine(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const line = value.replace(/\s+/gu, " ").trim();
  return line === "" ? undefined : line;
}
/** Code-point-safe truncation to at most `maxChars`, ellipsis included; never splits a surrogate pair. */
function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const limit = maxChars - 1;
  const end = isHighSurrogate(text.charCodeAt(limit - 1)) ? limit - 1 : limit;
  return `${text.slice(0, end).trimEnd()}…`;
}
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
