import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDocument } from "../generate.js";
import type { DeckModel, DocModel, SheetModel } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(__dirname, "..", "..", "golden");

export async function regenerateGoldens(): Promise<void> {
  // 1. Docx
  const docJson = JSON.parse(readFileSync(join(goldenDir, "golden.doc.model.json"), "utf-8")) as DocModel;
  const { bytes: docBytes } = await generateDocument(docJson, { format: "docx" });
  writeFileSync(join(goldenDir, "golden.docx"), docBytes);
  console.log(`Generated golden.docx (${docBytes.byteLength} bytes)`);

  // 2. Xlsx
  const sheetJson = JSON.parse(readFileSync(join(goldenDir, "golden.sheet.model.json"), "utf-8")) as SheetModel;
  const { bytes: sheetBytes } = await generateDocument(sheetJson, { format: "xlsx" });
  writeFileSync(join(goldenDir, "golden.xlsx"), sheetBytes);
  console.log(`Generated golden.xlsx (${sheetBytes.byteLength} bytes)`);

  // 3. Pptx
  const deckJson = JSON.parse(readFileSync(join(goldenDir, "golden.deck.model.json"), "utf-8")) as DeckModel;
  const { bytes: deckBytes } = await generateDocument(deckJson, { format: "pptx" });
  writeFileSync(join(goldenDir, "golden.pptx"), deckBytes);
  console.log(`Generated golden.pptx (${deckBytes.byteLength} bytes)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await regenerateGoldens();
}
