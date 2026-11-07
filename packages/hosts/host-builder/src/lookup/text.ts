/** Lower-case word tokens of `text`, splitting camelCase, snake_case, kebab-case and punctuation. */
export function tokens(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

/** Levenshtein distance, capped: returns `cap + 1` as soon as the distance must exceed `cap`. */
function distance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > cap) return cap + 1;
    previous = row;
  }
  return previous[b.length] ?? cap + 1;
}

/**
 * The `limit` names closest to `target`: a substring either way ranks first, then small edit distance.
 * Pure and deterministic; ties keep input order.
 */
export function nearest(names: Iterable<string>, target: string, limit = 5): string[] {
  const wanted = target.toLowerCase();
  const scored: Array<{ name: string; score: number; order: number }> = [];
  const seen = new Set<string>();
  let order = 0;
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const lower = name.toLowerCase();
    let score: number;
    if (lower === wanted) score = 0;
    else if (lower.includes(wanted) || (lower.length >= 4 && wanted.includes(lower))) score = 1;
    else {
      const cap = Math.max(2, Math.floor(wanted.length / 3));
      const d = distance(lower, wanted, cap);
      if (d > cap) {
        order++;
        continue;
      }
      score = 1 + d;
    }
    scored.push({ name, score, order: order++ });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.name);
}
