import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { type AgentEvent, createAgent } from "@arnilo/prism";
import { mockProvider, packageConformance, providerDone, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import toolsOpenapi from "../index.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/petstore.json", import.meta.url));
const TOKEN_ENV = "PRISM_TEST_OPENAPI_TOKEN";

afterEach(() => {
  delete process.env[TOKEN_ENV];
});

describe("@arnilo/prism-tools-openapi package", () => {
  it("tools_openapi_package_conformance", async () => {
    const result = await packageConformance(toolsOpenapi({ specs: [{ id: "pet", source: FIXTURE }] }));
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("tools_openapi_spec_to_tools_with_effects", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsOpenapi({ specs: [{ id: "pet", source: FIXTURE }] })],
    });
    try {
      assert.deepEqual(agent.tools.map((tool) => tool.name).sort(), ["pet_createPet", "pet_getPet", "pet_listPets"]);
      for (const tool of agent.tools) assert.equal(tool.package, "@arnilo/prism-tools-openapi");
      assert.deepEqual(agent.tools.find((tool) => tool.name === "pet_listPets")?.effects, ["network"]);
      assert.deepEqual(agent.tools.find((tool) => tool.name === "pet_getPet")?.effects, ["network"]);
      assert.deepEqual(agent.tools.find((tool) => tool.name === "pet_createPet")?.effects, ["network", "external"]);
    } finally {
      await agent.dispose();
    }
  });

  it("tools_openapi_bad_spec_skipped_with_note", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [
        toolsOpenapi({
          specs: [
            { id: "bad", source: "/nonexistent/openapi.json" },
            { id: "pet", source: FIXTURE },
          ],
        }),
      ],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.level === "warn");
      assert.ok(
        notes.some((note) => note.message.startsWith("openapi: spec bad skipped:")),
        "the bad spec is noted and skipped",
      );
      assert.deepEqual(
        agent.tools.map((tool) => tool.name).sort(),
        ["pet_createPet", "pet_getPet", "pet_listPets"],
        "the good spec still registers",
      );
    } finally {
      await agent.dispose();
    }
  });

  it("tools_openapi_header_ref_never_echoed", async () => {
    const sentinel = "prism-openapi-canary-7d1f";
    process.env[TOKEN_ENV] = sentinel;
    const g = globalThis as { fetch?: typeof fetch };
    const original = g.fetch;
    // The stub echoes the request's Authorization header into the response body, so only the
    // kernel's credential redaction keeps the value out of the result.
    g.fetch = async (_input, init) => {
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      return new Response(JSON.stringify({ echoed: headers.get("authorization") ?? "" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      const provider = mockProvider([[providerToolCall(toolCallContent("c1", "pet_listPets", {})), providerDone()], [providerDone()]], {
        id: "mock",
      });
      const agent = await createAgent({
        model: { provider: "mock", model: "m" },
        packages: [provider, toolsOpenapi({ specs: [{ id: "pet", source: FIXTURE, headers: { Authorization: `env:${TOKEN_ENV}` } }] })],
      });
      const events: AgentEvent[] = [];
      const subscription = (async () => {
        for await (const event of agent.subscribe()) events.push(event);
      })();
      try {
        const session = await agent.session({ id: "openapi-header", create: true });
        await session.run("list pets");
        await session.close();
        const entries = await session.entries();
        assert.equal(JSON.stringify(agent.inspect()).includes(sentinel), false, "the secret never surfaces in inspect()");
        assert.equal(JSON.stringify(entries).includes(sentinel), false, "the secret never surfaces in tool results");
        assert.equal(JSON.stringify(events).includes(sentinel), false, "the secret never surfaces in events");
        // The call really ran: the result carries the redaction marker instead of the sentinel.
        assert.match(JSON.stringify(entries), /\[REDACTED\]/, "the echoed header was redacted");
      } finally {
        await agent.dispose();
        await subscription;
      }
    } finally {
      g.fetch = original;
    }
  });

  it("tools_openapi_literal_header_rejected", async () => {
    await assert.rejects(
      createAgent({
        model: { provider: "mock", model: "m" },
        packages: [toolsOpenapi({ specs: [{ id: "pet", source: FIXTURE, headers: { Authorization: "literal-not-a-ref" } }] })],
      }),
      /headers/,
    );
  });

  it("tools_openapi_name_collision_fails_closed", async () => {
    await assert.rejects(
      createAgent({
        model: { provider: "mock", model: "m" },
        packages: [
          toolsOpenapi({
            specs: [
              { id: "pet", source: FIXTURE },
              { id: "pet", source: FIXTURE },
            ],
          }),
        ],
      }),
      /already taken|tool_conflict/i,
    );
  });
});
