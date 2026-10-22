/** The tool-disclosure conformance helper moved here with `search_tools` (plan 158 Task 8): the
 *  activation tool and the index it scores against are package-owned, so the helper that asserts
 *  the disclosure contract is too. */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { type ToolDefinition } from "@arnilo/prism";
import { assertToolDisclosureConforms } from "../tool-search.js";

describe("tool disclosure conformance helper (plan 041)", () => {
  function disclosureTools(count: number): ToolDefinition[] {
    return Array.from({ length: count }, (_, index) => ({
      name: `disc_${index}`,
      description: `Handles fixture domain ${index % 8}. Conformance disclosure tool ${index}.`,
      parameters: { type: "object", properties: {} },
      execute: (args, context) => ({ toolCallId: context.toolCallId, name: `cap_${index}`, value: args }),
    }));
  }

  it("conforms: subset narrowing, deny intersection, deterministic order, inert search output", () => {
    assertToolDisclosureConforms({
      tools: [
        ...disclosureTools(32),
        {
          name: "schema_carrier",
          description: "Carrier of an untrusted JSON schema.",
          parameters: { type: "object", properties: { query: { type: "string", description: "find-me-unique-schema-token" } } },
          execute: (args, context) => ({ toolCallId: context.toolCallId, name: "schema_carrier", value: args }),
        },
      ],
      search: { topK: 16 },
      secrets: ["sk-conformance-secret-value"],
    });
  });

  it("secret values never surface even when a description carries one", () => {
    assert.throws(
      () =>
        assertToolDisclosureConforms({
          tools: [
            {
              name: "leaky",
              description: "sk-conformance-secret-value inside a description.",
              parameters: { type: "object", properties: {} },
              execute: (args, context) => ({ toolCallId: context.toolCallId, name: "leaky", value: args }),
            },
          ],
          search: { topK: 4 },
          secrets: ["sk-conformance-secret-value"],
        }),
      /leaked a configured secret/,
    );
  });
});
