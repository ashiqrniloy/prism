import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSecretRedactor,
  type JsonObject,
  type ToolDefinition,
  type ToolEffectDeclaration,
  type ToolExecutionContext,
} from "@arnilo/prism";
import { createOpenApiTools, OpenApiToolError } from "../index.js";

const DOC: JsonObject = {
  openapi: "3.1.0",
  info: { title: "test", version: "1.0.0" },
  servers: [{ url: "https://api.example.com/v1" }],
  paths: {
    "/customers/{id}": {
      get: {
        operationId: "getCustomer",
        summary: "Get customer",
        description: "Fetches one customer.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "verbose", in: "query", schema: { type: "boolean" } },
          { name: "X-Trace", in: "header", schema: { type: "string" } },
        ],
        responses: { "200": { description: "ok" } },
      },
    },
    "/customers": {
      post: {
        operationId: "createCustomer",
        summary: "Create customer",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Customer" } } },
        },
        responses: { "201": { description: "created" } },
      },
    },
  },
  components: {
    schemas: {
      Customer: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
};

function makeTools(overrides: Partial<Parameters<typeof createOpenApiTools>[0]> = {}): readonly ToolDefinition[] {
  return createOpenApiTools({
    document: DOC,
    operations: ["getCustomer", "createCustomer"],
    server: "https://api.example.com",
    ...overrides,
  });
}

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(
      handler(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init ?? {}),
    )) as typeof fetch;
}

