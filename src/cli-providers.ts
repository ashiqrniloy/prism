/**
 * The `--provider` table of the Prism CLI. It is the one place the CLI names provider packages, kept in its own
 * module so `core-boundaries.test.ts` can allow it as a sanctioned seam. The flag is a runner mode and goes with
 * the runner modes in Phase 11.
 */
export interface CliProviderSpec {
  readonly packageName: string;
  readonly envKey: string;
  readonly modelProvider: string;
  readonly modelName: string;
  readonly factoryModule: string;
  readonly factoryExport: string;
}

/** Plan 152 Part B: each adapter ships as its own `@arnilo/prism-provider-<vendor>` package, so the
 *  CLI names the standalone package (its raw factory is a named export of the package root). */
const providerPackageName = (id: string): string => `@arnilo/prism-provider-${id}`;
const cliProvider = (id: string, factoryExport: string, envKey: string, modelProvider: string, modelName: string): CliProviderSpec => ({
  packageName: providerPackageName(id),
  envKey,
  modelProvider,
  modelName,
  factoryModule: providerPackageName(id),
  factoryExport,
});

/** Providers `--provider` can build. `mock` is handled before this lookup. The flag is a runner mode
 *  and goes with the runner modes in Phase 11; the manifest carries provider packages from then on. */
export const CLI_PROVIDERS: ReadonlyMap<string, CliProviderSpec> = new Map([
  ["openai", cliProvider("openai", "createOpenAIResponsesProvider", "OPENAI_API_KEY", "openai", "gpt-5.1")],
  ["openrouter", cliProvider("openrouter", "createOpenRouterProvider", "OPENROUTER_API_KEY", "openrouter", "anthropic/claude-sonnet-4")],
  ["kimi", cliProvider("kimi", "createKimiCodingProvider", "KIMI_API_KEY", "kimi-coding", "kimi-k2.7-code")],
  ["zai", cliProvider("zai", "createZaiProvider", "ZAI_API_KEY", "zai", "glm-4.7")],
  ["opencode-go", cliProvider("opencode-go", "createOpenCodeGoProvider", "OPENCODE_API_KEY", "opencode-go", "gpt-5.1-go")],
  ["neuralwatt", cliProvider("neuralwatt", "createNeuralWattProvider", "NEURALWATT_API_KEY", "neuralwatt", "glm-5.2")],
  ["alibaba", cliProvider("alibaba", "createAlibabaProvider", "DASHSCOPE_API_KEY", "alibaba", "qwen-plus")],
  ["ollama", cliProvider("ollama", "createOllamaProvider", "OLLAMA_API_KEY", "ollama", "gpt-oss:20b")],
]);
