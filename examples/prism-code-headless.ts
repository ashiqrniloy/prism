import { createMockProvider, providerDone, providerTextDelta, providerUsage, type ToolRegistry } from "@arnilo/prism";
import { assembleAppAgent, type PrismCodeConfig, runHeadless } from "@arnilo/prism-code";

// Demonstrates the headless surface of `@arnilo/prism-code` with the offline
// `mock` provider: assemble the app agent, stream one prompt through
// `runHeadless` (print mode), and read the assembled tool inventory.
// The same `PrismCodeConfig` drives the TUI and the ACP surface.
export async function demo(): Promise<{
  readonly exitCode: number;
  readonly text: string;
  readonly toolCount: number;
  readonly webMode: string;
}> {
  const config: PrismCodeConfig = {
    cwd: process.cwd(),
    userId: "local",
    model: { provider: "mock", model: "mock" },
    store: { type: "memory" },
  };

  const provider = createMockProvider([
    providerTextDelta("Headless summary: the repository is ready."),
    providerUsage({ inputTokens: 18, outputTokens: 9, totalTokens: 27 }),
    providerDone(),
  ]);

  let text = "";
  const exitCode = await runHeadless({
    config,
    prompt: "Summarize the repository architecture",
    mode: "print",
    provider,
    stdout: {
      write(chunk) {
        text += chunk;
        return true;
      },
    },
  });

  const app = await assembleAppAgent(config, provider);
  const toolCount = (app.agent.config.tools as ToolRegistry).list().length;
  const webMode = (app as unknown as { webResolution?: { mode?: string } }).webResolution?.mode ?? "off";
  await app.dispose();

  return { exitCode, text, toolCount, webMode };
}

export async function main(): Promise<void> {
  console.log(JSON.stringify(await demo(), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