function context(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: "t1", ...overrides };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function throwsCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof OpenApiToolError, `expected OpenApiToolError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

function errorCode(promise: Promise<unknown> | unknown): Promise<string> {
  return Promise.resolve(promise).then(
    () => Promise.reject(new Error("expected rejection")),
    (error: unknown) => {
      assert.ok(error instanceof OpenApiToolError, `expected OpenApiToolError, got ${String(error)}`);
      return error.code;
    },
  );
}

describe("createOpenApiTools compile", () => {
  it("compiles only allow-listed operations with effects and resolved schemas", () => {
    const tools = makeTools();
    assert.deepEqual(
      tools.map((t) => t.name),
      ["getCustomer", "createCustomer"],
    );
    const get = tools[0];
    const getEffect = get.effect as ToolEffectDeclaration | undefined;
    assert.equal(getEffect?.kind, "none");
    assert.equal(getEffect?.idempotency, "none");
    assert.match(get.description ?? "", /Get customer/);
    const params = get.parameters as JsonObject;
    assert.deepEqual(Object.keys(params.properties as Record<string, unknown>).sort(), ["X-Trace", "id", "verbose"]);
    assert.deepEqual(params.required, ["id"]);
    assert.equal(params.additionalProperties, false);
    const post = tools[1];
    const postEffect = post.effect as ToolEffectDeclaration | undefined;
    assert.equal(postEffect?.kind, "external_mutation");
    assert.equal(postEffect?.idempotency, "required");
    const body = (post.parameters as Record<string, unknown>).properties as JsonObject;
    assert.deepEqual(body.body, {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    });
  });

  it("rejects unknown operationIds", () => {
    assert.throws(
      () => makeTools({ operations: ["nope"] }),
      (error: unknown) => {
        assert.ok(error instanceof OpenApiToolError);
        assert.equal(error.code, "ERR_PRISM_OPENAPI_OPERATION_UNKNOWN");
        return true;
      },
    );
  });

  it("rejects server drift at document, path, and operation level", () => {
    const drifted = structuredClone(DOC);
    (drifted as Record<string, unknown>).servers = [{ url: "https://other.example.com" }];
    throwsCode(() => makeTools({ document: drifted }), "ERR_PRISM_OPENAPI_SERVER_DRIFT");

    const pathDrift = structuredClone(DOC);
    ((pathDrift.paths as Record<string, unknown>)["/customers/{id}"] as Record<string, unknown>).servers = [
      { url: "https://other.example.com" },
    ];
    throwsCode(() => makeTools({ document: pathDrift }), "ERR_PRISM_OPENAPI_SERVER_DRIFT");

    const opDrift = structuredClone(DOC);
    (((opDrift.paths as Record<string, unknown>)["/customers"] as Record<string, unknown>).post as Record<string, unknown>).servers = [
      { url: "https://other.example.com" },
    ];
    throwsCode(() => makeTools({ document: opDrift }), "ERR_PRISM_OPENAPI_SERVER_DRIFT");
  });

  it("accepts relative document server URLs resolving to the pinned origin", () => {
    const relative = structuredClone(DOC);
    (relative as Record<string, unknown>).servers = [{ url: "/v1" }];
    const tools = makeTools({ document: relative });
    assert.equal(tools.length, 2);
  });

  it("rejects hostile schemas: cycles, depth, ref count, external and unresolvable refs", () => {
    const cycle = structuredClone(DOC);
    (cycle.components as Record<string, unknown>).schemas = { A: { $ref: "#/components/schemas/A" } };
    ((cycle.paths as Record<string, unknown>)["/customers"] as Record<string, unknown>).post = {
      operationId: "createCustomer",
      requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/A" } } } },
      responses: {},
    };
    throwsCode(() => makeTools({ document: cycle }), "ERR_PRISM_OPENAPI_SCHEMA_BOUNDS");

    const deep = structuredClone(DOC);
    let nested: JsonObject = { type: "string" };
    for (let i = 0; i < 40; i++) nested = { type: "object", properties: { next: nested } };
    (deep.components as Record<string, unknown>).schemas = { Deep: nested };
    ((deep.paths as Record<string, unknown>)["/customers"] as Record<string, unknown>).post = {
      operationId: "createCustomer",
      requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Deep" } } } },
      responses: {},
    };
    throwsCode(() => makeTools({ document: deep }), "ERR_PRISM_OPENAPI_SCHEMA_BOUNDS");

    const manyRefs = structuredClone(DOC);
    const schemas: Record<string, unknown> = {};
    for (let i = 0; i < 1100; i++) schemas[`S${i}`] = { $ref: `#/components/schemas/S${i + 1}` };
    schemas.S1100 = { type: "string" };
    (manyRefs.components as Record<string, unknown>).schemas = schemas;
    ((manyRefs.paths as Record<string, unknown>)["/customers"] as Record<string, unknown>).post = {
      operationId: "createCustomer",
      requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/S0" } } } },
      responses: {},
    };
    throwsCode(() => makeTools({ document: manyRefs }), "ERR_PRISM_OPENAPI_SCHEMA_BOUNDS");

    const external = structuredClone(DOC);
    (external.components as Record<string, unknown>).schemas = { A: { $ref: "https://example.com/schema.json" } };
    ((external.paths as Record<string, unknown>)["/customers"] as Record<string, unknown>).post = {
      operationId: "createCustomer",
      requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/A" } } } },
      responses: {},
    };
    throwsCode(() => makeTools({ document: external }), "ERR_PRISM_OPENAPI_SCHEMA_BOUNDS");

    const missing = structuredClone(DOC);
    ((missing.paths as Record<string, unknown>)["/customers"] as Record<string, unknown>).post = {
      operationId: "createCustomer",
      requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Missing" } } } },
      responses: {},
    };
    throwsCode(() => makeTools({ document: missing }), "ERR_PRISM_OPENAPI_SCHEMA_BOUNDS");
  });

  it("bounds the document: bytes, JSON validity, version, operation count, limits", () => {
    throwsCode(() => makeTools({ document: JSON.stringify(DOC), limits: { maxDocumentBytes: 100 } }), "ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS");
    throwsCode(() => makeTools({ document: "{not json" }), "ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS");
    const v2 = structuredClone(DOC);
    (v2 as Record<string, unknown>).openapi = "3.0.3";
    throwsCode(() => makeTools({ document: v2 }), "ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS");
    throwsCode(
      () => makeTools({ operations: ["getCustomer", "createCustomer"], limits: { maxOperations: 1 } }),
      "ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS",
    );
    throwsCode(() => makeTools({ limits: { maxRetries: 99 } }), "ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS");
    throwsCode(() => makeTools({ limits: { maxPages: 0 } }), "ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS");
  });

  it("rejects duplicate operationIds and tool-name collisions after sanitization", () => {
    const dup = structuredClone(DOC);
    ((dup.paths as Record<string, unknown>)["/customers/{id}"] as Record<string, unknown>).get = {
      operationId: "createCustomer",
      responses: {},
    };
    throwsCode(() => makeTools({ document: dup }), "ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS");

    const spaced = structuredClone(DOC);
    ((spaced.paths as Record<string, unknown>)["/customers/{id}"] as Record<string, unknown>).get = {
      operationId: "get customer",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {},
    };
    ((spaced.paths as Record<string, unknown>)["/customers"] as Record<string, unknown>).get = {
      operationId: "get_customer",
      responses: {},
    };
    const tools = makeTools({ document: spaced, operations: ["get customer", "createCustomer"] });
    assert.equal(tools[0].name, "get_customer");
    throwsCode(() => makeTools({ document: spaced, operations: ["get customer", "get_customer"] }), "ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS");
  });

  it("rejects cookie parameters, non-JSON bodies, duplicate argument names, and undeclared path params", () => {
    const cookie = structuredClone(DOC);
    ((cookie.paths as Record<string, unknown>)["/customers/{id}"] as Record<string, unknown>).get = {
      operationId: "getCustomer",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "sid", in: "cookie", schema: { type: "string" } },
      ],
      responses: {},
    };
    throwsCode(() => makeTools({ document: cookie }), "ERR_PRISM_OPENAPI_SCHEMA_BOUNDS");

    const multipart = structuredClone(DOC);
    ((multipart.paths as Record<string, unknown>)["/customers"] as Record<string, unknown>).post = {
      operationId: "createCustomer",
      requestBody: { content: { "multipart/form-data": { schema: { type: "object" } } } },
      responses: {},
    };
    throwsCode(() => makeTools({ document: multipart }), "ERR_PRISM_OPENAPI_SCHEMA_BOUNDS");

    const collision = structuredClone(DOC);
    ((collision.paths as Record<string, unknown>)["/customers/{id}"] as Record<string, unknown>).get = {
      operationId: "getCustomer",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "id", in: "query", schema: { type: "string" } },
      ],
      responses: {},
    };
    throwsCode(() => makeTools({ document: collision }), "ERR_PRISM_OPENAPI_SCHEMA_BOUNDS");

    const undeclared = structuredClone(DOC);
    ((undeclared.paths as Record<string, unknown>)["/customers/{id}"] as Record<string, unknown>).get = {
      operationId: "getCustomer",
      parameters: [{ name: "verbose", in: "query", schema: { type: "boolean" } }],
      responses: {},
    };
    throwsCode(() => makeTools({ document: undeclared }), "ERR_PRISM_OPENAPI_SCHEMA_BOUNDS");
  });
});

