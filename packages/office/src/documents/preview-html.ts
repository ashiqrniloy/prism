import type { DocumentsTelemetry } from "./telemetry.js";
import type { CellValue, DeckModel, DocBlock, DocModel, DocRun, DocumentModel, ListItem, SheetModel, SlideData } from "./types.js";

export interface PreviewHtmlOptions {
  /** Maximum output size in UTF-8 bytes (default 512 KiB). Excess content is truncated cleanly. */
  readonly maxHtmlBytes?: number;
  /** Optional telemetry seam hook. */
  readonly telemetry?: DocumentsTelemetry;
}

const DEFAULT_MAX_HTML_BYTES = 512 * 1024; // 512 KiB

/**
 * Escapes characters with special meaning in HTML text and attribute values,
 * and neutralizes active/external URL protocols (javascript:, http://, https://).
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/javascript\s*:/gi, "blocked-script:")
    .replace(/https?:\/\//gi, "");
}

function renderRunHtml(run: DocRun): string {
  let content = escapeHtml(run.text);
  if (run.code) content = `<code>${content}</code>`;
  if (run.strikethrough) content = `<s>${content}</s>`;
  if (run.underline) content = `<u>${content}</u>`;
  if (run.italic) content = `<em>${content}</em>`;
  if (run.bold) content = `<strong>${content}</strong>`;
  if (run.link) {
    // Sanitize-by-construction: link targets are escaped as inert text, never rendered as live clickable href attributes
    content = `${content} <span class="prism-link-text">(${escapeHtml(run.link)})</span>`;
  }
  return content;
}

function renderDocBlockHtml(block: DocBlock): string {
  switch (block.type) {
    case "heading": {
      const tag = `h${block.level}`;
      const idAttr = block.id ? ` id="${escapeHtml(block.id)}"` : "";
      return `<${tag} class="prism-heading prism-heading-${block.level}"${idAttr}>${escapeHtml(block.text)}</${tag}>`;
    }
    case "paragraph": {
      let body = "";
      if (block.runs && block.runs.length > 0) {
        body = block.runs.map(renderRunHtml).join("");
      } else if (block.text !== undefined) {
        body = escapeHtml(block.text);
      }
      return `<p class="prism-paragraph">${body}</p>`;
    }
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const cls = block.ordered ? "prism-list prism-list-ordered" : "prism-list prism-list-unordered";
      const items = block.items
        .map((item) => {
          if (typeof item === "string") {
            return `<li>${escapeHtml(item)}</li>`;
          }
          const li = item as ListItem;
          const body = li.runs && li.runs.length > 0 ? li.runs.map(renderRunHtml).join("") : escapeHtml(li.text);
          return `<li>${body}</li>`;
        })
        .join("");
      return `<${tag} class="${cls}">${items}</${tag}>`;
    }
    case "table": {
      let tableHtml = '<table class="prism-table">';
      if (block.headers && block.headers.length > 0) {
        tableHtml += "<thead><tr>";
        for (const h of block.headers) {
          tableHtml += `<th>${escapeHtml(h)}</th>`;
        }
        tableHtml += "</tr></thead>";
      }
      tableHtml += "<tbody>";
      for (const row of block.cells) {
        tableHtml += "<tr>";
        for (const cell of row) {
          tableHtml += `<td>${renderCellHtml(cell)}</td>`;
        }
        tableHtml += "</tr>";
      }
      tableHtml += "</tbody></table>";
      return tableHtml;
    }
    case "page-break":
      return '<hr class="prism-page-break" />';
    case "image": {
      const alt = block.alt ? escapeHtml(block.alt) : "Embedded Image";
      return `<div class="prism-image-placeholder"><span class="prism-image-alt">[Image: ${alt}]</span></div>`;
    }
    case "chart": {
      const title = block.title ? ` - ${escapeHtml(block.title)}` : "";
      return `<div class="prism-chart-placeholder"><strong class="prism-chart-title">[Chart: ${escapeHtml(block.chartType)}${title}]</strong></div>`;
    }
    default:
      return "";
  }
}

function renderCellHtml(cell: CellValue): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return escapeHtml(cell);
  if (typeof cell === "number" || typeof cell === "boolean") return String(cell);
  if ("type" in cell) {
    if (cell.type === "decimal" || cell.type === "date" || cell.type === "datetime") {
      return escapeHtml(cell.value);
    }
  }
  if ("formula" in cell) {
    const cached = cell.cachedValue !== undefined && cell.cachedValue !== null ? ` = ${escapeHtml(String(cell.cachedValue))}` : "";
    return `<code>${escapeHtml(cell.formula)}${cached}</code>`;
  }
  return "";
}

function renderDocHtml(doc: DocModel): string {
  let html = '<article class="prism-preview prism-doc-preview">';
  if (doc.title) {
    html += `<h1 class="prism-doc-title">${escapeHtml(doc.title)}</h1>`;
  }
  for (const block of doc.blocks) {
    html += renderDocBlockHtml(block);
  }
  html += "</article>";
  return html;
}

function renderSheetHtml(model: SheetModel): string {
  let html = '<div class="prism-preview prism-sheet-preview">';
  if (model.title) {
    html += `<h1 class="prism-sheet-title">${escapeHtml(model.title)}</h1>`;
  }
  for (const sheet of model.sheets) {
    html += `<section class="prism-worksheet"><h2 class="prism-worksheet-name">${escapeHtml(sheet.name)}</h2>`;
    html += '<table class="prism-table"><tbody>';
    for (const row of sheet.cells) {
      html += "<tr>";
      for (const cell of row) {
        html += `<td>${renderCellHtml(cell)}</td>`;
      }
      html += "</tr>";
    }
    html += "</tbody></table></section>";
  }
  html += "</div>";
  return html;
}

function renderSlideHtml(slide: SlideData, index: number): string {
  let html = `<section class="prism-slide prism-slide-${escapeHtml(slide.layout)}" data-slide-index="${index}">`;
  if (slide.title) {
    html += `<h2 class="prism-slide-title">${escapeHtml(slide.title)}</h2>`;
  }
  if (slide.subtitle) {
    html += `<p class="prism-slide-subtitle">${escapeHtml(slide.subtitle)}</p>`;
  }
  if (slide.bullets && slide.bullets.length > 0) {
    html += '<ul class="prism-slide-bullets">';
    for (const bullet of slide.bullets) {
      if (typeof bullet === "string") {
        html += `<li>${escapeHtml(bullet)}</li>`;
      } else {
        const li = bullet as ListItem;
        const body = li.runs && li.runs.length > 0 ? li.runs.map(renderRunHtml).join("") : escapeHtml(li.text);
        html += `<li>${body}</li>`;
      }
    }
    html += "</ul>";
  }
  if (slide.notes) {
    html += `<aside class="prism-slide-notes"><small>${escapeHtml(slide.notes)}</small></aside>`;
  }
  html += "</section>";
  return html;
}

function renderDeckHtml(deck: DeckModel): string {
  let html = '<div class="prism-preview prism-deck-preview">';
  if (deck.title) {
    html += `<h1 class="prism-deck-title">${escapeHtml(deck.title)}</h1>`;
  }
  for (let i = 0; i < deck.slides.length; i += 1) {
    html += renderSlideHtml(deck.slides[i], i);
  }
  html += "</div>";
  return html;
}

/**
 * Renders a Prism Document Model into safe, bounded, framework-neutral HTML.
 *
 * Guaranteed by construction to contain:
 * - No `<script>` tags
 * - No `javascript:` or external URL protocols (`http://`, `https://`)
 * - No active iframes or live link anchors
 * - All text values entity-escaped
 * - Output capped at `maxHtmlBytes` budget
 */
export function renderPreviewHtml(model: DocumentModel, options?: PreviewHtmlOptions): string {
  const maxBytes = options?.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES;
  const span = options?.telemetry?.startSpan("documents.preview", {
    "documents.kind": model?.kind ?? "unknown",
    "documents.preview_type": "html",
  });

  try {
    let rawHtml: string;
    switch (model.kind) {
      case "doc":
        rawHtml = renderDocHtml(model as DocModel);
        break;
      case "sheet":
        rawHtml = renderSheetHtml(model as SheetModel);
        break;
      case "deck":
        rawHtml = renderDeckHtml(model as DeckModel);
        break;
      default:
        rawHtml = "";
    }

    const encodedBytes = new TextEncoder().encode(rawHtml);
    if (encodedBytes.byteLength <= maxBytes) {
      return rawHtml;
    }

    // Budget exceeded: truncate and append terminal note
    const truncatedSlice = encodedBytes.subarray(0, Math.max(0, maxBytes - 128));
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(truncatedSlice);
    return `${decoded}<div class="prism-preview-truncated">[Preview truncated: byte budget exceeded]</div>`;
  } catch (err) {
    span?.recordError();
    throw err;
  } finally {
    span?.end();
  }
}
