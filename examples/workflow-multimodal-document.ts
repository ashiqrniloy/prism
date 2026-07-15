import {
  createAgent,
  createAgentSession,
  createEnvCredentialResolver,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  providerUsage,
  type Message,
} from "@arnilo/prism";
import {
  agentNode,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  runWorkflow,
} from "@arnilo/prism-workflows";

// Offline multimodal document workflow. Host constructs a bounded inline PDF
// block, passes it through a function node, then an agent node summarizes it.
// Credentials come only from a caller-supplied env object; Prism never reads
// process.env. Mock provider means no credential or network is consumed.

const callerEnv = { DEMO_API_KEY: "demo-workflow-key" };
const credentials = createEnvCredentialResolver(callerEnv, { mock: "DEMO_API_KEY" });
const tinyPdfBase64 = Buffer.from("%PDF-1.4\n% offline demo\n").toString("base64");

const provider = createMockProvider([
  providerTextDelta("Document summary: offline workflow brief."),
  providerUsage({ inputTokens: 8, outputTokens: 5, totalTokens: 13 }),
  providerDone(),
]);

const agent = createAgent({
  model: {
    provider: "mock",
    model: "document-demo",
    capabilities: { input: ["text", "document"] },
  },
  provider,
  credentials,
  instructions: "Summarize the supplied document without reproducing secrets.",
});

const prepare = functionNode({
  execute: async (): Promise<Message> => ({
    role: "user",
    content: [
      { type: "text", text: "Summarize this bounded PDF." },
      {
        type: "document",
        mediaType: "application/pdf",
        name: "brief.pdf",
        data: tinyPdfBase64,
      },
    ],
  }),
});

const summarize = agentNode({
  agent: "document-summarizer",
  input: (ctx) => ctx.upstream.prepare,
});

const workflow = defineWorkflow({
  id: "multimodal-document",
  nodes: { prepare, summarize },
  edges: [["prepare", "summarize"]],
  limits: {
    maxNodes: 16,
    maxConcurrency: 1,
    maxNodeOutputBytes: 64 * 1_024,
    maxCheckpointBytes: 128 * 1_024,
  },
});

export async function demo() {
  const credential = await credentials.resolve({ provider: "mock", name: "apiKey" });
  const redactor = createSecretRedactor([credential?.value]);
  const result = await runWorkflow(workflow, null, {
    agentFactory: () => createAgentSession({ agent }),
    checkpoints: createMemoryWorkflowCheckpoints({ redactor }),
    redactor,
    ownership: { tenantId: "demo" },
    signal: AbortSignal.timeout(30_000),
  });

  return {
    status: result.status,
    documentBytes: Buffer.from(tinyPdfBase64, "base64").byteLength,
    credentialConfigured: Boolean(credential),
    summarized: result.outputs.summarize !== undefined,
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