describe("createOpenApiTools execute", () => {
  it("builds the request URL, headers, and JSON body; returns untrusted result", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const tools = makeTools({
      credentials: () => ({ headers: { authorization: "Bearer s3cret" } }),
      fetch: fakeFetch((url, init) => {
        calls.push({ url, init });
        return jsonResponse(200, { id: 1 });
      }),
    });
    const result = await tools[0].execute({ id: "a b", verbose: true, "X-Trace": "t-1" }, context());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.example.com/customers/a%20b?verbose=true");
    const headers0 = calls[0].init.headers as Record<string, string> | undefined;
    assert.equal(headers0?.["X-Trace"], "t-1");
    assert.equal(headers0?.authorization, "Bearer s3cret");
    assert.equal(calls[0].init.redirect, "manual");
    assert.deepEqual(result.value, { status: 200, body: { id: 1 } });
    const block = result.content?.[0];
    assert.equal(block?.type, "text");
    assert.match(block?.text ?? "", /UNTRUSTED/);

    const post = await tools[1].execute({ body: { name: "Ada" } }, context());
    assert.equal(calls[1].url, "https://api.example.com/customers");
    assert.equal(calls[1].init.method, "POST");
    const headers1 = calls[1].init.headers as Record<string, string> | undefined;
    assert.equal(headers1?.["content-type"], "application/json");
    assert.equal(calls[1].init.body, JSON.stringify({ name: "Ada" }));
    assert.equal((post.value as { status?: number })?.status, 200);
  });

  it("never leaks credential values into output (redactor applied)", async () => {
    const tools = makeTools({
      credentials: () => ({ headers: { authorization: "Bearer s3cret" } }),
      redactor: createSecretRedactor(["s3cret"]),
      fetch: fakeFetch(() => jsonResponse(200, { echo: "s3cret" })),
    });
    const result = await tools[0].execute({ id: "1" }, context());
    assert.doesNotMatch(JSON.stringify(result.value), /s3cret/);
    assert.doesNotMatch(JSON.stringify(result.content), /s3cret/);
  });

  it("bounds hostile response bodies", async () => {
    const tools = makeTools({
      limits: { maxResponseBytes: 64 },
      fetch: fakeFetch(() => jsonResponse(200, { data: "x".repeat(200) })),
    });
    assert.equal(await errorCode(tools[0].execute({ id: "1" }, context())), "ERR_PRISM_OPENAPI_RESPONSE_BOUNDS");
  });

  it("retries 5xx up to maxRetries, never retries 4xx, and fails closed on transport errors", async () => {
    let calls = 0;
    const flaky = makeTools({
      limits: { maxRetries: 2 },
      fetch: fakeFetch(() => {
        calls += 1;
        return calls < 3 ? jsonResponse(503, {}) : jsonResponse(200, { ok: true });
      }),
    });
    const result = await flaky[0].execute({ id: "1" }, context());
    assert.equal(calls, 3);
    assert.equal((result.value as { status?: number })?.status, 200);

    calls = 0;
    const four = makeTools({
      limits: { maxRetries: 2 },
      fetch: fakeFetch(() => {
        calls += 1;
        return jsonResponse(400, {});
      }),
    });
    await four[0].execute({ id: "1" }, context());
    assert.equal(calls, 1);

    calls = 0;
    const down = makeTools({
      limits: { maxRetries: 2 },
      fetch: fakeFetch(() => {
        calls += 1;
        throw new Error("ECONNREFUSED");
      }),
    });
    assert.equal(await errorCode(down[0].execute({ id: "1" }, context())), "ERR_PRISM_OPENAPI_RETRY_EXHAUSTED");
    assert.equal(calls, 3);
  });

  it("paginates with bounded pages and items", async () => {
    const paged = structuredClone(DOC);
    ((paged.paths as Record<string, unknown>)["/customers/{id}"] as Record<string, unknown>).get = {
      operationId: "getCustomer",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "page", in: "query", schema: { type: "string" } },
      ],
      responses: {},
    };
    const calls: string[] = [];
    const tools = makeTools({
      document: paged,
      pagination: { pageParam: "page", pageSizeParam: "limit", pageSize: 2, nextPath: "next", itemsPath: "items" },
      fetch: fakeFetch((url) => {
        calls.push(url);
        return url.includes("page=p2") ? jsonResponse(200, { items: [3] }) : jsonResponse(200, { items: [1, 2], next: "p2" });
      }),
    });
    const result = await tools[0].execute({ id: "1" }, context());
    assert.deepEqual(result.value, { status: 200, pageCount: 2, items: [1, 2, 3] });
    assert.equal(calls.length, 2);
    assert.match(calls[1], /page=p2&limit=2/);
  });

  it("fails closed when pagination exceeds maxPages or maxPaginationItems", async () => {
    const paged = structuredClone(DOC);
    ((paged.paths as Record<string, unknown>)["/customers/{id}"] as Record<string, unknown>).get = {
      operationId: "getCustomer",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "page", in: "query", schema: { type: "string" } },
      ],
      responses: {},
    };
    const endless = makeTools({
      document: paged,
      pagination: { pageParam: "page", nextPath: "next" },
      limits: { maxPages: 2 },
      fetch: fakeFetch(() => jsonResponse(200, { items: [1], next: "p2" })),
    });
    assert.equal(await errorCode(endless[0].execute({ id: "1" }, context())), "ERR_PRISM_OPENAPI_RESPONSE_BOUNDS");

    const many = makeTools({
      document: paged,
      pagination: { pageParam: "page", nextPath: "next" },
      limits: { maxPaginationItems: 1500 },
      fetch: fakeFetch(() => jsonResponse(200, { items: Array.from({ length: 1000 }, (_, i) => i), next: "p2" })),
    });
    assert.equal(await errorCode(many[0].execute({ id: "1" }, context())), "ERR_PRISM_OPENAPI_RESPONSE_BOUNDS");
  });

  it("runs the host policy check before the request and propagates denials", async () => {
    let called = false;
    const tools = makeTools({
      policy: () => {
        called = true;
        throw new Error("denied by host policy");
      },
      fetch: fakeFetch(() => jsonResponse(200, {})),
    });
    await assert.rejects(async () => tools[0].execute({ id: "1" }, context()), /denied by host policy/);
    assert.equal(called, true);
  });

  it("propagates caller aborts without retrying", async () => {
    const controller = new AbortController();
    controller.abort();
    const tools = makeTools({
      limits: { maxRetries: 2 },
      fetch: fakeFetch(() => {
        throw new Error("aborted");
      }),
    });
    await assert.rejects(async () => tools[0].execute({ id: "1" }, context({ signal: controller.signal })), /aborted/);
  });

  it("sends the core idempotency key header only when opted in and only for mutations", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const tools = makeTools({
      idempotencyKeyHeader: true,
      fetch: fakeFetch((url, init) => {
        calls.push({ url, init });
        return jsonResponse(200, {});
      }),
    });
    await tools[0].execute({ id: "1" }, context({ idempotencyKey: "k-1" }));
    const h0 = calls[0].init.headers as Record<string, string> | undefined;
    assert.equal(h0?.["idempotency-key"], undefined);
    await tools[1].execute({ body: { name: "Ada" } }, context({ idempotencyKey: "k-1" }));
    const h1 = calls[1].init.headers as Record<string, string> | undefined;
    assert.equal(h1?.["idempotency-key"], "k-1");

    const off = makeTools({
      fetch: fakeFetch((_url, init) => {
        calls.push({ url: "x", init });
        return jsonResponse(200, {});
      }),
    });
    await off[1].execute({ body: { name: "Ada" } }, context({ idempotencyKey: "k-1" }));
    const h2 = calls[2].init.headers as Record<string, string> | undefined;
    assert.equal(h2?.["idempotency-key"], undefined);
  });

  it("returns text bodies for non-JSON content types", async () => {
    const tools = makeTools({
      fetch: fakeFetch(() => new Response("plain text", { status: 200, headers: { "content-type": "text/plain" } })),
    });
    const result = await tools[0].execute({ id: "1" }, context());
    assert.deepEqual(result.value, { status: 200, body: "plain text" });
  });
});
