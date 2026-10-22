/**
 * Missing-optional-peer probe. Run explicitly (`bun test src/__tests__/missing-parser.fixture.ts`) by
 * `package.test.ts` in a subprocess: `mock.module("pdf-parse", …)` leaks to every later file in the
 * same Bun process, so the mock must not run inside the shared suite. The `.fixture.ts` name keeps
 * the default test discovery from picking it up.
 */

import { describe, it, mock } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent, definePackage } from "@arnilo/prism";
import type { DocumentReader } from "../document-reader/index.js";
import toolsWork from "../index.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const GOLDEN_DOCX = join(REPO_ROOT, "packages/tools/work/golden/golden.docx");

/** A probe package that extracts a fixture through the `work.reader` service. */
function readerProbe(fixture: string) {
  return definePackage<Record<string, never>>({
    name: "test-work-reader-probe",
    version: "0.0.0",
    requires: { api: 1 },
    setup: (prism) => {
      const reader = prism.services.consume<DocumentReader>("work.reader");
      prism.commands.register({
        name: "probe-work-reader",
        description: "extract the docx fixture through the work.reader service",
        run: async () => {
          if (!reader) return { present: false };
          const result = await reader.extract({ buffer: readFileSync(fixture), path: fixture });
          return { present: true, format: result?.format, hasText: Boolean(result?.text) };
        },
      });
    },
  });
}

describe("tools_work_missing_parser", () => {
  it("drops the pdf format with a note while docx still reads", async () => {
    // A plain object with no `PDFParse` export makes `createPdfParser()` throw, which setup catches
    // per format. A throwing factory would surface an unhandled error between tests instead.
    mock.module("pdf-parse", () => ({ default: {} }));
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsWork({ root: tmpdir(), reader: { formats: ["pdf", "docx"] } }), readerProbe(GOLDEN_DOCX)],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.level === "warn");
      assert.ok(
        notes.some((note) => note.message.includes("pdf")),
        "a warn note names the dropped format",
      );
      assert.deepEqual(await agent.commands.run("probe-work-reader", {}), { present: true, format: "docx", hasText: true });
    } finally {
      await agent.dispose();
    }
  });
});
