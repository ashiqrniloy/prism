import {
  type DocumentOptions,
  generateDocumentSync,
  parseDocument as ooParseDocument,
  type ParagraphOptions,
  type SectionChild,
  type TableOptions,
} from "@office-open/docx";
import type { CellValue, DocBlock, DocModel, DocRun, ListItem, TableBlock } from "../types.js";

function docRunToRunOptions(run: DocRun) {
  return {
    text: run.text,
    bold: run.bold,
    italic: run.italic,
    underline: run.underline ? ({ type: "single" } as const) : undefined,
    strike: run.strikethrough,
    font: run.code ? { name: "Courier New" } : undefined,
  };
}

function cellValueToString(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if ("type" in value) {
    return value.value;
  }
  if ("formula" in value) {
    return value.cachedValue !== undefined && value.cachedValue !== null ? String(value.cachedValue) : value.formula;
  }
  return "";
}

function blockToSectionChildren(block: DocBlock): SectionChild[] {
  switch (block.type) {
    case "heading": {
      const headingKey = `Heading${block.level}` as const;
      return [
        {
          paragraph: {
            heading: headingKey,
            children: [{ text: block.text }],
          },
        },
      ];
    }
    case "paragraph": {
      const children =
        block.runs && block.runs.length > 0 ? block.runs.map(docRunToRunOptions) : block.text !== undefined ? [{ text: block.text }] : [];
      return [
        {
          paragraph: {
            children,
          },
        },
      ];
    }
    case "list": {
      const paragraphs: SectionChild[] = [];
      for (let i = 0; i < block.items.length; i += 1) {
        const item = block.items[i];
        const prefix = block.ordered ? `${i + 1}. ` : "• ";
        if (typeof item === "string") {
          paragraphs.push({
            paragraph: {
              children: [{ text: `${prefix}${item}` }],
            },
          });
        } else {
          const listItem = item as ListItem;
          const runs = (listItem.runs ?? []).map(docRunToRunOptions);
          paragraphs.push({
            paragraph: {
              children: [{ text: prefix }, ...runs],
            },
          });
        }
      }
      return paragraphs;
    }
    case "table": {
      const tableRows = [];
      if (block.headers && block.headers.length > 0) {
        tableRows.push({
          cells: block.headers.map((h) => ({
            children: [
              {
                paragraph: {
                  children: [{ text: h, bold: true }],
                },
              },
            ],
          })),
        });
      }
      for (const row of block.cells) {
        tableRows.push({
          cells: row.map((cell) => ({
            children: [
              {
                paragraph: {
                  children: [{ text: cellValueToString(cell) }],
                },
              },
            ],
          })),
        });
      }
      return [
        {
          table: {
            rows: tableRows,
          } as TableOptions,
        },
      ];
    }
    case "page-break": {
      return [
        {
          paragraph: {
            children: [{ break: 1 }],
          },
        },
      ];
    }
    case "image": {
      const label = block.alt ? `[Image: ${block.alt}]` : "[Image]";
      return [
        {
          paragraph: {
            children: [{ text: label, italic: true }],
          },
        },
      ];
    }
    case "chart": {
      const title = block.title ? ` - ${block.title}` : "";
      const label = `[Chart: ${block.chartType}${title}]`;
      return [
        {
          paragraph: {
            children: [{ text: label, bold: true }],
          },
        },
      ];
    }
    default:
      return [];
  }
}

export function docModelToDocxOptions(model: DocModel): DocumentOptions {
  const children: SectionChild[] = [];
  if (model.title) {
    children.push({
      paragraph: {
        heading: "Title",
        children: [{ text: model.title }],
      },
    });
  }

  for (const block of model.blocks) {
    children.push(...blockToSectionChildren(block));
  }

  return {
    sections: [
      {
        children,
      },
    ],
  };
}

export function generateDocxBytes(model: DocModel): Uint8Array {
  const options = docModelToDocxOptions(model);
  const result = generateDocumentSync(options);
  return new Uint8Array(result);
}

function extractParagraphText(p: ParagraphOptions | undefined): string {
  if (!p) return "";
  if (p.text) return p.text;
  if (!p.children) return "";
  const parts: string[] = [];
  for (const child of p.children) {
    if (typeof child === "string") {
      parts.push(child);
    } else if (child && typeof child === "object" && "text" in child && typeof child.text === "string") {
      parts.push(child.text);
    }
  }
  return parts.join("");
}

function extractParagraphRuns(p: ParagraphOptions | undefined): DocRun[] | undefined {
  if (!p?.children || p.children.length === 0) return undefined;
  const runs: DocRun[] = [];
  for (const child of p.children) {
    if (typeof child === "string") {
      runs.push({ text: child });
    } else if (child && typeof child === "object" && "text" in child && typeof child.text === "string") {
      runs.push({
        text: child.text,
        bold: (child as { bold?: boolean }).bold,
        italic: (child as { italic?: boolean }).italic,
        underline: (child as { underline?: unknown }).underline ? true : undefined,
        strikethrough: (child as { strike?: boolean }).strike,
        code: (child as { font?: { name?: string } }).font?.name === "Courier New" ? true : undefined,
      });
    }
  }
  return runs.length > 0 ? runs : undefined;
}

export function parseDocxBytes(bytes: Uint8Array): DocModel {
  const parsed = ooParseDocument(bytes);
  let title: string | undefined;
  const blocks: DocBlock[] = [];

  const sections = parsed.sections ?? [];
  for (const section of sections) {
    const children = (section.children ?? []) as Array<Record<string, unknown>>;
    for (const child of children) {
      if ("paragraph" in child) {
        const p = child.paragraph as ParagraphOptions & { heading?: string };
        const heading = p.heading;
        const text = extractParagraphText(p);

        if (heading === "Title" && !title) {
          title = text;
          continue;
        }

        if (heading && /^Heading[1-6]$/.test(heading)) {
          const level = Number(heading.replace("Heading", "")) as 1 | 2 | 3 | 4 | 5 | 6;
          blocks.push({
            type: "heading",
            level,
            text,
          });
          continue;
        }

        if (p.children?.some((c) => typeof c === "object" && c !== null && "break" in c)) {
          blocks.push({ type: "page-break" });
          continue;
        }

        const runs = extractParagraphRuns(p);
        blocks.push({
          type: "paragraph",
          text,
          runs,
        });
      } else if ("table" in child) {
        const t = child.table as { rows?: Array<{ cells?: Array<{ children?: Array<{ paragraph?: ParagraphOptions }> }> }> };
        const rows = t.rows ?? [];
        const tableCells: CellValue[][] = [];

        for (const row of rows) {
          const rowCells: CellValue[] = [];
          for (const cell of row.cells ?? []) {
            const cellText = (cell.children ?? []).map((c) => extractParagraphText(c.paragraph)).join("\n");
            rowCells.push(cellText);
          }
          tableCells.push(rowCells);
        }

        const rowCount = tableCells.length;
        const colCount = rowCount > 0 ? tableCells[0].length : 0;
        blocks.push({
          type: "table",
          rows: rowCount,
          columns: colCount,
          cells: tableCells,
        } as TableBlock);
      }
    }
  }

  return {
    kind: "doc",
    modelVersion: 1,
    title,
    blocks,
  };
}
