import type { ProviderEvent } from "@arnilo/prism";
import { providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";

export const SOURCE_A = "https://example.com/a";
export const SOURCE_B = "https://example.com/b";

export function writeScript(path: string, content: string): readonly (readonly ProviderEvent[])[] {
  return [
    [providerToolCall(toolCallContent("w1", "write", { path, content })), providerDone()],
    [providerTextDelta("done"), providerDone()],
  ];
}

export function fetchBothScript(): readonly (readonly ProviderEvent[])[] {
  return [
    [
      providerToolCall(toolCallContent("f1", "web_fetch", { url: SOURCE_A })),
      providerToolCall(toolCallContent("f2", "web_fetch", { url: SOURCE_B })),
      providerDone(),
    ],
    [providerTextDelta(`Report [[cite:S1]] [[cite:S2]]`), providerDone()],
  ];
}

export function unknownCitationScript(): readonly (readonly ProviderEvent[])[] {
  return [
    [providerTextDelta("[[cite:S9]]"), providerDone()],
    [providerTextDelta("[[cite:S9]]"), providerDone()],
  ];
}
