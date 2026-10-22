/**
 * Ported from `packages/ag-ui/src/__tests__/acp-prompt-content.test.ts` (plan 161 Task 3).
 * `projectAcpPrompt` unit coverage: baseline text + resource_link; image/audio/embedded
 * gated on advertisement and live policy; bounded parts and bytes; malformed input fails closed.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { type AcpPromptOptions, projectAcpPrompt } from "../index.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB").toString("base64");
const WAV = Buffer.from("RIFFxxxxWAVEfmt").toString("base64");

type Block = { readonly type: string; readonly [key: string]: unknown };
/** ACP prompt blocks are wider than `{ type }`; the caller owns their real shape. */
const prompt = (...blocks: Block[]): readonly { readonly type: string }[] => blocks;

const base: AcpPromptOptions = {
  maxBlocks: 32,
  maxTextBytes: 64 * 1024,
  maxMediaParts: 16,
  maxMediaBytes: 64 * 1024,
  capabilities: { image: true, audio: true, embeddedContext: true },
  policy: { media: () => true, embedded: () => true },
};

function options(overrides: Partial<AcpPromptOptions> = {}): AcpPromptOptions {
  return { ...base, ...overrides };
}

function rejectsWith(promise: Promise<unknown>, text: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => {
    assert.ok(String((error as Error).message).includes(text), String(error));
    return true;
  });
}

describe("projectAcpPrompt", () => {
  it("forwards text plus image and audio blocks as bounded media parts", async () => {
    const projected = await projectAcpPrompt(
      prompt(
        { type: "text", text: "see " },
        { type: "image", mimeType: "image/png", data: PNG },
        { type: "audio", mimeType: "audio/wav", data: WAV },
      ),
      options(),
    );
    assert.equal(projected.text, "see ");
    assert.deepEqual(
      projected.media?.map((part) => part.type),
      ["image", "audio"],
    );
    assert.equal(projected.media?.[0]?.mediaType, "image/png");
    assert.equal(projected.media?.[0]?.data, PNG);
  });

  it("accepts resource_link and embedded text/blobs", async () => {
    const projected = await projectAcpPrompt(
      prompt(
        { type: "resource_link", name: "docs", uri: "file:///docs" },
        { type: "resource", resource: { uri: "file:///r.txt", text: "hello" } },
        { type: "resource", resource: { uri: "file:///r.bin", blob: PNG, mimeType: "image/png" } },
      ),
      options(),
    );
    assert.match(projected.text, /\[resource_link: docs \(file:\/\/\/docs\)\]/);
    assert.match(projected.text, /\[resource: file:\/\/\/r.txt\]\nhello/);
    assert.equal(projected.media?.[0]?.type, "file");
    assert.equal(projected.media?.[0]?.mediaType, "image/png");
    assert.equal(projected.media?.[0]?.data, PNG);
  });

  it("rejects image/audio/embedded without the advertisement", async () => {
    const none = options({ capabilities: { image: false, audio: false, embeddedContext: false } });
    await rejectsWith(projectAcpPrompt(prompt({ type: "image", mimeType: "image/png", data: PNG }), none), "promptCapabilities.image");
    await rejectsWith(projectAcpPrompt(prompt({ type: "audio", mimeType: "audio/wav", data: WAV }), none), "promptCapabilities.audio");
    await rejectsWith(
      projectAcpPrompt(prompt({ type: "resource", resource: { uri: "file:///r", text: "x" } }), none),
      "promptCapabilities.embeddedContext",
    );
  });

  it("rejects media when the live host policy denies", async () => {
    await rejectsWith(
      projectAcpPrompt(prompt({ type: "image", mimeType: "image/png", data: PNG }), options({ policy: { media: () => false } })),
      "host media policy denied",
    );
    await rejectsWith(
      projectAcpPrompt(
        prompt({ type: "resource", resource: { uri: "file:///r", text: "x" } }),
        options({ policy: { embedded: () => false } }),
      ),
      "host embedded policy denied",
    );
  });

  it("bounds media parts and bytes before any provider call", async () => {
    const parts = prompt(...Array.from({ length: 17 }, () => ({ type: "image", mimeType: "image/png", data: PNG })));
    await rejectsWith(projectAcpPrompt(parts, options()), "media parts exceed");

    const big = Buffer.alloc(70 * 1024, 1).toString("base64");
    await rejectsWith(projectAcpPrompt(prompt({ type: "image", mimeType: "image/png", data: big }), options()), "byte limit");
  });

  it("rejects malformed MIME and base64 payloads", async () => {
    await rejectsWith(projectAcpPrompt(prompt({ type: "image", mimeType: "text/plain", data: PNG }), options()), "invalid mimeType");
    await rejectsWith(
      projectAcpPrompt(prompt({ type: "image", mimeType: "image/png", data: "not-base64!" }), options()),
      "not valid base64",
    );
  });

  it("bounds text bytes and block counts", async () => {
    await rejectsWith(projectAcpPrompt(prompt({ type: "text", text: "x".repeat(70 * 1024) }), options()), "text exceeds");
    await rejectsWith(projectAcpPrompt(prompt({ type: "text", text: "a" }), options({ maxBlocks: 0 })), "block count exceeds");
    await rejectsWith(projectAcpPrompt(prompt({ type: "nope" }), options()), "unsupported block type");
  });

  it("omits media when the prompt has none", async () => {
    const projected = await projectAcpPrompt(prompt({ type: "text", text: "go" }), options());
    assert.equal(projected.text, "go");
    assert.equal(projected.media, undefined);
  });
});
