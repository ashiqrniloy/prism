import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signAwsRequest } from "../index.js";

const base = {
  method: "POST",
  url: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions",
  body: "{}",
  region: "us-east-1",
  service: "bedrock",
  credentials: { accessKeyId: "AKIATEST", secretAccessKey: "secret" },
  now: new Date("2026-07-23T12:00:00.000Z"),
} as const;

describe("@arnilo/prism-providers/bedrock SigV4 canonicalization", () => {
  it("merges duplicate-case headers last-wins before signing (no duplicate-case mismatch)", () => {
    // T11: {X-Test: a, x-test: b} must canonicalize as a single x-test:b
    // header; the old .find-based canonicalization emitted x-test twice and
    // signed a different request than the one sent.
    const headers = signAwsRequest({
      ...base,
      headers: { "X-Test": "a", "x-test": "b", "content-type": "application/json" },
    });
    assert.equal(headers["x-test"], "b", "last-wins merge");
    assert.equal(headers["X-Test"], undefined, "no duplicate-case key survives");
    const signedHeaders = headers.authorization.match(/SignedHeaders=([^,]+)/)?.[1] ?? "";
    assert.equal(signedHeaders.split(";").filter((name) => name === "x-test").length, 1, "x-test appears exactly once in SignedHeaders");
  });

  it("canonicalizes repeated query parameters by key then value", () => {
    // T11: AWS sorts encoded keys, then encoded values for repeated keys.
    const headers = signAwsRequest({
      ...base,
      url: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions?a=z&a=b&b=1",
      headers: { "content-type": "application/json" },
    });
    const canonical = headers.authorization;
    assert.match(canonical, /Signature=[a-f0-9]{64}/);
    // Determinism check: re-signing the identical input yields the same
    // signature, and reordering input params must not change it.
    const again = signAwsRequest({
      ...base,
      url: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions?b=1&a=b&a=z",
      headers: { "content-type": "application/json" },
    });
    assert.equal(headers.authorization, again.authorization, "query order must not affect the signature");
  });

  it("stays byte-identical for single-case inputs", () => {
    const headers = signAwsRequest({
      ...base,
      headers: { "content-type": "application/json", "X-Amz-Target": "BedrockRuntime.InvokeModel" },
    });
    assert.equal(headers["x-amz-target"], "BedrockRuntime.InvokeModel");
    const signedHeaders = headers.authorization.match(/SignedHeaders=([^,]+)/)?.[1] ?? "";
    assert.ok(signedHeaders.split(";").includes("x-amz-target"), "caller headers are signed");
    assert.equal(signedHeaders.split(";").filter((name) => name === "x-amz-target").length, 1, "no duplicated signed header names");
  });
});
