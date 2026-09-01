import { XMLParser, XMLValidator } from "fast-xml-parser";
import { type DrawioXmlCaps, type ResolvedDrawioXmlCaps, resolveDiagramsCaps, validateByteCap } from "./caps.js";
import { DiagramsCapError, DiagramsFormatError, DiagramsModelInvalidError, DiagramsXmlMalformedError, DiagramsXxeError } from "./errors.js";
import type { DiagramsTelemetry } from "./telemetry.js";

export const UNSAFE_XML_DECLARATION_PATTERN = /<!\s*(?:DOCTYPE|ENTITY)/i;

const VISIO_OLE_SIGNATURE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export interface DrawioXmlOptions {
  readonly caps?: DrawioXmlCaps;
  readonly telemetry?: DiagramsTelemetry;
}

export interface DrawioModelSummary {
  readonly pages: number;
  readonly cells: number;
  readonly edges: number;
  readonly width?: number;
  readonly height?: number;
  readonly compressed?: boolean;
}

/**
 * Asserts that the input is not a Microsoft Visio (.vsd / .vsdx) binary or XML file.
 * Throws {@link DiagramsFormatError} if Visio indicators are detected (P12 guard).
 */
export function assertNotVisio(input: string | Uint8Array): void {
  if (input instanceof Uint8Array) {
    if (input.length >= 8) {
      let isOle = true;
      for (let i = 0; i < 8; i++) {
        if (input[i] !== VISIO_OLE_SIGNATURE[i]) {
          isOle = false;
          break;
        }
      }
      if (isOle) {
        throw new DiagramsFormatError("Visio binary format (.vsd) is excluded and unsupported in @arnilo/prism-office/diagrams (P12)");
      }
    }
    // Check for ZIP container containing Visio markers (.vsdx)
    if (input.length >= 4 && input[0] === 0x50 && input[1] === 0x4b && input[2] === 0x03 && input[3] === 0x04) {
      const headerSample = Buffer.from(input.subarray(0, Math.min(input.length, 4096))).toString("utf8");
      if (headerSample.includes("visio/") || headerSample.includes("Visio") || headerSample.includes("drawing.xml")) {
        throw new DiagramsFormatError("Visio OpenXML format (.vsdx) is excluded and unsupported in @arnilo/prism-office/diagrams (P12)");
      }
    }
  }

  const text = typeof input === "string" ? input : Buffer.from(input).toString("utf8");
  if (
    text.includes("http://schemas.microsoft.com/office/visio") ||
    text.includes("http://schemas.microsoft.com/visio") ||
    text.includes("<VisioDocument") ||
    text.includes("Visio.Drawing") ||
    text.includes("application/vnd.ms-visio")
  ) {
    throw new DiagramsFormatError("Visio format (.vsd/.vsdx) is excluded and unsupported in @arnilo/prism-office/diagrams (P12)");
  }
}

/**
 * Validates draw.io / diagrams.net mxGraph XML for well-formedness, caps, and required element structure.
 *
 * Security guarantees:
 * - DOCTYPE and ENTITY declarations are rejected up-front (XXE defense).
 * - Parser entity processing is disabled.
 * - Caps on bytes, total elements, and total attributes are strictly enforced.
 * - Visio (.vsd/.vsdx) inputs are rejected (P12).
 */
export function validateDrawioXml(xml: string | Uint8Array, options?: DrawioXmlOptions): DrawioModelSummary {
  const startTime = Date.now();
  const span = options?.telemetry?.startSpan("diagrams.validate");

  try {
    assertNotVisio(xml);

    const caps: ResolvedDrawioXmlCaps = resolveDiagramsCaps(options?.caps);
    const xmlString = typeof xml === "string" ? xml : Buffer.from(xml).toString("utf8");
    const byteLength = Buffer.byteLength(xmlString, "utf8");

    validateByteCap(byteLength, caps);

    // Up-front DOCTYPE/ENTITY rejection (XXE & Billion Laughs prevention)
    if (UNSAFE_XML_DECLARATION_PATTERN.test(xmlString)) {
      throw new DiagramsXxeError("XML contains forbidden DOCTYPE or ENTITY declaration (XXE security policy)");
    }

    // Well-formedness check
    const validationResult = XMLValidator.validate(xmlString, {
      allowBooleanAttributes: false,
    });
    if (validationResult !== true) {
      throw new DiagramsXmlMalformedError(
        `Malformed XML: ${validationResult.err.msg} (line ${validationResult.err.line}, col ${validationResult.err.col})`,
      );
    }

    // Parse XML tree
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      allowBooleanAttributes: false,
      processEntities: false,
      htmlEntities: false,
      stopNodes: [],
    });

    const parsed: unknown = parser.parse(xmlString);
    if (!parsed || typeof parsed !== "object") {
      throw new DiagramsModelInvalidError("Parsed XML does not produce an object model");
    }

    // Enforce element and attribute caps
    const counts = { elements: 0, attributes: 0 };
    countTree(parsed, counts, caps);

    const summary = extractModelSummary(parsed as Record<string, unknown>);

    span?.setAttribute("diagrams.bytes", byteLength);
    span?.setAttribute("diagrams.pages", summary.pages);
    span?.setAttribute("diagrams.cells", summary.cells);
    span?.setAttribute("diagrams.edges", summary.edges);
    span?.setAttribute("diagrams.durationMs", Date.now() - startTime);

    return summary;
  } catch (error) {
    span?.recordError();
    throw error;
  } finally {
    span?.end();
  }
}

