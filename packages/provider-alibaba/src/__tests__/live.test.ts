import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alibabaBody, createAlibabaEmbedder, defineAlibabaModel } from "../index.js";

// Opt-in live probe against the real DashScope compatible-mode endpoint.
// Runs only when PRISM_LIVE_DASHSCOPE_KEY is set; otherwise the whole suite
// skips (mirrors the PRISM_TEST_POSTGRES_URL precedent). Never part of CI.
const apiKey = process.env.PRISM_LIVE_DASHSCOPE_KEY;
const model = process.env.PRISM_LIVE_DASHSCOPE_MODEL ?? "text-embedding-v4";
if (!apiKey) console.log("skip: PRISM_LIVE_DASHSCOPE_KEY not set; live probe skipped");
const describeLive = apiKey ? describe : describe.skip;

describeLive("alibaba live probe (PRISM_LIVE_DASHSCOPE_KEY)", () => {
  it("embeddings round-trip returns one vector per input at the configured dimension", async () => {
    const embedder = createAlibabaEmbedder({ apiKey, model });
    const vectors = await embedder.embed(["hello", "world"]);
    assert.equal(vectors.length, 2);
    for (const vector of vectors) assert.equal(vector.length, embedder.dimensions);
  });

  it("video file blocks serialize to video_url parts", () => {
    const body = alibabaBody({
      model: defineAlibabaModel({ model: "qwen-vl-max", capabilities: { input: ["text", "image", "file"] } }),
      messages: [
        {
          role: "user",
          content: [{ type: "file", mediaType: "video/mp4", url: "https://example.com/clip.mp4" }],
        },
      ],
    });
    assert.deepEqual((body.messages as any[])[0].content[0], {
      type: "video_url",
      video_url: { url: "https://example.com/clip.mp4" },
    });
  });
});
