import assert from "node:assert/strict";
import { test } from "node:test";
import { generateDocument, type DeckModel, type SheetModel } from "../../documents/index.js";
import { createDocumentReader } from "../index.js";

const sheet: SheetModel = {
  kind: "sheet",
  modelVersion: 1,
  sheets: [
    {
      name: "Revenue",
      cells: [
        ["Region", "Amount"],
        ["North", { type: "decimal", value: "1500000.00" }],
      ],
    },
  ],
};

const deck: DeckModel = {
  kind: "deck",
  modelVersion: 1,
  slides: [{ layout: "title-and-content", title: "Q4 plan", bullets: ["Ship reader", "Keep bytes bounded"] }],
};

test("reader extracts bounded TSV and slide outlines from OOXML", async () => {
  const reader = await createDocumentReader();
  const [xlsx, pptx] = await Promise.all([generateDocument(sheet, { format: "xlsx" }), generateDocument(deck, { format: "pptx" })]);

  const sheetResult = await reader.extract({ buffer: Buffer.from(xlsx.bytes), path: "revenue.xlsx" });
  assert.equal(sheetResult?.format, "xlsx");
  if (!sheetResult) throw new Error("xlsx reader returned no result");
  assert.match(sheetResult.text, /Revenue\nRegion\tAmount\nNorth\t1500000/);

  const deckResult = await reader.extract({ buffer: Buffer.from(pptx.bytes), path: "plan.pptx" });
  assert.equal(deckResult?.format, "pptx");
  if (!deckResult) throw new Error("pptx reader returned no result");
  assert.match(deckResult.text, /Q4 plan\nShip reader\nKeep bytes bounded/);
});