function countTree(node: unknown, counts: { elements: number; attributes: number }, caps: ResolvedDrawioXmlCaps): void {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) {
      countTree(item, counts, caps);
    }
    return;
  }

  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith("@_")) {
      counts.attributes++;
      if (counts.attributes > caps.maxAttributes) {
        throw new DiagramsCapError(`XML total attributes count exceeds maxAttributes cap (${caps.maxAttributes})`);
      }
    } else if (key !== "#text" && key !== ":@") {
      counts.elements++;
      if (counts.elements > caps.maxElements) {
        throw new DiagramsCapError(`XML total element count exceeds maxElements cap (${caps.maxElements})`);
      }
      countTree(value, counts, caps);
    }
  }
}

function extractModelSummary(root: Record<string, unknown>): DrawioModelSummary {
  if ("mxfile" in root && root.mxfile && typeof root.mxfile === "object") {
    const mxfile = root.mxfile as Record<string, unknown>;
    const diagrams = mxfile.diagram;

    if (!diagrams) {
      return { pages: 1, cells: 0, edges: 0 };
    }

    const diagramList = Array.isArray(diagrams) ? diagrams : [diagrams];
    let totalCells = 0;
    let totalEdges = 0;
    let width: number | undefined;
    let height: number | undefined;
    let anyCompressed = false;

    for (const diag of diagramList) {
      if (typeof diag === "string") {
        // Plain string diagram content = compressed/deflated base64 payload
        anyCompressed = true;
        continue;
      }
      if (typeof diag === "object" && diag !== null) {
        const diagObj = diag as Record<string, unknown>;
        if (diagObj["@_compressed"] === "true" || diagObj["@_compressed"] === true || (diagObj["#text"] && !diagObj.mxGraphModel)) {
          anyCompressed = true;
          continue;
        }

        if (diagObj.mxGraphModel && typeof diagObj.mxGraphModel === "object") {
          const modelMetrics = extractGraphModelMetrics(diagObj.mxGraphModel as Record<string, unknown>);
          totalCells += modelMetrics.cells;
          totalEdges += modelMetrics.edges;
          if (width === undefined && modelMetrics.width !== undefined) width = modelMetrics.width;
          if (height === undefined && modelMetrics.height !== undefined) height = modelMetrics.height;
        }
      }
    }

    return {
      pages: diagramList.length,
      cells: totalCells,
      edges: totalEdges,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(anyCompressed ? { compressed: true } : {}),
    };
  }

  if ("mxGraphModel" in root && root.mxGraphModel && typeof root.mxGraphModel === "object") {
    const metrics = extractGraphModelMetrics(root.mxGraphModel as Record<string, unknown>);
    return {
      pages: 1,
      cells: metrics.cells,
      edges: metrics.edges,
      ...(metrics.width !== undefined ? { width: metrics.width } : {}),
      ...(metrics.height !== undefined ? { height: metrics.height } : {}),
    };
  }

  throw new DiagramsModelInvalidError("Invalid draw.io XML structure: root element must be <mxfile> or <mxGraphModel>");
}

function extractGraphModelMetrics(model: Record<string, unknown>): {
  cells: number;
  edges: number;
  width?: number;
  height?: number;
} {
  let cells = 0;
  let edges = 0;

  const width = parsePositiveNumber(model["@_pageWidth"]) ?? parsePositiveNumber(model["@_dx"]) ?? undefined;
  const height = parsePositiveNumber(model["@_pageHeight"]) ?? parsePositiveNumber(model["@_dy"]) ?? undefined;

  const root = model.root;
  if (root && typeof root === "object") {
    const rootRecord = root as Record<string, unknown>;
    for (const [key, val] of Object.entries(rootRecord)) {
      if (key.startsWith("@_")) continue;
      const cellList = Array.isArray(val) ? val : [val];
      for (const item of cellList) {
        if (item && typeof item === "object") {
          const itemRecord = item as Record<string, unknown>;
          if (itemRecord["@_edge"] === "1" || itemRecord["@_edge"] === 1 || itemRecord["@_edge"] === "true") {
            edges++;
          } else if (itemRecord["@_id"] !== undefined || itemRecord["@_vertex"] === "1") {
            cells++;
          }
        }
      }
    }
  }

  return { cells, edges, width, height };
}

function parsePositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const num = Number.parseFloat(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return undefined;
}
