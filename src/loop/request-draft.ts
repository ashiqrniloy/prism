/** Request-shaping shared by the run loop and the session's overflow recovery (plan 194 Task 3). */
import type { ContextBlock, Message, ProviderRequest, ToolDefinition } from "../contracts.js";
import type { ContextDraft, HookBus } from "../hooks/index.js";
import { createId } from "../ids.js";
import { contextMessages } from "../input.js";
import { skillCatalogDraft } from "../skills-catalog.js";

/** The draft a `context.build` handler sees for one assembled request. */
export function draftFromRequest(request: ProviderRequest): ContextDraft {
  // `context` is an addition channel, not a mirror: the assembler has already rendered any context
  // it had into `messages`, so mirroring it here would render the same blocks twice.
  return {
    messages: request.messages,
    ...skillCatalogDraft(request),
    ...(request.tools ? { tools: request.tools } : {}),
  };
}

function withSystem(messages: readonly Message[], systemPrompt: string): readonly Message[] {
  const index = messages.findIndex((message) => message.role === "system");
  if (index === -1) return [{ id: createId("msg"), role: "system", content: [{ type: "text", text: systemPrompt }] }, ...messages];
  const next = [...messages];
  next[index] = { ...next[index]!, content: [{ type: "text", text: systemPrompt }] };
  return next;
}

/** Render a `context.build` draft back onto the assembled request. */
export function applyDraft(request: ProviderRequest, draft: ContextDraft): ProviderRequest {
  let messages = draft.systemPrompt !== undefined ? withSystem(draft.messages, draft.systemPrompt) : draft.messages;
  if (draft.context?.length) messages = withContextMessages(messages, draft.context);
  return {
    ...request,
    messages,
    // Restrictive-only, exactly like the retired `toolNarrowing`: a handler may drop tools from the
    // turn but never introduce one the request did not already carry, so a context source cannot
    // advertise a capability the tool registry never granted.
    tools: draft.tools === undefined || request.tools === undefined ? request.tools : narrowTo(request.tools, draft.tools),
    context: draft.context ? [...(request.context ?? []), ...draft.context] : request.context,
  };
}

function narrowTo(listed: readonly ToolDefinition[], requested: readonly ToolDefinition[]): readonly ToolDefinition[] {
  const names = new Set(requested.map((entry) => entry.name));
  return listed.filter((entry) => names.has(entry.name));
}

/** Render context blocks into the transcript at the stable-prefix boundary, ahead of the dynamic tail. */
function withContextMessages(messages: readonly Message[], blocks: readonly ContextBlock[]): readonly Message[] {
  const rendered = contextMessages(blocks);
  if (rendered.length === 0) return messages;
  const boundary = messages.findIndex((message) => message.role !== "system");
  const at = boundary === -1 ? messages.length : boundary;
  return [...messages.slice(0, at), ...rendered, ...messages.slice(at)];
}

/**
 * Run the public request pipeline on an already-assembled request: `context.build` then
 * `model.request`, including the secrets a transform declared. Used per turn and, after an
 * overflow compaction, to rebuild the request from the shrunken branch.
 */
export async function applyRequestTransforms(
  hooks: HookBus,
  scope: { readonly sessionId: string; readonly runId: string },
  request: ProviderRequest,
): Promise<{ readonly request: ProviderRequest; readonly secrets: (string | undefined)[] }> {
  const draft = draftFromRequest(request);
  const built = await hooks.transform("context.build", draft, scope);
  if (built !== draft) request = applyDraft(request, built);
  const transformedRequest = await hooks.transform("model.request", request, scope);
  // A transform may declare secrets it injected; they join the provider error-redaction set.
  const secrets: (string | undefined)[] = [];
  let outgoing: ProviderRequest = request;
  if (transformedRequest && "request" in transformedRequest) {
    secrets.push(...(transformedRequest.secrets ?? []));
    outgoing = transformedRequest.request;
  } else if (transformedRequest) {
    outgoing = transformedRequest;
  }
  return { request: outgoing, secrets };
}
