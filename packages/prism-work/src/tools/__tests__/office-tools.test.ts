import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArtifactBodyRef, ArtifactBodyStore, JsonObject, ToolDefinition, ToolExecutionContext } from "@arnilo/prism";
import { createOfficeTools } from "../index.js";

const model = {
  kind: "doc",
  modelVersion: 1,
  title: "Quarterly report",
  blocks: [{ type: "paragraph", runs: [{ text: "Revenue is up." }] }],
} as const;

const context: ToolExecutionContext = { sessionId: "session-1", runId: "run-1", toolCallId: "call-1" };

function tool(tools: readonly ToolDefinition[], name: string): ToolDefinition {
  const found = tools.find((candidate) => candidate.name === name);
  assert.ok(found, `missing ${name}`);
  return found;
}

test("office tools keep OOXML bytes in a contained filesystem or host artifact store", async () => {
  const files = new Map<string, Uint8Array>();
  const bodies = new Map<string, Uint8Array>();
  const bodyStore: ArtifactBodyStore = {
    async put(ref, bytes) {
      if (!(bytes instanceof Uint8Array)) throw new Error("stream not used");
      bodies.set(ref.artifactId, bytes);
    },
    async get() {
      throw new Error("not used");
    },
    async delete() {},
    async presign() {
      throw new Error("not used");
    },
  };
  const tools = createOfficeTools({
    filesystem: {
      root: "/workspace",
      async readFile(path) {
        const bytes = files.get(path);
        if (!bytes) throw new Error("missing file");
        return bytes;
      },
      async writeFile(path, bytes) {
        files.set(path, bytes);
      },
      async assertPathInsideRoots(roots, path) {
        return roots[0] === "/workspace" && path.startsWith("/workspace/");
      },
    },
    artifacts: {
      bodies: bodyStore,
      createRef(input): ArtifactBodyRef {
        return {
          tenantId: "tenant-1",
          artifactId: `office-${input.context.toolCallId}`,
          threadId: "thread-1",
          version: 1,
          mime: input.mime,
          size: input.byteLength,
          hash: input.contentHash,
        };
      },
    },
  });
  assert.deepEqual(
    tools.map(({ name }) => name),
    ["office_parse", "office_import", "office_generate", "office_patch", "office_diff", "office_preview"],
  );

  const generate = tool(tools, "office_generate");
  assert.equal(typeof generate.effect, "function");
  if (typeof generate.effect === "function") {
    assert.deepEqual(generate.effect({ model: model as unknown as JsonObject, format: "docx" }, context), {
      kind: "none",
      idempotency: "none",
    });
    assert.deepEqual(generate.effect({ model: model as unknown as JsonObject, format: "docx", outputPath: "report.docx" }, context), {
      kind: "external_mutation",
      idempotency: "unsupported",
    });
  }

  const generated = await generate.execute({ model: model as unknown as JsonObject, format: "docx", outputPath: "report.docx" }, context);
  assert.equal(generated.error, undefined);
  const generatedValue = generated.value as { readonly contentHash: string; readonly byteLength: number; readonly path: string };
  assert.match(generatedValue.contentHash, /^[a-f0-9]{64}$/);
  assert.ok(generatedValue.byteLength > 0);
  assert.equal(generatedValue.path, "/workspace/report.docx");
  const stored = files.get(generatedValue.path);
  if (!stored) throw new Error("generated file was not stored");
  assert.equal(Buffer.from(stored.subarray(0, 2)).toString(), "PK");
  assert.doesNotMatch(JSON.stringify(generated), /UEsDB/, "raw OOXML never reaches the tool result");

  const parsed = await tool(tools, "office_parse").execute({ kind: "doc", path: "report.docx" }, context);
  assert.equal(parsed.metadata?.trust, "untrusted_external");
  assert.equal((parsed.value as { readonly model: { readonly title?: string } }).model.title, "Quarterly report");

  const artifact = await generate.execute({ model: model as unknown as JsonObject, format: "docx", artifact: true }, context);
  assert.equal(artifact.error, undefined);
  assert.ok(bodies.has("office-call-1"));

  const escaped = await generate.execute({ model: model as unknown as JsonObject, format: "docx", outputPath: "../outside.docx" }, context);
  assert.match(escaped.error?.message ?? "", /escapes/);

  const capped = createOfficeTools({ caps: { maxBytes: 4 } });
  const oversized = await tool(capped, "office_parse").execute({ kind: "doc", bytesBase64: "AAAAAAAAAAAA" }, context);
  assert.match(oversized.error?.message ?? "", /bytesBase64 exceeds the 4 byte limit/);
});
