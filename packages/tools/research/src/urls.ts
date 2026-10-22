const MAX_URL_LENGTH = 2048;

/** Drop userinfo and named query parameters. Non-http(s) or over-long URLs are not stored. */
export function redactUrl(raw: string, redactQuery: readonly string[]): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  url.username = "";
  url.password = "";
  const drop = new Set(redactQuery.map((name) => name.toLowerCase()));
  for (const key of [...url.searchParams.keys()]) {
    if (drop.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.hash = "";
  const stored = url.toString();
  return stored.length > MAX_URL_LENGTH ? undefined : stored;
}
