import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { generateDocument, isZipContainer, parseDocument } from "../index.js";
import type { DeckModel, DocModel, SheetModel } from "../types.js";
import { assertDeckModelEqual, assertDocModelEqual, assertSheetModelEqual } from "./equality.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(__dirname, "..", "..", "..", "golden");

describe("Golden Files and Equality Round-Trip", () => {
  const docJson = JSON.parse(readFileSync(join(goldenDir, "golden.doc.model.json"), "utf-8")) as DocModel;
  const sheetJson = JSON.parse(readFileSync(join(goldenDir, "golden.sheet.model.json"), "utf-8")) as SheetModel;
  const deckJson = JSON.parse(readFileSync(join(goldenDir, "golden.deck.model.json"), "utf-8")) as DeckModel;

  const docxBytes = readFileSync(join(goldenDir, "golden.docx"));
  const xlsxBytes = readFileSync(join(goldenDir, "golden.xlsx"));
  const pptxBytes = readFileSync(join(goldenDir, "golden.pptx"));

  it("verifies golden files exist and are valid PK zip containers", () => {
    assert.ok(isZipContainer(docxBytes), "golden.docx must be a valid zip container");
    assert.ok(isZipContainer(xlsxBytes), "golden.xlsx must be a valid zip container");
    assert.ok(isZipContainer(pptxBytes), "golden.pptx must be a valid zip container");
  });

  it("parses golden.docx to a model structurally equal to golden.doc.model.json", async () => {
    const parsed = (await parseDocument(docxBytes, { kind: "doc" })) as DocModel;
    assertDocModelEqual(parsed, docJson);
  });

  it("parses golden.xlsx to a model structurally equal to golden.sheet.model.json", async () => {
    const parsed = (await parseDocument(xlsxBytes, { kind: "sheet" })) as SheetModel;
    assertSheetModelEqual(parsed, sheetJson);
  });

  it("parses golden.pptx to a model structurally equal to golden.deck.model.json", async () => {
    const parsed = (await parseDocument(pptxBytes, { kind: "deck" })) as DeckModel;
    assertDeckModelEqual(parsed, deckJson);
  });

  it("regenerates DOCX from model and validates round-trip equality", async () => {
    const { bytes } = await generateDocument(docJson, { format: "docx" });
    const parsed = (await parseDocument(bytes, { kind: "doc" })) as DocModel;
    assertDocModelEqual(parsed, docJson);
  });

  it("regenerates XLSX from model and validates round-trip equality", async () => {
    const { bytes } = await generateDocument(sheetJson, { format: "xlsx" });
    const parsed = (await parseDocument(bytes, { kind: "sheet" })) as SheetModel;
    assertSheetModelEqual(parsed, sheetJson);
  });

  it("regenerates PPTX from model and validates round-trip equality", async () => {
    const { bytes } = await generateDocument(deckJson, { format: "pptx" });
    const parsed = (await parseDocument(bytes, { kind: "deck" })) as DeckModel;
    assertDeckModelEqual(parsed, deckJson);
  });

  // Gated CI validation using headless LibreOffice (skipped unless PRISM_TEST_LIBREOFFICE=1)
  const runOfficeCI = process.env.PRISM_TEST_LIBREOFFICE === "1";
  const suite = runOfficeCI ? it : it.skip;

  suite("validates golden files convert to PDF via LibreOffice without repair prompts", () => {
    const tempProfileDir = mkdtempSync(join(tmpdir(), "prism-lo-profile-"));
    const tempOutDir = mkdtempSync(join(tmpdir(), "prism-lo-out-"));

    try {
      for (const format of ["docx", "xlsx", "pptx"]) {
        const file = join(goldenDir, `golden.${format}`);
        execFileSync(
          "soffice",
          ["--headless", `-env:UserInstallation=file://${tempProfileDir}`, "--convert-to", "pdf", "--outdir", tempOutDir, file],
          { timeout: 60_000, stdio: "pipe" },
        );
      }
    } finally {
      rmSync(tempProfileDir, { recursive: true, force: true });
      rmSync(tempOutDir, { recursive: true, force: true });
    }
  });
});
