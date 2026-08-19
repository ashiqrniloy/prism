import type { ProviderRequest } from "@arnilo/prism";

/** Reasoning models must replay prior thinking as `reasoning_content` or the prefix cache breaks. */
export function xaiReplayThinking(request: ProviderRequest): boolean {
  return request.model.capabilities?.reasoning === true;
}
