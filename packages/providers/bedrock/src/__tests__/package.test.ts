import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createAgent, type ModelConfig, type ProviderRequest } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { providerConformance } from "@arnilo/prism/provider-kit";
import bedrockDefinition, {
  BEDROCK_DEFAULT_ACCESS_KEY_ID_REF,
  BEDROCK_DEFAULT_SECRET_ACCESS_KEY_REF,
  BEDROCK_DEFAULT_SESSION_TOKEN_REF,
  bedrock,
  bedrockRuntimeEndpoint,
  createBedrockProvider,
  type SignAwsRequestInput,
} from "../index.js";

const UNSET_REF = "env:PRISM_TEST_UNSET_BEDROCK_KEY";

const model: ModelConfig = { provider: "bedrock", model: "anthropic.claude-sonnet-4-5-20250929-v1:0" };

const request: ProviderRequest = {
  model,
  messages: [
    { role: "system", content: [{ type: "text", text: "instructions" }] },
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ],
};

/** Deterministic stand-in for SigV4: keeps the caller/provider headers and stamps a fixed authorization. */
function fakeSigner(input: SignAwsRequestInput): Record<string, string> {
  return { ...input.headers, authorization: "AWS4-HMAC-SHA256 Credential=test" };
}

function sse(events: readonly object[]): ReadableStream<Uint8Array> {
  const text = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function ok(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function completion(): ReadableStream<Uint8Array> {
  return sse([
    {
      choices: [{ delta: { content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ]);
}

describe("@arnilo/prism-provider-bedrock package", () => {
  it("bedrock_passes_package_conformance", async () => {
    const result = await packageConformance(bedrockDefinition, {
      config: {
        region: "us-east-1",
        accessKeyId: "env:PRISM_TEST_BEDROCK_CONFORMANCE_KEY",
        secretAccessKey: "env:PRISM_TEST_BEDROCK_CONFORMANCE_SECRET",
      },
    });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("bedrock_passes_provider_conformance", async () => {
    const secret = "aws-secret-canary-key-should-not-surface";
    let captured: Headers | undefined;
    const fetchImpl = (async (_input: unknown, init: RequestInit) => {
      captured = new Headers(init.headers);
      return ok(completion());
    }) as typeof fetch;
    await providerConformance(
      () =>
        createBedrockProvider({
          region: "us-east-1",
          credential: { accessKeyId: "AKIATEST", secretAccessKey: secret },
          fetch: fetchImpl,
          signRequest: fakeSigner,
        }),
      {
        request,
        secrets: [secret],
        headers: {
          owned: { "content-type": "application/json", authorization: "AWS4-HMAC-SHA256 Credential=test" },
          caller: { authorization: "hijack", "content-type": "text/plain", "x-trace": "1" },
          captured: () => captured,
        },
        expect: { text: "hello" },
      },
    );
  });

  it("bedrock_default_refs_are_secret_refs", () => {
    assert.equal(BEDROCK_DEFAULT_ACCESS_KEY_ID_REF, "env:AWS_ACCESS_KEY_ID");
    assert.equal(BEDROCK_DEFAULT_SECRET_ACCESS_KEY_REF, "env:AWS_SECRET_ACCESS_KEY");
    assert.equal(BEDROCK_DEFAULT_SESSION_TOKEN_REF, "env:AWS_SESSION_TOKEN");
    assert.equal(bedrockDefinition.config?.properties?.accessKeyId?.default, BEDROCK_DEFAULT_ACCESS_KEY_ID_REF);
    assert.equal(bedrockDefinition.config?.properties?.secretAccessKey?.default, BEDROCK_DEFAULT_SECRET_ACCESS_KEY_REF);
    assert.equal(bedrockDefinition.config?.properties?.accessKeyId?.["x-prism-secret"], true);
    assert.equal(bedrockDefinition.config?.properties?.secretAccessKey?.["x-prism-secret"], true);
    assert.equal(bedrockDefinition.config?.properties?.sessionToken?.["x-prism-secret"], true);
  });

  it("bedrock_missing_credentials_note_status_and_still_register_the_provider", async () => {
    const agent = await createAgent({
      model,
      packages: [
        bedrock({ region: "us-east-1", accessKeyId: UNSET_REF, secretAccessKey: `${UNSET_REF}_SECRET`, sessionToken: `${UNSET_REF}_TOKEN` }),
      ],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.level === "warn" && note.message.startsWith("bedrock: no "));
      assert.equal(notes.length, 2, "one note per unresolved half, none for the optional session token");
      assert.ok(notes.some((note) => note.message === `bedrock: no accessKeyId at ${UNSET_REF}`));
      assert.ok(notes.some((note) => note.message === `bedrock: no secretAccessKey at ${UNSET_REF}_SECRET`));
      const session = await agent.session();
      const result = await session.run("hi");
      assert.equal(result.status, "failed");
      assert.equal((result as { error?: { code?: string } }).error?.code, "credential_unavailable");
    } finally {
      await agent.dispose();
    }
  });

  it("bedrock_literal_credentials_fail_config_validation", async () => {
    await assert.rejects(
      () => createAgent({ model, packages: [bedrock({ region: "us-east-1", accessKeyId: "AKIALITERAL", secretAccessKey: "env:PRISM_TEST_BEDROCK_SECRET" })] }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
    await assert.rejects(
      () => createAgent({ model, packages: [bedrock({ region: "us-east-1", accessKeyId: "env:PRISM_TEST_BEDROCK_KEY", secretAccessKey: "literal-secret" })] }),
      (error: { code?: string }) => error.code === "secret_literal",
    );
  });

  it("bedrock_requires_region", async () => {
    await assert.rejects(() => createAgent({ model, packages: [bedrock({})] }), /config needs region/);
    assert.throws(() => bedrockRuntimeEndpoint(""), /region is required/);
  });

  it("bedrock_package_registers_its_provider_and_setup_does_not_fetch", async () => {
    const previousKey = process.env.PRISM_TEST_BEDROCK_KEY;
    const previousSecret = process.env.PRISM_TEST_BEDROCK_SECRET;
    process.env.PRISM_TEST_BEDROCK_KEY = "AKIATEST";
    process.env.PRISM_TEST_BEDROCK_SECRET = "prism-test-bedrock-secret";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model,
      packages: [
        bedrock({
          region: "us-east-1",
          accessKeyId: "env:PRISM_TEST_BEDROCK_KEY",
          secretAccessKey: "env:PRISM_TEST_BEDROCK_SECRET",
          fetch: fetchImpl,
          signRequest: fakeSigner,
        }),
      ],
    });
    try {
      assert.equal(fetches, 0, "setup must not fetch");
      const session = await agent.session();
      await session.run("hi").catch(() => undefined);
      assert.ok(fetches > 0, "a run reaches the vendor transport");
      assert.equal(
        agent.inspect().statusNotes.some((note) => note.message.includes("no accessKeyId")),
        false,
        "a resolvable ref records no warning",
      );
    } finally {
      await agent.dispose();
      if (previousKey === undefined) delete process.env.PRISM_TEST_BEDROCK_KEY;
      else process.env.PRISM_TEST_BEDROCK_KEY = previousKey;
      if (previousSecret === undefined) delete process.env.PRISM_TEST_BEDROCK_SECRET;
      else process.env.PRISM_TEST_BEDROCK_SECRET = previousSecret;
    }
  });

  it("bedrock_models_returns_the_configured_catalog_without_fetching", async () => {
    const previousKey = process.env.PRISM_TEST_BEDROCK_KEY;
    const previousSecret = process.env.PRISM_TEST_BEDROCK_SECRET;
    process.env.PRISM_TEST_BEDROCK_KEY = "AKIATEST";
    process.env.PRISM_TEST_BEDROCK_SECRET = "prism-test-bedrock-secret";
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      return ok(completion());
    }) as typeof fetch;
    const agent = await createAgent({
      model,
      packages: [
        bedrock({
          region: "us-east-1",
          accessKeyId: "env:PRISM_TEST_BEDROCK_KEY",
          secretAccessKey: "env:PRISM_TEST_BEDROCK_SECRET",
          fetch: fetchImpl,
          signRequest: fakeSigner,
          models: [model],
        }),
      ],
    });
    try {
      const listed = await agent.models.list();
      assert.equal(fetches, 0, "a static catalog never fetches");
      assert.ok(listed.some((entry) => entry.model === model.model));
    } finally {
      await agent.dispose();
      if (previousKey === undefined) delete process.env.PRISM_TEST_BEDROCK_KEY;
      else process.env.PRISM_TEST_BEDROCK_KEY = previousKey;
      if (previousSecret === undefined) delete process.env.PRISM_TEST_BEDROCK_SECRET;
      else process.env.PRISM_TEST_BEDROCK_SECRET = previousSecret;
    }
  });

  it("bedrock_provider_resolves_its_model_without_a_host_provider", async () => {
    const previousKey = process.env.PRISM_TEST_BEDROCK_KEY;
    const previousSecret = process.env.PRISM_TEST_BEDROCK_SECRET;
    process.env.PRISM_TEST_BEDROCK_KEY = "AKIATEST";
    process.env.PRISM_TEST_BEDROCK_SECRET = "prism-test-bedrock-secret";
    let url = "";
    const agent = await createAgent({
      model,
      packages: [
        bedrock({
          region: "us-east-1",
          accessKeyId: "env:PRISM_TEST_BEDROCK_KEY",
          secretAccessKey: "env:PRISM_TEST_BEDROCK_SECRET",
          fetch: (async (input) => {
            url = String(input);
            return ok(completion());
          }) as typeof fetch,
          signRequest: fakeSigner,
        }),
      ],
    });
    try {
      const session = await agent.session();
      await session.run("hi").catch(() => undefined);
      assert.equal(url, "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions");
    } finally {
      await agent.dispose();
      if (previousKey === undefined) delete process.env.PRISM_TEST_BEDROCK_KEY;
      else process.env.PRISM_TEST_BEDROCK_KEY = previousKey;
      if (previousSecret === undefined) delete process.env.PRISM_TEST_BEDROCK_SECRET;
      else process.env.PRISM_TEST_BEDROCK_SECRET = previousSecret;
    }
  });

  it("bedrock_converse_route_uses_the_native_endpoint", async () => {
    const previousKey = process.env.PRISM_TEST_BEDROCK_KEY;
    const previousSecret = process.env.PRISM_TEST_BEDROCK_SECRET;
    process.env.PRISM_TEST_BEDROCK_KEY = "AKIATEST";
    process.env.PRISM_TEST_BEDROCK_SECRET = "prism-test-bedrock-secret";
    let url = "";
    const agent = await createAgent({
      model,
      packages: [
        bedrock({
          region: "eu-west-1",
          api: "converse",
          accessKeyId: "env:PRISM_TEST_BEDROCK_KEY",
          secretAccessKey: "env:PRISM_TEST_BEDROCK_SECRET",
          fetch: (async (input) => {
            url = String(input);
            return ok(completion());
          }) as typeof fetch,
          signRequest: fakeSigner,
        }),
      ],
    });
    try {
      const session = await agent.session();
      await session.run("hi").catch(() => undefined);
      assert.equal(url, `https://bedrock-runtime.eu-west-1.amazonaws.com/model/${encodeURIComponent(model.model)}/converse-stream`);
    } finally {
      await agent.dispose();
      if (previousKey === undefined) delete process.env.PRISM_TEST_BEDROCK_KEY;
      else process.env.PRISM_TEST_BEDROCK_KEY = previousKey;
      if (previousSecret === undefined) delete process.env.PRISM_TEST_BEDROCK_SECRET;
      else process.env.PRISM_TEST_BEDROCK_SECRET = previousSecret;
    }
  });

  it("bedrock_signing_secret_never_leaks", async () => {
    const secret = "aws-secret-canary-key-should-not-surface";
    const previousKey = process.env.PRISM_TEST_BEDROCK_CANARY_KEY;
    const previousSecret = process.env.PRISM_TEST_BEDROCK_CANARY_SECRET;
    process.env.PRISM_TEST_BEDROCK_CANARY_KEY = "AKIACANARY";
    process.env.PRISM_TEST_BEDROCK_CANARY_SECRET = secret;
    const agent = await createAgent({
      model,
      packages: [
        bedrock({
          region: "us-east-1",
          accessKeyId: "env:PRISM_TEST_BEDROCK_CANARY_KEY",
          secretAccessKey: "env:PRISM_TEST_BEDROCK_CANARY_SECRET",
          fetch: (async () => ok(completion())) as typeof fetch,
          signRequest: fakeSigner,
        }),
      ],
    });
    try {
      const session = await agent.session();
      const events: unknown[] = [];
      const reader = (async () => {
        for await (const event of session.subscribe()) events.push(event);
      })();
      await session.run("hi").catch(() => undefined);
      await reader;
      const surface = JSON.stringify(agent.inspect()) + JSON.stringify(events);
      assert.equal(surface.includes(secret), false, "the signing secret must never surface");
      assert.equal(surface.includes("AKIACANARY"), false, "the access key id joins the redaction set too");
    } finally {
      await agent.dispose();
      if (previousKey === undefined) delete process.env.PRISM_TEST_BEDROCK_CANARY_KEY;
      else process.env.PRISM_TEST_BEDROCK_CANARY_KEY = previousKey;
      if (previousSecret === undefined) delete process.env.PRISM_TEST_BEDROCK_CANARY_SECRET;
      else process.env.PRISM_TEST_BEDROCK_CANARY_SECRET = previousSecret;
    }
  });
});
