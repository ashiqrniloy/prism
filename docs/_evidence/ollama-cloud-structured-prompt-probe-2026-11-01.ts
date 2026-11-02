#!/usr/bin/env bun
// Structured-output prompt sensitivity probe (plan 206 Task 5 follow-up). Measures what the
// shared live suite's structured-output prompt costs on Ollama Cloud: same schema, four
// phrasings, two free models, one model outside the Free plan (refused), all on the native
// route through the package, so the fence strip is included. Evidence only, never shipped.
// One run spends 28 billed requests (3 models x 4 prompts x 2 reps; the paid model refuses before
// generation). Read the recorded JSON instead of re-running unless the measurement must be redone.
//
//   bun docs/_evidence/ollama-cloud-structured-prompt-probe-2026-11-01.ts --write
import { readFileSync, writeFileSync } from "node:fs";
import { createOllamaCloudProvider, ollamaCloudModels } from "../../packages/providers/ollama-cloud/src/index.js";
import { collectProviderEvents } from "../../src/provider-kit/index.js";

const schema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
} as const;

const prompts = [
  ["shared_default", "Reply with a JSON object matching the requested schema."],
  ["concrete", "Return a JSON object with the single boolean key ok set to true."],
  [
    "schema_inline",
    `Respond with only JSON matching this schema, no prose: ${JSON.stringify({ type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] })}`,
  ],
  ["terse", 'JSON only. {"ok":true}'],
] as const;

const models = ["gemma4:31b", "gpt-oss:20b", "kimi-k3"] as const;
const reps = 2;

function apiKey(): string {
  const env = process.env.OLLAMA_API_KEY;
  if (env) return env;
  const path = process.env.PRISM_LIVE_ENV_FILE ?? `${process.env.HOME}/.config/prism/live.env`;
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find((entry) => entry.startsWith("OLLAMA_API_KEY="));
  if (!line) throw new Error(`OLLAMA_API_KEY missing from ${path}`);
  return line.slice("OLLAMA_API_KEY=".length).trim();
}

function verdict(text: string): { outcome: string; detail: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { outcome: "prose", detail: text.replace(/\s+/g, " ").slice(0, 90) };
  }
  const ok = (parsed as { ok?: unknown }).ok;
  return {
    outcome: parsed !== null && typeof parsed === "object" && typeof ok === "boolean" ? "json_schema_ok" : "json_other",
    detail: JSON.stringify(parsed).slice(0, 90),
  };
}

const provider = createOllamaCloudProvider({ route: "native", apiKey });
const results = [];
for (const modelId of models) {
  const base = ollamaCloudModels.find((entry) => entry.model === modelId);
  for (const [name, prompt] of prompts) {
    for (let rep = 0; rep < reps; rep++) {
      const model = { ...(base ?? { provider: "ollama-cloud", model: modelId }), model: modelId };
      const events = await collectProviderEvents(provider, {
        model,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        options: { sessionId: `structured-prompt-${modelId}-${name}-${rep}`, structuredOutput: { name: "probe", schema } },
      });
      const terminal = events.at(-1);
      let row: Record<string, unknown>;
      if (terminal?.type === "error") {
        const message = terminal.error.message;
        row = {
          outcome: /not included in your free usage/i.test(message) ? "refused_plan" : "error",
          detail: message.replace(/\s+/g, " ").slice(0, 90),
        };
      } else {
        const text = events
          .map((event) => (event.type === "content_delta" && event.content.type === "text" ? event.content.text : ""))
          .join("");
        row = verdict(text);
      }
      results.push({ model: modelId, prompt: name, rep, ...row });
      console.info(`${modelId} ${name} #${rep}: ${row.outcome}`);
    }
  }
}

const summary = models.map((model) => {
  const rows = results.filter((row) => row.model === model);
  const byPrompt = prompts.map(([name]) => {
    const cell = rows.filter((row) => row.prompt === name);
    return {
      prompt: name,
      obeyed: cell.filter((row) => row.outcome === "json_schema_ok").length,
      total: cell.length,
      outcomes: [...new Set(cell.map((row) => row.outcome))],
    };
  });
  return { model, byPrompt };
});

const report = {
  generatedAt: new Date().toISOString(),
  route: "native",
  schema,
  reps,
  prompts: prompts.map(([name, text]) => ({ name, text })),
  summary,
  results,
};
if (process.argv.includes("--write")) {
  const target = new URL("./ollama-cloud-structured-prompt-2026-11-01.json", import.meta.url);
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  console.info(`wrote ${target.pathname}`);
}
console.info(JSON.stringify(summary, null, 2));
