import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createVertexProvider, createVertexProviderPackage, vertexOpenApiBaseUrl } from "../index.js";

describe("@arnilo/prism-provider-vertex", () => {
  it("preserves location/project endpoint and uses ADC bearer token", async () => {
    const seen: { url?: string; auth?: string } = {};
    const provider = createVertexProvider({
      projectId: "proj-1",
      location: "europe-west1",
      credential: async () => "adc-token",
      fetch: async (input, init) => {
        seen.url = String(input);
        seen.auth = new Headers(init?.headers).get("authorization") ?? undefined;
        return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    const events = [];
    for await (const event of provider.generate({
      model: { provider: "vertex", model: "google/gemini-2.0-flash-001" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }))
      events.push(event);
    assert.equal(
      seen.url,
      "https://europe-west1-aiplatform.googleapis.com/v1/projects/proj-1/locations/europe-west1/endpoints/openapi/chat/completions",
    );
    assert.equal(seen.auth, "Bearer adc-token");
    assert.ok(events.some((event) => event.type === "done"));
  });

  it("fails closed without credential and keeps custom endpoint host", async () => {
    const missing = createVertexProvider({
      projectId: "p",
      location: "us-central1",
      credential: async () => undefined,
      fetch: async () => {
        throw new Error("should not fetch");
      },
    });
    const events = [];
    for await (const event of missing.generate({
      model: { provider: "vertex", model: "m" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }))
      events.push(event);
    assert.equal(events[0]?.type, "error");

    let url = "";
    const custom = createVertexProvider({
      projectId: "p",
      location: "us-central1",
      endpoint: "https://vertex.private.example/v1/openai",
      credential: "tok",
      fetch: async (input) => {
        url = String(input);
        return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
      },
    });
    for await (const _ of custom.generate({
      model: { provider: "vertex", model: "m" },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })) {
      /* drain */
    }
    assert.equal(url, "https://vertex.private.example/v1/openai/chat/completions");
    assert.equal(
      vertexOpenApiBaseUrl({ projectId: "p", location: "us-central1" }),
      "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/endpoints/openapi",
    );
  });

  it("package stays separate from consumer google and has no runtime deps", () => {
    const pkg = createVertexProviderPackage({
      projectId: "p",
      location: "us-central1",
      credential: () => "t",
    });
    assert.equal(pkg.name, "@arnilo/prism-provider-vertex");
    assert.notEqual(pkg.name, "@arnilo/prism-provider-google");
    const google = readFileSync(new URL("../../../provider-google/src/index.ts", import.meta.url), "utf8");
    assert.ok(!google.includes("provider-vertex"));
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    assert.deepEqual(manifest.dependencies ?? {}, {});
  });
});
