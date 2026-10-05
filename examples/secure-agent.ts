import { createMemoryCheckpointStore, createSecretRedactor, createSecureAgent, createStaticTrustPolicy, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { createJsonSchemaArgumentValidator } from "@arnilo/prism-core/validation/json-schema";

// Network-free secure baseline. Tool calls suspend before side effects.
export async function demo() {
  const agent = await createSecureAgent({
    id: "secure-demo",
    model: { provider: "mock", model: "demo" },
    packages: [mockProvider([[providerTextDelta("safe"), providerDone()]])],
    tools: [
      {
        name: "notes/read",
        parameters: { type: "object" },
        execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "notes/read", value: "ok" }),
      },
    ],
    toolArgumentValidator: createJsonSchemaArgumentValidator(),
    redactor: createSecretRedactor(["fake-secret"]),
    trust: createStaticTrustPolicy(true),
    ownership: { tenantId: "demo", userId: "operator" },
    limits: { maxTurns: 2, maxToolCalls: 1 },
    definitionRevision: "1",
    runState: { checkpoints: createMemoryCheckpointStore() },
  });
  return (await agent.session()).run("hello");
}
