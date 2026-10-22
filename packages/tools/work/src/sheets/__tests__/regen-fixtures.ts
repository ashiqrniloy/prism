import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateWorkbookSync } from "@office-open/xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "..", "..", "fixtures", "xlsx");

// Regenerates the committed parse-fixture workbooks asserted by corpus.test.ts.
// Content assertions live in the test; regenerate only when those change.
export function regenerateSheetsFixtures(): void {
  const minimal = generateWorkbookSync({
    worksheets: [
      {
        name: "Sheet1",
        rows: [{ cells: [{ value: "label" }] }, { cells: [{ value: "value" }] }],
      },
    ],
  } as never);
  writeFileSync(join(fixturesDir, "minimal.xlsx"), minimal);
  console.log(`Generated minimal.xlsx (${minimal.byteLength} bytes)`);

  const financial = generateWorkbookSync({
    worksheets: [
      {
        name: "Revenue",
        rows: [
          { cells: [{ value: "Item" }, { value: "Amount" }, { value: "Tax" }] },
          {
            cells: [{ value: "Base" }, { value: 1234.56 }, { formula: "B2*0.2", value: 246.912 }],
          },
        ],
      },
      {
        name: "Expenses",
        rows: [{ cells: [{ value: "Item" }, { value: "Cost" }] }, { cells: [{ value: "Hosting" }, { value: 450 }] }],
      },
    ],
  } as never);
  writeFileSync(join(fixturesDir, "financial.xlsx"), financial);
  console.log(`Generated financial.xlsx (${financial.byteLength} bytes)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  regenerateSheetsFixtures();
}
