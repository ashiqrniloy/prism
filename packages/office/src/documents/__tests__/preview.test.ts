import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type DeckModel,
  type DeckSlideListPreviewBlock,
  type DocModel,
  type DocOutlinePreviewBlock,
  renderPreviewBlocks,
  type SheetGridPreviewBlock,
  type SheetModel,
  type TruncationNotePreviewBlock,
} from "../index.js";

describe("renderPreviewBlocks", () => {
  it("renders 10,000-row sheet into bounded grid blocks and a truncation note", () => {
    const largeSheet: SheetModel = {
      kind: "sheet",
      modelVersion: 1,
      sheets: [
        {
          name: "LargeDataset",
          cells: Array.from({ length: 10_000 }, (_, i) => [`Row ${i}`, i * 1.5, { type: "decimal", value: `${i}.99` }]),
        },
      ],
    };

    const blocks = renderPreviewBlocks(largeSheet, {
      maxRowsPerBlock: 200,
      maxTotalRowsPerSheet: 1_000,
    });

    // 1000 previewable rows / 200 per block = 5 grid blocks + 1 truncation note
    assert.equal(blocks.length, 6);

    const gridBlocks = blocks.filter((b) => b.type === "sheet-grid") as SheetGridPreviewBlock[];
    assert.equal(gridBlocks.length, 5);

    for (let i = 0; i < gridBlocks.length; i += 1) {
      const gb = gridBlocks[i];
      assert.equal(gb.name, "LargeDataset");
      assert.equal(gb.rows.length, 200);
      assert.equal(gb.bounds.fromRow, i * 200);
      assert.equal(gb.bounds.toRow, (i + 1) * 200 - 1);
      assert.equal(gb.totalRows, 10_000);
      assert.equal(gb.totalColumns, 3);
    }

    const truncationBlock = blocks[5] as TruncationNotePreviewBlock;
    assert.equal(truncationBlock.type, "truncation-note");
    assert.equal(truncationBlock.droppedItems, 9_000);
    assert.match(truncationBlock.message, /first 1000 of 10000 rows/);
  });

  it("extracts document outline and chunks blocks", () => {
    const doc: DocModel = {
      kind: "doc",
      modelVersion: 1,
      title: "Technical Architecture",
      blocks: [
        { type: "heading", level: 1, text: "Introduction" },
        { type: "paragraph", text: "Introductory paragraph." },
        { type: "heading", level: 2, text: "System Components" },
        { type: "paragraph", text: "Components overview." },
        { type: "heading", level: 3, text: "Data Pipeline" },
        { type: "paragraph", text: "Pipeline description." },
      ],
    };

    const blocks = renderPreviewBlocks(doc, { maxBlocksPerChunk: 10 });
    assert.equal(blocks.length, 2);

    const outline = blocks[0] as DocOutlinePreviewBlock;
    assert.equal(outline.type, "doc-outline");
    assert.equal(outline.title, "Technical Architecture");
    assert.equal(outline.headings.length, 3);
    assert.equal(outline.headings[0].text, "Introduction");
    assert.equal(outline.headings[0].level, 1);
    assert.equal(outline.headings[1].text, "System Components");
    assert.equal(outline.headings[1].level, 2);
    assert.equal(outline.headings[2].text, "Data Pipeline");
    assert.equal(outline.headings[2].level, 3);
  });

  it("renders presentation slide list and bounds", () => {
    const deck: DeckModel = {
      kind: "deck",
      modelVersion: 1,
      title: "Executive Deck",
      slides: [
        { layout: "title", title: "Slide 1", subtitle: "Sub 1" },
        { layout: "title-and-content", title: "Slide 2", bullets: ["A", "B"] },
        { layout: "section-header", title: "Slide 3" },
      ],
    };

    const blocks = renderPreviewBlocks(deck, { maxSlides: 2 });
    assert.equal(blocks.length, 2);

    const slideList = blocks[0] as DeckSlideListPreviewBlock;
    assert.equal(slideList.type, "deck-slides");
    assert.equal(slideList.totalSlides, 3);
    assert.equal(slideList.slides.length, 2);
    assert.equal(slideList.bounds.fromIndex, 0);
    assert.equal(slideList.bounds.toIndex, 1);

    const truncation = blocks[1] as TruncationNotePreviewBlock;
    assert.equal(truncation.type, "truncation-note");
    assert.equal(truncation.droppedItems, 1);
  });
});
