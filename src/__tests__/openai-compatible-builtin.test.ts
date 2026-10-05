import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgentWith } from "../agent-session/create-agent.js";
import type { AgentConfig, CredentialResolver } from "../index.js";

let stub: typeof fetch | undefined;
const createAgent = (config: AgentConfig) => createAgentWith(config, { fetch: ((...args: Parameters<typeof fetch>) => stub!(...args)) as typeof fetch });

const KEY = "sk-live-canary-0123456789";
const sse = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
const OK = `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;

interface Seen {
  url: string;
  headers: Record<string, string>;
}

function stubFetch(respond: (seen: Seen) => Response): Seen[] {
  const calls: Seen[] = [];
  stub = (async (url: string, init: RequestInit) => {
    const seen = { url: String(url), headers: init.headers as Record<string, string> };
    calls.push(seen);
    return respond(seen);
  }) as never;
  return calls;
}

const env = (values: Record<string, string>): CredentialResolver => ({
  resolve: (ref) => {
    const value = ref.startsWith("env:") ? values[ref.slice(4)] : undefined;
    return value ? { type: "api_key", value } : undefined;
  },
});

describe("built-in openai-compatible provider", () => {
  it("builtin_openai_compatible_reads_base_url_and_credential_per_request", async () => {
    const calls = stubFetch(() => sse(OK));
    const agent = await createAgent({
      model: { provider: "openai-compatible", model: "m", baseUrl: "http://one.test/v1/", credential: "env:KEY_ONE" },
      slots: { credentials: env({ KEY_ONE: "key-one", KEY_TWO: "key-two" }) },
    });
    const session = await agent.session();
    assert.equal((await session.run("a")).status, "completed");
    await session.run("b", { model: { provider: "openai-compatible", model: "m", baseUrl: "http://two.test/api", credential: "env:KEY_TWO" } });
    assert.deepEqual(
      calls.map((call) => [call.url, call.headers.authorization]),
      [
        ["http://one.test/v1/chat/completions", "Bearer key-one"],
        ["http://two.test/api/chat/completions", "Bearer key-two"],
      ],
    );
  });

  it("missing_base_url_fails_closed", async () => {
    const calls = stubFetch(() => sse(OK));
    const agent = await createAgent({ model: { provider: "openai-compatible", model: "m" } });
    const result = await (await agent.session()).run("hi");
    assert.equal(result.status, "failed");
    assert.equal((result as { error?: { code?: string } }).error?.code, "model_ref_invalid");
    assert.equal(calls.length, 0);
  });

  it("unresolvable_credential_fails_run_naming_ref_not_value", async () => {
    const calls = stubFetch(() => sse(OK));
    const agent = await createAgent({
      model: { provider: "openai-compatible", model: "m", baseUrl: "http://one.test/v1", credential: "env:NOT_SET" },
      slots: { credentials: env({}) },
    });
    const session = await agent.session();
    const result = await session.run("hi");
    assert.equal(result.status, "failed");
    const error = (result as { error?: { code?: string; message?: string } }).error;
    assert.equal(error?.code, "credential_unavailable");
    assert.ok(error?.message?.includes("env:NOT_SET"));
    assert.equal(calls.length, 0);
  });

  it("provider_error_echoing_auth_header_is_redacted", async () => {
    stubFetch((seen) => new Response(`upstream rejected ${seen.headers.authorization}`, { status: 400 }));
    const agent = await createAgent({
      model: { provider: "openai-compatible", model: "m", baseUrl: "http://one.test/v1", credential: "env:KEY" },
      slots: { credentials: env({ KEY: KEY }) },
    });
    const result = await (await agent.session()).run("hi");
    assert.equal(result.status, "failed");
    assert.equal(JSON.stringify(result).includes(KEY), false);
    assert.ok(JSON.stringify(result).includes("[REDACTED]"));
  });
});
