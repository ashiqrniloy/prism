/**
 * Parses an ATX Markdown heading (`# Title` .. `###### Title`) without regex
 * backtracking over `\s+(.+)$` (CodeQL js/polynomial-redos): a level-1..6 run of
 * `#` followed by whitespace and non-empty text.
 */
export function parseMarkdownHeading(line: string): { level: number; text: string } | undefined {
  let level = 0;
  while (level < line.length && line[level] === "#") level += 1;
  if (level === 0 || level > 6) return undefined;
  if (line[level] !== " " && line[level] !== "\t") return undefined;
  const text = line.slice(level).trim();
  return text === "" ? undefined : { level, text };
}
