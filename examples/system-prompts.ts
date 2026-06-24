import { composeSystemPrompt, mergeSystemPromptConfig } from "@arnilo/prism";

// Layered system prompt composition: package, app, user, then run order.
// RunOptions.systemPrompt: false disables configured layers while keeping
// AgentConfig.instructions as the simple direct path.
export function demo() {
  const config = [
    { id: "pkg", source: "package", mode: "append" as const, text: "Package policy." },
    { id: "app", source: "app", mode: "append" as const, text: "App policy." },
  ];
  const run = [{ id: "run", source: "run", mode: "append" as const, text: "Run note." }];

  const merged = mergeSystemPromptConfig(config, run);
  const prompt = composeSystemPrompt(merged, { base: "You are helpful." });

  // Disabling layers for a run:
  const disabled = composeSystemPrompt(false, { base: "You are helpful." });
  return { prompt, disabled };
}
