// Plan 060 office golden validation: the golden corpus round-trips
// (generate→parse→compare) against the PACKED tarball (`npm pack` output),
// not workspace source — packaging regressions (missing dist files, broken
// entry points) fail here while unit tests stay green. Single test body so a
// failure names the first diffing file only, never a log wall. Network-free;
// LibreOffice conversion stays in release.yml `office-validation`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GOLDEN = join(ROOT, "packages", "office", "golden");

// Synthetic diagrams pair: same model, permuted attributes/whitespace.
const DIAGRAM_A = `<mxfile host="prism.test" version="24.0.0"><diagram id="d1" name="P1"><mxGraphModel dx="1000" dy="800"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" value="A" vertex="1"><mxGeometry as="geometry" x="10" y="10" width="30" height="60"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
const DIAGRAM_B = `<mxfile version="24.0.0" host="prism.test" ><diagram name="P1" id="d1"><mxGraphModel dy="800" dx="1000"><root><mxCell id="0" /><mxCell parent="0" id="1" /><mxCell vertex="1" value="A" parent="1" id="2"><mxGeometry height="60" width="30" y="10" x="10" as="geometry" /></mxCell></root></mxGraphModel></diagram></mxfile>`;

let packedDir = "";
let documents;
let diagrams;

before(async () => {
  // Extract under a tmp dir inside the workspace root so packed files resolve
  // hoisted prod deps; removed in after().
  packedDir = mkdtempSync(join(ROOT, "node_modules", ".prism-office-packed-"));
  const tgz = execFileSync("npm", ["pack", "-w", "@arnilo/prism-office", "--pack-destination", packedDir], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .trim()
    .split("\n")
    .at(-1)
    .trim();
  execFileSync("tar", ["-xzf", join(packedDir, tgz), "-C", packedDir], { stdio: "pipe" });
  const base = join(packedDir, "package", "dist");
  documents = await import(pathToFileURL(join(base, "documents", "index.js")).href);
  diagrams = await import(pathToFileURL(join(base, "diagrams", "index.js")).href);
});

after(() => {
  if (packedDir) rmSync(packedDir, { recursive: true, force: true });
});

test("packed office golden round-trip (docx/xlsx/pptx) + diagrams canonicalize", async () => {
  const { assertDocModelEqual, assertSheetModelEqual, assertDeckModelEqual } = await import(
    pathToFileURL(join(ROOT, "packages", "office", "dist", "documents", "__tests__", "equality.js")).href
  );
  for (const c of [
    { format: "docx", kind: "doc", model: "golden.doc.model.json", equal: assertDocModelEqual },
    { format: "xlsx", kind: "sheet", model: "golden.sheet.model.json", equal: assertSheetModelEqual },
    { format: "pptx", kind: "deck", model: "golden.deck.model.json", equal: assertDeckModelEqual },
  ]) {
    const model = JSON.parse(readFileSync(join(GOLDEN, c.model), "utf8"));
    const goldenBytes = readFileSync(join(GOLDEN, `golden.${c.format}`));
    assert.ok(documents.isZipContainer(goldenBytes), `${c.format}: golden file must be a zip container`);
    try {
      c.equal(await documents.parseDocument(goldenBytes, { kind: c.kind }), model);
    } catch (e) {
      throw new Error(`${c.format}: parse(golden) mismatch: ${e.message}`);
    }
    const { bytes } = await documents.generateDocument(model, { format: c.format });
    try {
      c.equal(await documents.parseDocument(bytes, { kind: c.kind }), model);
    } catch (e) {
      throw new Error(`${c.format}: regenerate round-trip mismatch: ${e.message}`);
    }
  }
  assert.equal(diagrams.validateDrawioXml(DIAGRAM_A).pages, 1, "packed diagrams: validate must find one page");
  assert.equal(
    diagrams.canonicalizeDrawioXml(DIAGRAM_A),
    diagrams.canonicalizeDrawioXml(DIAGRAM_B),
    "packed diagrams: canonicalize must be stable across attribute order",
  );
});
