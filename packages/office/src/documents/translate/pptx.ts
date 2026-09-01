import {
  generatePresentationSync,
  parsePresentation as ooParsePresentation,
  type PresentationOptions,
  type SlideChild,
  type SlideOptions,
} from "@office-open/pptx";
import type { DeckModel, ListItem, SlideData, SlideLayout } from "../types.js";

function bulletItemToString(item: string | ListItem): string {
  if (typeof item === "string") return item;
  if (item.runs && item.runs.length > 0) {
    return item.runs.map((r) => r.text).join("");
  }
  return item.text ?? "";
}

function slideDataToSlideOptions(slide: SlideData): SlideOptions {
  const children: SlideChild[] = [];
  const titleText = slide.title ?? "";

  switch (slide.layout) {
    case "title": {
      if (titleText) {
        children.push({
          shape: {
            x: 100,
            y: 150,
            width: 800,
            height: 100,
            textBody: {
              paragraphs: [{ text: titleText }],
            },
          },
        });
      }
      if (slide.subtitle) {
        children.push({
          shape: {
            x: 100,
            y: 270,
            width: 800,
            height: 80,
            textBody: {
              paragraphs: [{ text: slide.subtitle }],
            },
          },
        });
      }
      break;
    }
    case "section-header": {
      if (titleText) {
        children.push({
          shape: {
            x: 100,
            y: 200,
            width: 800,
            height: 120,
            textBody: {
              paragraphs: [{ text: titleText }],
            },
          },
        });
      }
      break;
    }
    case "two-column": {
      if (titleText) {
        children.push({
          shape: {
            x: 50,
            y: 50,
            width: 800,
            height: 60,
            textBody: {
              paragraphs: [{ text: titleText }],
            },
          },
        });
      }
      if (slide.bullets && slide.bullets.length > 0) {
        const mid = Math.ceil(slide.bullets.length / 2);
        const col1Paragraphs = slide.bullets.slice(0, mid).map((b) => ({ text: `• ${bulletItemToString(b)}` }));
        const col2Paragraphs = slide.bullets.slice(mid).map((b) => ({ text: `• ${bulletItemToString(b)}` }));

        children.push({
          shape: {
            x: 50,
            y: 130,
            width: 400,
            height: 400,
            textBody: {
              paragraphs: col1Paragraphs,
            },
          },
        });
        if (col2Paragraphs.length > 0) {
          children.push({
            shape: {
              x: 480,
              y: 130,
              width: 400,
              height: 400,
              textBody: {
                paragraphs: col2Paragraphs,
              },
            },
          });
        }
      }
      break;
    }
    case "blank": {
      if (titleText) {
        children.push({
          shape: {
            x: 50,
            y: 50,
            width: 800,
            height: 60,
            textBody: {
              paragraphs: [{ text: titleText }],
            },
          },
        });
      }
      break;
    }
    default: {
      if (titleText) {
        children.push({
          shape: {
            x: 50,
            y: 50,
            width: 800,
            height: 60,
            textBody: {
              paragraphs: [{ text: titleText }],
            },
          },
        });
      }
      if (slide.bullets && slide.bullets.length > 0) {
        const bulletParagraphs = slide.bullets.map((b) => ({ text: `• ${bulletItemToString(b)}` }));
        children.push({
          shape: {
            x: 50,
            y: 130,
            width: 800,
            height: 400,
            textBody: {
              paragraphs: bulletParagraphs,
            },
          },
        });
      }
      break;
    }
  }

  if (slide.image) {
    const label = slide.image.alt ? `[Image: ${slide.image.alt}]` : "[Image]";
    children.push({
      shape: {
        x: 500,
        y: 150,
        width: 300,
        height: 200,
        textBody: {
          paragraphs: [{ text: label }],
        },
      },
    });
  }

  if (slide.chart) {
    const title = slide.chart.title ? ` - ${slide.chart.title}` : "";
    const label = `[Chart: ${slide.chart.chartType}${title}]`;
    children.push({
      shape: {
        x: 500,
        y: 150,
        width: 300,
        height: 200,
        textBody: {
          paragraphs: [{ text: label }],
        },
      },
    });
  }

  return {
    children,
    notes: slide.notes,
  };
}

export function deckModelToPptxOptions(model: DeckModel): PresentationOptions {
  return {
    slides: model.slides.map(slideDataToSlideOptions),
  };
}

export function generatePptxBytes(model: DeckModel): Uint8Array {
  const options = deckModelToPptxOptions(model);
  const result = generatePresentationSync(options);
  return new Uint8Array(result);
}

function extractNotesText(notes: unknown): string | undefined {
  if (!notes) return undefined;
  if (typeof notes === "string") return notes;
  if (typeof notes !== "object") return undefined;

  const notesObj = notes as {
    children?: Array<{
      shape?: {
        textBody?: {
          paragraphs?: Array<{
            text?: string;
            children?: Array<{ text?: string }>;
          }>;
        };
      };
    }>;
  };

  if (!notesObj.children) return undefined;
  const texts: string[] = [];
  for (const child of notesObj.children) {
    const paragraphs = child.shape?.textBody?.paragraphs ?? [];
    for (const p of paragraphs) {
      if (p.text) {
        texts.push(p.text);
      }
      if (p.children) {
        for (const c of p.children) {
          if (c.text) texts.push(c.text);
        }
      }
    }
  }
  return texts.length > 0 ? texts.join("\n") : undefined;
}

export function parsePptxBytes(bytes: Uint8Array): DeckModel {
  const parsed = ooParsePresentation(bytes);
  const slides: SlideData[] = [];

  for (const slide of parsed.slides ?? []) {
    let title: string | undefined;
    let subtitle: string | undefined;
    const bullets: string[] = [];

    const children = slide.children ?? [];
    for (const child of children) {
      if ("shape" in child && child.shape) {
        const paragraphs = child.shape.textBody?.paragraphs ?? [];
        for (const p of paragraphs) {
          let text = "";
          if (typeof p === "string") {
            text = p;
          } else if (p && typeof p === "object") {
            if ("text" in p && typeof (p as { text?: unknown }).text === "string") {
              text = (p as { text: string }).text;
            } else if ("children" in p && Array.isArray((p as { children?: unknown }).children)) {
              const pChildren = (p as { children: Array<{ text?: string } | string> }).children;
              text = pChildren.map((c) => (typeof c === "string" ? c : (c?.text ?? ""))).join("");
            }
          }
          if (!text) continue;

          if (!title) {
            title = text;
          } else if (text.startsWith("• ")) {
            bullets.push(text.slice(2));
          } else if (!subtitle && bullets.length === 0) {
            subtitle = text;
          } else {
            bullets.push(text);
          }
        }
      }
    }

    const notes = extractNotesText(slide.notes);
    const layout: SlideLayout = title && subtitle && bullets.length === 0 ? "title" : "title-and-content";

    slides.push({
      layout,
      title,
      subtitle,
      bullets: bullets.length > 0 ? bullets : undefined,
      notes,
    });
  }

  return {
    kind: "deck",
    modelVersion: 1,
    slides,
  };
}
