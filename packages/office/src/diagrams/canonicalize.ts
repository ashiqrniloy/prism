import { XMLParser } from "fast-xml-parser";
import { type DrawioXmlCaps, type ResolvedDrawioXmlCaps, resolveDiagramsCaps, validateByteCap } from "./caps.js";
import { DiagramsModelInvalidError, DiagramsXxeError } from "./errors.js";
import type { DiagramsTelemetry } from "./telemetry.js";
import { assertNotVisio, UNSAFE_XML_DECLARATION_PATTERN } from "./xml.js";

export interface DrawioCanonicalizeOptions {
  readonly caps?: DrawioXmlCaps;
  readonly telemetry?: DiagramsTelemetry;
}

/**
 * Produces byte-stable, canonicalized XML formatting for draw.io diagrams.
 *
 * Properties:
 * - Attributes on all elements are sorted lexicographically by name ascending.
 * - Double quotes are consistently used for attribute values.
 * - XML entities are escaped in attribute values and text nodes.
 * - Insignificant inter-tag and surrounding whitespace is stripped while element sequence is preserved.
 * - Empty elements are normalized to self-closing form (`<element attr="val"/>`).
 * - Deterministic output suitable for SHA-256 content hashing across systems.
 */
export function canonicalizeDrawioXml(xml: string | Uint8Array, options?: DrawioCanonicalizeOptions): string {
  const startTime = Date.now();
  const span = options?.telemetry?.startSpan("diagrams.canonicalize");

  try {
    assertNotVisio(xml);

    const caps: ResolvedDrawioXmlCaps = resolveDiagramsCaps(options?.caps);
    const xmlString = typeof xml === "string" ? xml : Buffer.from(xml).toString("utf8");
    const byteLength = Buffer.byteLength(xmlString, "utf8");

    validateByteCap(byteLength, caps);

    if (UNSAFE_XML_DECLARATION_PATTERN.test(xmlString)) {
      throw new DiagramsXxeError("XML contains forbidden DOCTYPE or ENTITY declaration (XXE security policy)");
    }

    const parser = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      allowBooleanAttributes: false,
      processEntities: false,
      htmlEntities: false,
      trimValues: false,
      stopNodes: [],
    });

    const parsed: unknown = parser.parse(xmlString);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new DiagramsModelInvalidError("Parsed XML does not produce an ordered element tree");
    }

    // Filter out top-level whitespace and XML processing instructions (?xml)
    const rootNodes = (parsed as OrderedNode[]).filter(
      (node) => !("#text" in node) && Object.keys(node).some((k) => !k.startsWith("?") && k !== ":@"),
    );

    if (rootNodes.length === 0) {
      throw new DiagramsModelInvalidError("No valid root XML element found");
    }

    const canonicalOutput = serializeNodes(rootNodes);

    span?.setAttribute("diagrams.inputBytes", byteLength);
    span?.setAttribute("diagrams.outputBytes", Buffer.byteLength(canonicalOutput, "utf8"));
    span?.setAttribute("diagrams.durationMs", Date.now() - startTime);

    return canonicalOutput;
  } catch (error) {
    span?.recordError();
    throw error;
  } finally {
    span?.end();
  }
}

type OrderedNode = Record<string, unknown>;

function serializeNodes(nodes: OrderedNode[]): string {
  let result = "";
  for (const node of nodes) {
    result += serializeNode(node);
  }
  return result;
}

function serializeNode(node: OrderedNode): string {
  if ("#text" in node) {
    const rawText = String(node["#text"]);
    return escapeXmlText(rawText);
  }

  // Find the element tag name (key that is not ":@" and does not start with "?")
  let tagName: string | undefined;
  for (const key of Object.keys(node)) {
    if (key !== ":@" && !key.startsWith("?")) {
      tagName = key;
      break;
    }
  }

  if (!tagName) {
    return "";
  }

  const rawAttrs = (node[":@"] ?? {}) as Record<string, unknown>;
  const sortedAttrs = Object.keys(rawAttrs)
    .map((k) => (k.startsWith("@_") ? k.slice(2) : k))
    .sort()
    .map((attrName) => {
      const originalKey = `@_${attrName}` in rawAttrs ? `@_${attrName}` : attrName;
      const val = rawAttrs[originalKey];
      return `${attrName}="${escapeXmlAttr(String(val ?? ""))}"`;
    });

  const attrString = sortedAttrs.length > 0 ? ` ${sortedAttrs.join(" ")}` : "";
  const children = node[tagName];

  if (!children || (Array.isArray(children) && children.length === 0)) {
    return `<${tagName}${attrString}/>`;
  }

  if (Array.isArray(children)) {
    // If element contains child elements, filter out insignificant whitespace-only text nodes
    const hasElementChildren = children.some((c) => !("#text" in c));
    const effectiveChildren = hasElementChildren
      ? children.filter((c) => !("#text" in c) || String(c["#text"]).trim().length > 0)
      : children;

    if (effectiveChildren.length === 0) {
      return `<${tagName}${attrString}/>`;
    }

    if (effectiveChildren.length === 1 && "#text" in effectiveChildren[0]!) {
      const textVal = String(effectiveChildren[0]!["#text"]).trim();
      if (textVal.length === 0) {
        return `<${tagName}${attrString}/>`;
      }
      return `<${tagName}${attrString}>${escapeXmlText(textVal)}</${tagName}>`;
    }

    const childrenString = serializeNodes(effectiveChildren as OrderedNode[]);
    return `<${tagName}${attrString}>${childrenString}</${tagName}>`;
  }

  if (typeof children === "string" || typeof children === "number" || typeof children === "boolean") {
    const textStr = String(children).trim();
    if (textStr.length === 0) {
      return `<${tagName}${attrString}/>`;
    }
    return `<${tagName}${attrString}>${escapeXmlText(textStr)}</${tagName}>`;
  }

  return `<${tagName}${attrString}/>`;
}

function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
