import { createMistralOcrParser } from "@arnilo/prism-work/document-reader";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory";
import { replaceDocument, retrieveContext } from "@arnilo/prism-memory/rag";

const pdf = Buffer.from("%PDF-1.7\n%", "latin1");
let pagesProcessed = 0;
const ocr = createMistralOcrParser({
  apiKey: "demo",
  fetch: async () =>
    new Response(
      JSON.stringify({
        pages: [{ index: 1, markdown: "Recheck policy before side effects." }],
        model: "mistral-ocr-latest",
        usage_info: { pages_processed: 1 },
      }),
      { status: 200 },
    ),
  recordUsage: (usage) => {
    pagesProcessed = usage.pagesProcessed;
  },
});

const scope = { tenantId: "demo", resourceId: "docs", corpusId: "scans" };
const store = createMemoryVectorStore();
const embedder = createHashEmbedder();
const replaced = await replaceDocument({
  uri: "ocr:demo",
  sourceId: "scan",
  loader: {
    load: async () => ({ uri: "ocr:demo", sourceId: "scan", mediaType: "application/pdf", data: pdf }),
  },
  parser: {
    async parse(document, options) {
      const buffer = Buffer.from(document.data ?? new Uint8Array());
      const extracted = await ocr.extract(buffer, {
        maxPages: options?.maxPages ?? 4,
        maxTextBytes: 64 * 1024,
        signal: options?.signal,
      });
      return { text: extracted.text, metadata: { pages: extracted.pages } };
    },
  },
  embedder,
  store,
  scope,
});
const found = await retrieveContext("policy", { embedder, store, scope, lexical: "off" });
console.log(JSON.stringify({ indexed: replaced.indexed, pagesProcessed, citation: found.citations[0]?.id }));
