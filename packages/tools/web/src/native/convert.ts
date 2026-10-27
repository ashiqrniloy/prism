/**
 * HTML-to-Markdown conversion for the native fetch backend.
 *
 * `linkedom`, `@mozilla/readability`, and `turndown` are imported on the first conversion only: a
 * host that reads JSON or never fetches pays nothing for them. Readability keeps the article body
 * (navigation, footers, and sidebars are dropped); when it finds nothing the whole `<body>` is
 * converted. Relative links become absolute against the page URL, and a link whose scheme is not
 * http(s) loses its attribute rather than becoming a `javascript:` Markdown link.
 *
 * Scripts never run: linkedom does not execute them and the converter removes their elements.
 */
const CHARSET_IN_TYPE = /charset\s*=\s*["']?([\w.:-]+)/iu;
const CHARSET_IN_META = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/iu;
/** A charset declaration lives in the head; scanning further would decode binary as text. */
const META_SCAN_BYTES = 1024;

export interface HtmlConversion {
  readonly markdown: string;
  readonly title?: string;
}

/** The header charset, else `<meta charset>` from the first 1 KiB, else UTF-8. Invalid bytes are replaced. */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const declared = CHARSET_IN_TYPE.exec(contentType ?? "")?.[1] ?? metaCharset(bytes) ?? "utf-8";
  try {
    return new TextDecoder(declared, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

/** Article HTML to Markdown, loaded lazily. `sourceUrl` resolves relative links in the output. */
export async function convertHtml(html: string, sourceUrl: string): Promise<HtmlConversion> {
  const [{ parseHTML }, { Readability }, { default: TurndownService }] = await Promise.all([
    import("linkedom"),
    import("@mozilla/readability"),
    import("turndown"),
  ]);
  const { document } = parseHTML(html);
  const article = new Readability(document as unknown as Document, { charThreshold: 0 }).parse();
  const content = article?.content ?? document.body?.innerHTML;
  if (content === undefined || content === "") return { markdown: "" };
  const { document: contentDocument } = parseHTML(content);
  absolutize(contentDocument, sourceUrl);
  const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  turndown.remove(["script", "style", "noscript", "iframe", "object", "embed", "form"]);
  // A content fragment parses outside `<body>`, so convert the root element rather than the body.
  const markdown = turndown.turndown((contentDocument.documentElement ?? content) as unknown as HTMLElement).trim();
  const title = article?.title ?? document.title;
  return { markdown, ...(title ? { title } : {}) };
}

function metaCharset(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, META_SCAN_BYTES));
  return CHARSET_IN_META.exec(head)?.[1];
}

interface AttributeElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** Links and images only: absolute http(s) or a drop. `#fragment` targets are page-local and kept. */
function absolutize(document: { querySelectorAll(selector: string): ArrayLike<AttributeElement> }, base: string): void {
  for (const [selector, attribute] of [
    ["a[href]", "href"],
    ["img[src]", "src"],
  ] as const) {
    const elements = document.querySelectorAll(selector);
    for (let index = 0; index < elements.length; index++) {
      const element = elements[index]!;
      const raw = element.getAttribute(attribute);
      if (raw === null || raw.startsWith("#")) continue;
      try {
        const absolute = new URL(raw, base);
        if (absolute.protocol !== "http:" && absolute.protocol !== "https:") element.removeAttribute(attribute);
        else element.setAttribute(attribute, absolute.toString());
      } catch {
        element.removeAttribute(attribute);
      }
    }
  }
}
