import { type JsonSchema, validateJsonSchema } from "@arnilo/prism";

const jsonSchemaValidator = {
  validate(schema: JsonSchema, value: unknown) {
    const result = validateJsonSchema(schema, value);
    return result.ok ? { ok: true as const, value: result.value } : { ok: false as const, errors: result.errors };
  },
};
import { createBraveSearch, createFirecrawlExtractor, createFirecrawlFetch, createWebTools } from "@arnilo/prism-tools-web";

const reply = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const fakeFetch: typeof fetch = async (input) => {
  const path = new URL(String(input)).pathname;
  if (path.includes("web/search"))
    return reply({ web: { results: [{ title: "Prism", url: "https://example.com/prism", description: "SDK overview" }] } });
  if (path.endsWith("/scrape"))
    return reply({ success: true, data: { markdown: "# Prism", metadata: { sourceURL: "https://example.com/prism" } } });
  return reply({ success: true, data: { title: "Prism" } });
};
const common = { credentials: "fake-example-key", fetch: fakeFetch };
const search = createBraveSearch(common);
const fetchDocument = createFirecrawlFetch(common);
const extract = createFirecrawlExtractor({
  ...common,
  schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  validator: jsonSchemaValidator,
});
const tools = createWebTools({ search, fetch: fetchDocument, extract });

const found = await search.search("Prism SDK", { count: 1 });
const document = await fetchDocument.fetch(found.results[0]!.url); // host chooses fetch path; model cannot switch adapters
console.log(
  JSON.stringify({ tools: tools.map(({ name }) => name), citation: found.results[0]!.citationId, untrusted: document.untrusted }),
);
