import type { HostUi, ModelRef, PackageInstance, ProviderEvent } from "@arnilo/prism";
import {
  createScriptedHostUi,
  mockProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism/testing";
import { EVAL_SOURCE_A, type HostEvalItemInput } from "../../../evals/dataset.js";
import { fixtureEmbeddings } from "./embeddings.js";

export const EVAL_MOCK_MODEL: ModelRef = {
  provider: "mock",
  model: "prism-eval-fixture",
  limits: { contextWindow: 64_000, maxOutputTokens: 0 },
};

export function evalScriptForItem(input: HostEvalItemInput): readonly (readonly ProviderEvent[])[] {
  if (input.worker === "coding") {
    const target = input.targetFile ?? { path: "note.txt", content: "ok\n" };
    const finalText = input.allowApproval === false ? `Write to ${target.path} was denied by host approval.` : `Wrote ${target.path}.`;
    return [
      [providerToolCall(toolCallContent("w1", "write", { path: target.path, content: target.content })), providerDone()],
      [providerTextDelta(finalText), providerDone()],
    ];
  }
  const urls = input.fetchUrls && input.fetchUrls.length > 0 ? input.fetchUrls : [EVAL_SOURCE_A];
  const citations = urls.map((_, index) => `[[cite:S${index + 1}]]`).join(" ");
  return [
    [...urls.map((url, index) => providerToolCall(toolCallContent(`f${index + 1}`, "web_fetch", { url }))), providerDone()],
    [providerTextDelta(`Verified fixture summary ${citations}`), providerDone()],
  ];
}

export function createEvalWorkerFixtures(options: {
  readonly codingInputs: readonly HostEvalItemInput[];
  readonly researchInputs: readonly HostEvalItemInput[];
  readonly trials: number;
  readonly shouldAllowApproval: () => boolean;
}): {
  readonly codingPackages: readonly PackageInstance[];
  readonly researchPackages: readonly PackageInstance[];
  readonly ui: HostUi;
} {
  const repeat = Math.max(1, options.trials);
  const codingTurns = options.codingInputs.flatMap((input) => Array.from({ length: repeat }, () => evalScriptForItem(input)).flat());
  const researchTurns = options.researchInputs.flatMap((input) => Array.from({ length: repeat }, () => evalScriptForItem(input)).flat());
  const scriptedUi = createScriptedHostUi((request) => {
    if (request.kind === "confirm") return options.shouldAllowApproval();
    return { status: "unavailable" };
  });
  return {
    codingPackages: [mockProvider(codingTurns.length > 0 ? codingTurns : [[providerDone()]])],
    researchPackages: [
      mockProvider(researchTurns.length > 0 ? researchTurns : [[providerDone()]], {
        embeddings: fixtureEmbeddings(),
      }),
    ],
    ui: scriptedUi.ui,
  };
}
