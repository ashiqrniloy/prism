import {
  createAgent,
  createMockProvider,
  providerDone,
  providerTextDelta,
  resolveContextProviders,
} from "@arnilo/prism";
import { createHashEmbedder, createMemory } from "@arnilo/prism-memory";

const memory = createMemory({
  tenantId: "demo",
  resourceId: "user-ada",
  threadId: "thread-1",
  embedder: createHashEmbedder({ dimensions: 32 }),
  workingMemoryTemplate: "Name: {{name}}; Format: {{preferences.format}}",
  schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      preferences: {
        type: "object",
        properties: { format: { type: "string" } },
        required: ["format"],
        additionalProperties: false,
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  secrets: ["DEMO_SECRET_VALUE"],
});

await memory.updateWorking({ name: "Ada", preferences: { format: "concise" } });
await memory.remember(
  {
    entries: [
      { id: "m1", text: "Prefers concise answers", sequence: 1 },
      { id: "m2", text: "Lives in Lisbon", sequence: 2 },
    ],
  },
  { wait: true },
);

const recalled = await memory.recall("concise answers", { topK: 2, messageRange: 1 });
console.log(
  "recall",
  recalled.hits.map((hit) => hit.id),
  "adjacent",
  recalled.adjacent.map((item) => item.id),
);

const blocks = await resolveContextProviders({
  providers: [memory.createContextProvider()],
  messages: [{ role: "user", content: [{ type: "text", text: "What format should replies use?" }] }],
});
console.log("context blocks", blocks.map((block) => block.title));

const processor = memory.createWorkingMemoryProcessor({
  extract: () => ({ preferences: { format: "bullets" } }),
});
await processor.process([{ role: "user", content: [{ type: "text", text: "switch format" }] }]);
console.log("working", await memory.getWorking());

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([providerTextDelta("Understood."), providerDone()]),
  context: [memory.createContextProvider({ includeWorking: true, includeSemantic: true })],
});

const result = await agent.createSession().run("Remind me how to format answers");
console.log("agent", result.text);
