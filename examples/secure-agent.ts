import {
  createMemoryCheckpointStore,
  createMockProvider,
  createSecureAgent,
  createSecretRedactor,
  createStaticPermissionPolicy,
  createStaticTrustPolicy,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import { createJsonSchemaArgumentValidator } from "@arnilo/prism-tool-validator-json-schema";

// Network-free secure baseline. Tool calls suspend before side effects.
export async function demo() {
  const agent = createSecureAgent({
    id: "secure-demo",
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerTextDelta("safe"), providerDone()]),
    tools: [{ name: "notes/read", parameters: { type: "object" }, execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "notes/read", value: "ok" }) }],
    toolArgumentValidator: createJsonSchemaArgumentValidator(),
    redactor: createSecretRedactor(["fake-secret"]),
    permission: createStaticPermissionPolicy({ allow: ["tool:notes/read:execute"] }),
    trust: createStaticTrustPolicy(true),
    ownership: { tenantId: "demo", userId: "operator" },
    limits: { maxTurns: 2, maxToolCalls: 1 },
    definitionRevision: "1",
    runState: { checkpoints: createMemoryCheckpointStore() },
  });
  return agent.createSession().run("hello");
}
