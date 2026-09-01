import assert from "node:assert/strict";
import type {
  CellValue,
  DeckModel,
  DocBlock,
  DocModel,
  DocRun,
  DocumentModel,
  HeadingBlock,
  ListItem,
  ParagraphBlock,
  SheetModel,
  SlideData,
  TableBlock,
} from "../types.js";

/**
 * Normalizes cell values for equality comparison.
 * In particular, handles canonical decimal strings, numbers, and formulas.
 */
export function normalizeCellValue(value: CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return value;

  if ("type" in value) {
    if (value.type === "decimal") {
      // Numerical normalization of decimal strings (e.g. "1234.50" -> 1234.5)
      const num = Number(value.value);
      return Number.isFinite(num) ? num : value.value;
    }
    return value.value;
  }

  if ("formula" in value) {
    const raw = value.formula.startsWith("=") ? value.formula.slice(1) : value.formula;
    return `=${raw}`;
  }

  return value;
}

export function assertDocRunEqual(actual: DocRun, expected: DocRun): void {
  assert.equal(actual.text, expected.text);
  assert.equal(actual.bold ?? false, expected.bold ?? false);
  assert.equal(actual.italic ?? false, expected.italic ?? false);
  assert.equal(actual.underline ?? false, expected.underline ?? false);
  assert.equal(actual.strikethrough ?? false, expected.strikethrough ?? false);
  assert.equal(actual.code ?? false, expected.code ?? false);
}

export function assertDocBlockEqual(actual: DocBlock, expected: DocBlock): void {
  assert.equal(actual.type, expected.type, "Block type mismatch");

  switch (expected.type) {
    case "heading": {
      const act = actual as HeadingBlock;
      assert.equal(act.level, expected.level);
      assert.equal(act.text.trim(), expected.text.trim());
      break;
    }
    case "paragraph": {
      const act = actual as ParagraphBlock;
      if (expected.runs && expected.runs.length > 0) {
        assert.ok(act.runs, "expected runs in paragraph");
        assert.equal(act.runs.length, expected.runs.length);
        for (let i = 0; i < expected.runs.length; i += 1) {
          assertDocRunEqual(act.runs[i], expected.runs[i]);
        }
      } else if (expected.text !== undefined) {
        assert.equal(act.text?.trim(), expected.text.trim());
      }
      break;
    }
    case "table": {
      const act = actual as TableBlock;
      assert.equal(act.cells.length, expected.cells.length, "Table row count mismatch");
      for (let r = 0; r < expected.cells.length; r += 1) {
        assert.equal(act.cells[r].length, expected.cells[r].length, `Table col count mismatch at row ${r}`);
        for (let c = 0; c < expected.cells[r].length; c += 1) {
          const actNorm = normalizeCellValue(act.cells[r][c]);
          const expNorm = normalizeCellValue(expected.cells[r][c]);
          assert.deepEqual(actNorm, expNorm, `Cell mismatch at (${r}, ${c})`);
        }
      }
      break;
    }
    case "page-break":
      assert.equal(actual.type, "page-break");
      break;
    case "image":
      assert.equal((actual as { alt?: string }).alt, expected.alt);
      break;
    case "chart":
      assert.equal((actual as { chartType?: string }).chartType, expected.chartType);
      break;
  }
}

export function assertDocModelEqual(actual: DocModel, expected: DocModel): void {
  assert.equal(actual.kind, "doc");
  assert.equal(actual.modelVersion, expected.modelVersion);
  if (expected.title) {
    assert.equal(actual.title, expected.title);
  }
  assert.equal(actual.blocks.length, expected.blocks.length, "Doc block count mismatch");
  for (let i = 0; i < expected.blocks.length; i += 1) {
    assertDocBlockEqual(actual.blocks[i], expected.blocks[i]);
  }
}

export function assertSheetModelEqual(actual: SheetModel, expected: SheetModel): void {
  assert.equal(actual.kind, "sheet");
  assert.equal(actual.modelVersion, expected.modelVersion);
  assert.equal(actual.sheets.length, expected.sheets.length, "Sheet count mismatch");

  for (let s = 0; s < expected.sheets.length; s += 1) {
    const actSheet = actual.sheets[s];
    const expSheet = expected.sheets[s];
    assert.equal(actSheet.name, expSheet.name);
    assert.equal(actSheet.cells.length, expSheet.cells.length, `Sheet ${s} row count mismatch`);

    for (let r = 0; r < expSheet.cells.length; r += 1) {
      assert.equal(actSheet.cells[r].length, expSheet.cells[r].length, `Sheet ${s} col count mismatch at row ${r}`);
      for (let c = 0; c < expSheet.cells[r].length; c += 1) {
        const actNorm = normalizeCellValue(actSheet.cells[r][c]);
        const expNorm = normalizeCellValue(expSheet.cells[r][c]);
        assert.deepEqual(actNorm, expNorm, `Sheet ${s} cell mismatch at (${r}, ${c})`);
      }
    }
  }
}

function bulletItemToString(item: string | ListItem): string {
  if (typeof item === "string") return item;
  return (item as { text: string }).text ?? "";
}

export function assertSlideEqual(actual: SlideData, expected: SlideData, slideIndex: number): void {
  assert.equal(actual.layout, expected.layout, `Slide ${slideIndex} layout mismatch`);
  if (expected.title !== undefined) {
    assert.equal(actual.title?.trim(), expected.title.trim(), `Slide ${slideIndex} title mismatch`);
  }
  if (expected.subtitle !== undefined) {
    assert.equal(actual.subtitle?.trim(), expected.subtitle.trim(), `Slide ${slideIndex} subtitle mismatch`);
  }
  if (expected.bullets !== undefined) {
    assert.ok(actual.bullets, `Slide ${slideIndex} expected bullets`);
    assert.equal(actual.bullets.length, expected.bullets.length, `Slide ${slideIndex} bullet count mismatch`);
    for (let b = 0; b < expected.bullets.length; b += 1) {
      const expB = bulletItemToString(expected.bullets[b]);
      const actB = bulletItemToString(actual.bullets[b]);
      assert.equal(actB.trim(), expB.trim(), `Slide ${slideIndex} bullet ${b} mismatch`);
    }
  }
  if (expected.notes !== undefined) {
    assert.equal(actual.notes?.trim(), expected.notes.trim(), `Slide ${slideIndex} notes mismatch`);
  }
}

export function assertDeckModelEqual(actual: DeckModel, expected: DeckModel): void {
  assert.equal(actual.kind, "deck");
  assert.equal(actual.modelVersion, expected.modelVersion);
  assert.equal(actual.slides.length, expected.slides.length, "Deck slide count mismatch");

  for (let s = 0; s < expected.slides.length; s += 1) {
    assertSlideEqual(actual.slides[s], expected.slides[s], s);
  }
}

export function assertDocumentModelEqual(actual: DocumentModel, expected: DocumentModel): void {
  assert.equal(actual.kind, expected.kind);
  switch (expected.kind) {
    case "doc":
      assertDocModelEqual(actual as DocModel, expected as DocModel);
      break;
    case "sheet":
      assertSheetModelEqual(actual as SheetModel, expected as SheetModel);
      break;
    case "deck":
      assertDeckModelEqual(actual as DeckModel, expected as DeckModel);
      break;
  }
}
