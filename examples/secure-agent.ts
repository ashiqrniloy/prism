import {
  createAgent,
  createSecretRedactor,
  createStaticTrustPolicy,
  createToolParameterValidator,
  type JsonSchema,
  providerDone,
  providerTextDelta,
  validateJsonSchema,
} from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import governance from "@arnilo/prism-governance";

// Network-free secure baseline (plan 159 Task 7). `createSecureAgent` is gone; the same guarantees
// are explicit `AgentConfig` fields plus `governance({ require: { principal, ownership } })`, which
// fails a run closed when the session has no principal. A deny-by-default policy admits only the
// listed tool, so a tool call suspends/denies before any side effect.
export async function demo() {
  const agent = await createAgent({
    id: "secure-demo",
    model: { provider: "mock", model: "demo" },
    principal: { kind: "user", id: "operator" },
    ownership: { tenantId: "demo", userId: "operator" },
    redactor: createSecretRedactor(["fake-secret"]),
    trust: createStaticTrustPolicy(true),
    validator: createToolParameterValidator(
      {
        validate(schema: JsonSchema, value: unknown) {
          const result = validateJsonSchema(schema, value);
          return result.ok ? { ok: true } : { ok: false, errors: result.errors };
        },
      },
      { missingSchema: "reject" },
    ),
    limits: { maxTurns: 2, maxToolCalls: 1 },
    tools: {
      add: [
        {
          name: "notes/read",
          parameters: { type: "object" },
          execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "notes/read", value: "ok" }),
        },
      ],
    },
    packages: [
      mockProvider([[providerTextDelta("safe"), providerDone()]]),
      governance({
        default: "deny",
        rules: [{ tools: ["notes/read"], outcome: "allow" }],
        require: { principal: true, ownership: true },
      }),
    ],
  });
  return (await agent.session()).run("hello");
}
