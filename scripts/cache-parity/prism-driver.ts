/**
 * Prism side of the cache-parity runner: the reference host's one-shot coding worker
 * (`apps/prism-agent` `run --agent coding`) with one provider package pointed at the wire proxy.
 *
 * The runner starts this as a child process. Inputs are environment variables and one argv prompt;
 * the key reaches the provider through its own `env:` ref, never as an argument.
 *
 *   PRISM_PARITY_PROVIDER  commandcode | ollama-cloud
 *   PRISM_PARITY_BASE_URL  the proxy URL, including any path prefix the provider's default base has
 *   PRISM_PARITY_CONFIG    path to a prism-agent.json the runner wrote into the run's scratch directory
 *   PRISM_PARITY_ROUTE     ollama-cloud only: native | openai
 *
 * stdout is the kernel's event stream as JSONL (the one-shot CLI's own output); stderr is diagnostics.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { runCommand } from "../../apps/prism-agent/src/cli/run.js";
import { withCatalogFields } from "./host-model.js";

const providers = {
  commandcode: { module: "@arnilo/prism-provider-commandcode", factory: "commandcode", catalog: "commandCodeModels" },
  "ollama-cloud": { module: "@arnilo/prism-provider-ollama-cloud", factory: "ollamaCloud", catalog: "ollamaCloudModels" },
} as const;

const id = process.env.PRISM_PARITY_PROVIDER as keyof typeof providers | undefined;
const baseUrl = process.env.PRISM_PARITY_BASE_URL;
const config = process.env.PRISM_PARITY_CONFIG;
const prompt = process.argv[2];
if (id === undefined || !(id in providers) || !baseUrl || !config || !prompt) {
  process.stderr.write("prism-driver: PRISM_PARITY_PROVIDER, PRISM_PARITY_BASE_URL, PRISM_PARITY_CONFIG and a prompt are required\n");
  process.exit(2);
}

const entry = providers[id];
const mod = (await import(entry.module)) as Record<string, unknown>;
const factory = mod[entry.factory] as (options: Record<string, unknown>) => never;
// A static catalog: model discovery would be one more request through the proxy and the cell budget.
const options: Record<string, unknown> = { baseUrl, models: mod[entry.catalog] };
if (id === "ollama-cloud" && process.env.PRISM_PARITY_ROUTE) options.route = process.env.PRISM_PARITY_ROUTE;

// The host builds its model objects from the config, not from the catalog: copy in what the shipped product gets
// from the provider's catalog (limits, the Command Code wire in compat.route, cache markers, capabilities).
const hostConfig = JSON.parse(readFileSync(config, "utf8")) as Parameters<typeof withCatalogFields>[0];
withCatalogFields(hostConfig, mod[entry.catalog] as Parameters<typeof withCatalogFields>[1]);
writeFileSync(config, `${JSON.stringify(hostConfig, null, 2)}\n`);

const code = await runCommand(
  { command: "run", agent: "coding", config, prompt },
  {
    write: (line) => void process.stdout.write(line),
    writeError: (text) => void process.stderr.write(text.endsWith("\n") ? text : `${text}\n`),
  },
  {
    packages: [factory(options)],
    cwd: process.cwd(),
    // The kernel defaults (16 turns, 8 tool rounds, 40k cumulative input tokens, 120 s) would end a Prism run
    // before pi's: a longer loop is what the comparison needs. The proxy's 20-request ceiling is the real bound,
    // and the token axes are off so a cheap model's long prompt cannot stop the run early.
    limits: {
      maxTurns: 20,
      maxProviderAttempts: 40,
      maxToolRounds: 20,
      maxToolCalls: 60,
      maxWallTimeMs: 600_000,
      maxInputTokens: null,
      maxOutputTokens: null,
      maxTotalTokens: null,
    },
  },
);
process.exit(code);
