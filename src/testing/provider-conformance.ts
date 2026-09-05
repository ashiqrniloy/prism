import type {
  AIProvider,
  BatchJobsProvider,
  BatchRequestItem,
  ContentBlock,
  EmbeddingsProvider,
  EmbeddingsResult,
  ImageGenerationProvider,
  ImageGenerationResult,
  JsonObject,
  ModerationProvider,
  ModerationResult,
  ProviderEvent,
  ProviderRequest,
  SpeechProvider,
  SpeechRequest,
  SpeechResult,
  ToolCallContent,
  TranscriptionProvider,
  TranscriptionRequest,
  TranscriptionResult,
  Usage,
  VideoGenerationJob,
  VideoGenerationProvider,
} from "../contracts.js";
import {
  BatchJobsError,
  EmbeddingsError,
  ImageGenerationError,
  ModerationError,
  pollBatch,
  SpeechError,
  TranscriptionError,
  VideoGenerationError,
} from "../contracts.js";
import { reconstructToolCallDeltas } from "../provider-events.js";
import { canonicalizeJsonSchema } from "../providers/schema.js";

export interface ProviderStreamConformanceOptions {
  readonly provider: AIProvider;
  readonly request: ProviderRequest;
  readonly expect?: {
    readonly text?: string;
    readonly usage?: Usage;
  };
}

export interface ProviderAbortConformanceOptions {
  readonly provider: AIProvider;
  readonly request: Omit<ProviderRequest, "signal"> & { readonly signal?: AbortSignal };
  readonly reason?: unknown;
}

export interface ToolCallDeltaExpectation {
  readonly index: number;
  readonly id?: string;
  readonly name?: string;
  readonly arguments?: JsonObject;
}

export interface SerializedContentCoverageOptions {
  readonly unsupported?: readonly ContentBlock["type"][];
}

export interface ProviderHeaderOwnershipConformanceOptions {
  /** Provider-owned header names mapped to the authoritative values the provider must set. */
  readonly owned: Readonly<Record<string, string>>;
  /** Caller-supplied headers, including attempts to override owned names and non-owned additions. */
  readonly caller: Readonly<Record<string, string>>;
}

export async function collectProviderEvents(provider: AIProvider, request: ProviderRequest): Promise<readonly ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of provider.generate(request)) events.push(event);
  return events;
}

export async function assertProviderStreamConforms(options: ProviderStreamConformanceOptions): Promise<readonly ProviderEvent[]> {
  const events = await collectProviderEvents(options.provider, options.request);
  const terminal = events.at(-1);
  if (!terminal || (terminal.type !== "done" && terminal.type !== "error")) throw new Error("Provider stream must end with done or error");
  if (events.slice(0, -1).some((event) => event.type === "done" || event.type === "error"))
    throw new Error("Provider stream terminal event must be last");

  if (options.expect?.text !== undefined && textFrom(events) !== options.expect.text)
    throw new Error(`Provider text mismatch: expected ${JSON.stringify(options.expect.text)}`);
  if (options.expect?.usage) assertUsageAccounting(events, options.expect.usage);
  return events;
}

export async function assertAbortIsObserved(options: ProviderAbortConformanceOptions): Promise<void> {
  const controller = new AbortController();
  controller.abort(options.reason ?? new Error("aborted"));
  let rejected = false;
  try {
    await collectProviderEvents(options.provider, { ...options.request, signal: controller.signal });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Provider did not observe an already-aborted signal");
}

export function assertToolCallDeltasReconstruct(
  events: readonly ProviderEvent[],
  expected: readonly ToolCallDeltaExpectation[],
): readonly ToolCallContent[] {
  const calls = reconstructToolCallDeltas(events);
  for (const item of expected) {
    const call = calls[item.index];
    if (!call) throw new Error(`Missing tool call at index ${item.index}`);
    if (item.id !== undefined && call.id !== item.id) throw new Error(`Tool call id mismatch at index ${item.index}`);
    if (item.name !== undefined && call.name !== item.name) throw new Error(`Tool call name mismatch at index ${item.index}`);
    if (item.arguments !== undefined && JSON.stringify(call.arguments) !== JSON.stringify(item.arguments))
      throw new Error(`Tool call arguments mismatch at index ${item.index}`);
  }
  return calls;
}

export function assertSerializedRequestCoversContent(
  request: ProviderRequest,
  body: unknown,
  options: SerializedContentCoverageOptions = {},
): void {
  const unsupported = new Set(options.unsupported ?? []);
  const bodyText = JSON.stringify(body);
  for (const message of request.messages) {
    for (const block of message.content) {
      if (unsupported.has(block.type)) continue;
      const canaries = contentBlockCanaries(block);
      if (canaries.length === 0) continue;
      const missing = canaries.filter((canary) => !bodyText.includes(canary));
      if (missing.length > 0) {
        throw new Error(`Serialized request dropped ${block.type} content; missing canaries: ${JSON.stringify(missing)}`);
      }
    }
  }
}

export function assertCanonicalToolParameters(serialized: unknown, original: unknown): void {
  const expected = canonicalizeJsonSchema(original ?? { type: "object" });
  if (JSON.stringify(serialized) !== JSON.stringify(expected)) {
    throw new Error("Tool parameters were not canonicalized");
  }
}

export function assertProviderOwnedHeadersWin(captured: Headers, options: ProviderHeaderOwnershipConformanceOptions): void {
  const ownedLower: Record<string, string> = {};
  for (const [name, expected] of Object.entries(options.owned)) ownedLower[name.toLowerCase()] = expected;
  for (const [name, expected] of Object.entries(ownedLower)) {
    const actual = captured.get(name);
    if (actual !== expected)
      throw new Error(
        `Caller header overrode provider-owned "${name}": expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
  }
  for (const [name, callerValue] of Object.entries(options.caller)) {
    if (Object.hasOwn(ownedLower, name.toLowerCase())) continue;
    const actual = captured.get(name);
    if (actual !== callerValue)
      throw new Error(
        `Provider dropped non-owned caller header "${name}": expected ${JSON.stringify(callerValue)}, got ${JSON.stringify(actual)}`,
      );
  }
}

export function assertNoSecretLeak(events: readonly ProviderEvent[], secrets: readonly string[]): void {
  const eventText = JSON.stringify(events);
  for (const secret of secrets) {
    if (!secret) continue;
    if (eventText.includes(secret)) throw new Error(`Secret leaked into provider events: ${secret.slice(0, 8)}...`);
  }
}

/** Known cache wire fields across protocols; any of these in a request body is an explicit cache control. */
const CACHE_WIRE_FIELDS = [
  "cache_control",
  "prompt_cache_key",
  "prompt_cache_retention",
  "prompt_cache_options",
  "prompt_cache_breakpoint",
  "cachedContent",
  "cachePoint",
] as const;

/**
 * Implicit/none-cache providers must serialize no foreign cache fields: implicit
 * caching works by byte-stable prefix reuse, not request payloads. `allowed` names
 * fields the provider documents for that route (e.g. `cachedContent` via the host
 * `extra.cachedContent` escape hatch on Gemini).
 */
export function assertNoForeignCacheFields(body: unknown, allowed: readonly string[] = []): void {
  const bodyText = JSON.stringify(body);
  for (const field of CACHE_WIRE_FIELDS) {
    if (allowed.includes(field)) continue;
    if (bodyText.includes(field)) throw new Error(`Serialized request carries foreign cache field "${field}"`);
  }
}

/** Provider construction and setup must perform zero network calls; discovery and streams are caller-gated. */
export function assertNoFetches(calls: readonly unknown[]): void {
  if (calls.length > 0) throw new Error(`Provider fetched ${calls.length} time(s) outside caller-gated discovery/stream`);
}

export function assertUsageAccounting(events: readonly ProviderEvent[], expected: Usage): Usage {
  const usage = [...events].reverse().find((event) => (event.type === "done" && event.usage) || event.type === "usage") as
    | Extract<ProviderEvent, { type: "usage" | "done" }>
    | undefined;
  const actual = usage?.type === "usage" ? usage.usage : usage?.usage;
  if (!actual) throw new Error("Provider stream did not include usage");
  for (const key of ["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens"] as const) {
    if (expected[key] !== undefined && actual[key] !== expected[key])
      throw new Error(`Usage ${key} mismatch: expected ${expected[key]}, got ${actual[key]}`);
  }
  return actual;
}

function contentBlockCanaries(block: ContentBlock): string[] {
  switch (block.type) {
    case "text":
      return block.text ? [block.text] : [];
    case "thinking":
      return block.text ? [block.text] : [];
    case "image":
      return [block.url, block.resourceUri, block.data, block.mimeType, block.name].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
    case "audio":
      // Providers map mediaType to wire format tokens (e.g. audio/wav → "wav") and
      // typically omit display names from input_audio payloads; identity canaries are
      // source bytes/refs plus optional transcript text.
      return [block.url, block.resourceUri, block.data, block.transcript].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
    case "file":
      return [block.url, block.resourceUri, block.data, block.mediaType, block.name].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
    case "document":
      return [block.url, block.resourceUri, block.data, block.mediaType, block.name, block.transcript].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
    case "tool_call":
      return [block.id, block.name, ...jsonPrimitives(block.arguments)];
    case "tool_result": {
      const values = [block.toolCallId, block.name, ...jsonPrimitives(block.result), ...jsonPrimitives(block.error)];
      return values.filter((value) => typeof value === "string" && value.length > 0);
    }
    default:
      return [];
  }
}

function jsonPrimitives(value: unknown): string[] {
  const primitives: string[] = [];
  const seen = new Set<unknown>();
  function walk(current: unknown) {
    if (seen.has(current)) return;
    if (current && typeof current === "object") {
      seen.add(current);
      if (Array.isArray(current)) {
        for (const item of current) walk(item);
      } else {
        for (const item of Object.values(current)) walk(item);
      }
    } else if (typeof current === "string" && current.length > 0) {
      primitives.push(current);
    } else if (typeof current === "number" || typeof current === "boolean") {
      primitives.push(String(current));
    }
  }
  walk(value);
  return primitives;
}

function textFrom(events: readonly ProviderEvent[]): string {
  return events.map((event) => (event.type === "content_delta" && event.content.type === "text" ? event.content.text : "")).join("");
}

export interface EmbeddingsConformanceOptions {
  readonly provider: EmbeddingsProvider;
  readonly model: string;
  /** When set, an oversized batch must fail with `EmbeddingsError("batch_too_large")`. */
  readonly maxBatchSize?: number;
  /** Happy-path mapping probe: inputs to embed and the expected vector count/dimensions. */
  readonly sample?: { readonly inputs: readonly string[]; readonly dimensions?: number };
}

/** Offline conformance for any `EmbeddingsProvider` (plan 061): typed empty-input
 *  error, typed oversized-batch error, and input-order vector mapping with finite
 *  coordinates. No network — the caller supplies the provider (real adapter with a
 *  fake transport, or a fake provider). */
export async function runEmbeddingsConformance(options: EmbeddingsConformanceOptions): Promise<EmbeddingsResult | undefined> {
  await assertEmbeddingsErrorCode(
    () => options.provider.embedMany({ model: options.model, inputs: [] }),
    "empty_input",
    "empty inputs must reject with EmbeddingsError(empty_input)",
  );
  if (options.maxBatchSize !== undefined) {
    const inputs = Array.from({ length: options.maxBatchSize + 1 }, (_, i) => `input-${i}`);
    await assertEmbeddingsErrorCode(
      () => options.provider.embedMany({ model: options.model, inputs }),
      "batch_too_large",
      `batches over ${options.maxBatchSize} must reject with EmbeddingsError(batch_too_large)`,
    );
  }
  if (!options.sample) return undefined;
  const result = await options.provider.embedMany({ model: options.model, inputs: options.sample.inputs });
  if (result.vectors.length !== options.sample.inputs.length)
    throw new Error(`vector count ${result.vectors.length} must match input count ${options.sample.inputs.length}`);
  for (const vector of result.vectors) {
    if (!Array.isArray(vector) || vector.length === 0 || !vector.every(Number.isFinite))
      throw new Error("vectors must be non-empty arrays of finite numbers");
  }
  if (!(result.dimensions > 0)) throw new Error("result.dimensions must be positive");
  if (options.sample.dimensions !== undefined && result.dimensions !== options.sample.dimensions)
    throw new Error(`result.dimensions ${result.dimensions} must match expected ${options.sample.dimensions}`);
  return result;
}

async function assertEmbeddingsErrorCode(run: () => Promise<unknown>, code: EmbeddingsError["code"], label: string): Promise<void> {
  let error: unknown;
  try {
    await run();
  } catch (caught) {
    error = caught;
  }
  if (!(error instanceof EmbeddingsError)) throw new Error(`${label}; got ${error === undefined ? "a successful result" : String(error)}`);
  if (error.code !== code) throw new Error(`${label}; got code ${error.code} (${error.message})`);
}

export interface SpeechConformanceOptions {
  readonly provider: SpeechProvider;
  readonly model: string;
  /** When set, an oversized input must fail with `SpeechError("input_too_large")`. */
  readonly maxInputChars?: number;
  /** Happy-path probe: text to synthesize, optional voice/format. */
  readonly sample?: { readonly input?: string; readonly voice?: string; readonly format?: string };
}

/** Offline conformance for any `SpeechProvider` (plan 061): typed empty-input and
 *  oversized-input errors, byte results, and stream ordering — the stream must emit
 *  at least one chunk before closing. Asserts event order, never wall clock. */
export async function runSpeechConformance(options: SpeechConformanceOptions): Promise<SpeechResult | undefined> {
  const input = options.sample?.input ?? "conformance";
  await assertSpeechErrorCode(
    () => options.provider.synthesize({ model: options.model, input: "" }),
    "empty_input",
    "empty input must reject with SpeechError(empty_input)",
  );
  if (options.maxInputChars !== undefined) {
    await assertSpeechErrorCode(
      () => options.provider.synthesize({ model: options.model, input: "x".repeat(options.maxInputChars! + 1) }),
      "input_too_large",
      `inputs over ${options.maxInputChars} chars must reject with SpeechError(input_too_large)`,
    );
  }
  if (!options.sample) return undefined;
  const request: SpeechRequest = {
    model: options.model,
    input,
    ...(options.sample.voice ? { voice: options.sample.voice } : {}),
    ...(options.sample.format ? { format: options.sample.format } : {}),
  };
  const result = await options.provider.synthesize(request);
  if (!(result.audio instanceof Uint8Array) || result.audio.byteLength === 0)
    throw new Error("synthesize must return non-empty audio bytes");
  if (typeof result.format !== "string" || result.format.length === 0) throw new Error("result.format must be a non-empty string");

  const streamed = await options.provider.synthesizeStream(request);
  const reader = streamed.audio.getReader();
  let chunks = 0;
  let firstChunkBeforeClose = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (chunks === 0 && value.byteLength > 0) firstChunkBeforeClose = true;
    chunks += 1;
  }
  if (chunks === 0 || !firstChunkBeforeClose) throw new Error("synthesizeStream must emit at least one non-empty chunk before closing");
  return result;
}

async function assertSpeechErrorCode(run: () => Promise<unknown>, code: SpeechError["code"], label: string): Promise<void> {
  let error: unknown;
  try {
    await run();
  } catch (caught) {
    error = caught;
  }
  if (!(error instanceof SpeechError)) throw new Error(`${label}; got ${error === undefined ? "a successful result" : String(error)}`);
  if (error.code !== code) throw new Error(`${label}; got code ${error.code} (${error.message})`);
}

export interface TranscriptionConformanceOptions {
  readonly provider: TranscriptionProvider;
  readonly model: string;
  /** When set, oversized audio must fail with `TranscriptionError("audio_too_large")`. */
  readonly maxAudioBytes?: number;
  /** Happy-path probe: audio bytes and the expected transcript prefix. */
  readonly sample?: { readonly audio?: Uint8Array; readonly format?: string; readonly textIncludes?: string };
}

/** Offline conformance for any `TranscriptionProvider` (plan 061): typed empty-audio
 *  and oversized-audio errors, one-shot text, and stream ordering — at least one
 *  `transcript_delta` partial, then exactly one `done` terminal event. */
export async function runTranscriptionConformance(options: TranscriptionConformanceOptions): Promise<TranscriptionResult | undefined> {
  const audio = options.sample?.audio ?? new Uint8Array([1, 2, 3]);
  await assertTranscriptionErrorCode(
    () => options.provider.transcribe({ model: options.model, audio: new Uint8Array(0) }),
    "empty_input",
    "empty audio must reject with TranscriptionError(empty_input)",
  );
  if (options.maxAudioBytes !== undefined) {
    await assertTranscriptionErrorCode(
      () => options.provider.transcribe({ model: options.model, audio: new Uint8Array(options.maxAudioBytes! + 1) }),
      "audio_too_large",
      `audio over ${options.maxAudioBytes} bytes must reject with TranscriptionError(audio_too_large)`,
    );
  }
  if (!options.sample) return undefined;
  const request: TranscriptionRequest = {
    model: options.model,
    audio,
    ...(options.sample.format ? { format: options.sample.format } : {}),
  };
  const result = await options.provider.transcribe(request);
  if (typeof result.text !== "string") throw new Error("transcribe must return string text");
  if (options.sample.textIncludes !== undefined && !result.text.includes(options.sample.textIncludes))
    throw new Error(`transcript ${JSON.stringify(result.text)} must include ${JSON.stringify(options.sample.textIncludes)}`);

  let deltas = 0;
  let doneEvents = 0;
  for await (const event of options.provider.transcribeStream(request)) {
    if (event.type === "transcript_delta") {
      if (typeof event.text !== "string") throw new Error("transcript_delta must carry string text");
      deltas += 1;
    } else if (event.type === "done") {
      doneEvents += 1;
      if (typeof event.text !== "string") throw new Error("done must carry string text");
    } else {
      throw new Error(`unexpected transcript event ${(event as { type?: string }).type}`);
    }
  }
  if (deltas === 0) throw new Error("transcribeStream must yield at least one transcript_delta before done");
  if (doneEvents !== 1) throw new Error(`transcribeStream must yield exactly one done event; got ${doneEvents}`);
  return result;
}

async function assertTranscriptionErrorCode(run: () => Promise<unknown>, code: TranscriptionError["code"], label: string): Promise<void> {
  let error: unknown;
  try {
    await run();
  } catch (caught) {
    error = caught;
  }
  if (!(error instanceof TranscriptionError))
    throw new Error(`${label}; got ${error === undefined ? "a successful result" : String(error)}`);
  if (error.code !== code) throw new Error(`${label}; got code ${error.code} (${error.message})`);
}

export interface ImageGenerationConformanceOptions {
  readonly provider: ImageGenerationProvider;
  readonly model: string;
  /** When set, an oversized prompt must fail with `ImageGenerationError("input_too_large")`. */
  readonly maxPromptChars?: number;
  /** Happy-path probe: prompt, requested image count, expected provenance. */
  readonly sample?: { readonly prompt?: string; readonly size?: string; readonly count?: number };
}

/** Offline conformance for any `ImageGenerationProvider` (plan 061): typed empty-input
 *  and oversized-prompt errors, plus image shape — non-empty bytes, an `image/*` mime
 *  type, and preserved provenance (`provider`/`model`) on every image. */
export async function runImageGenerationConformance(
  options: ImageGenerationConformanceOptions,
): Promise<ImageGenerationResult | undefined> {
  await assertImageGenerationErrorCode(
    () => options.provider.generate({ model: options.model, prompt: "" }),
    "empty_input",
    "empty prompts must reject with ImageGenerationError(empty_input)",
  );
  if (options.maxPromptChars !== undefined) {
    await assertImageGenerationErrorCode(
      () => options.provider.generate({ model: options.model, prompt: "x".repeat(options.maxPromptChars! + 1) }),
      "input_too_large",
      `prompts over ${options.maxPromptChars} chars must reject with ImageGenerationError(input_too_large)`,
    );
  }
  if (!options.sample) return undefined;
  const result = await options.provider.generate({
    model: options.model,
    prompt: options.sample.prompt ?? "conformance cube",
    ...(options.sample.size ? { size: options.sample.size } : {}),
    ...(options.sample.count ? { count: options.sample.count } : {}),
  });
  if (result.images.length === 0) throw new Error("generate must return at least one image");
  if (options.sample.count !== undefined && result.images.length !== options.sample.count)
    throw new Error(`image count ${result.images.length} must match requested ${options.sample.count}`);
  for (const image of result.images) {
    if (!(image.bytes instanceof Uint8Array) || image.bytes.byteLength === 0)
      throw new Error("generated images must carry non-empty bytes");
    if (typeof image.mimeType !== "string" || !image.mimeType.startsWith("image/"))
      throw new Error(`image mime type ${image.mimeType} must be image/*`);
    if (image.provider !== options.provider.id)
      throw new Error(`image provenance provider ${image.provider} must be preserved (${options.provider.id})`);
    if (image.model !== options.model) throw new Error(`image provenance model ${image.model} must be preserved (${options.model})`);
  }
  return result;
}

async function assertImageGenerationErrorCode(
  run: () => Promise<unknown>,
  code: ImageGenerationError["code"],
  label: string,
): Promise<void> {
  let error: unknown;
  try {
    await run();
  } catch (caught) {
    error = caught;
  }
  if (!(error instanceof ImageGenerationError))
    throw new Error(`${label}; got ${error === undefined ? "a successful result" : String(error)}`);
  if (error.code !== code) throw new Error(`${label}; got code ${error.code} (${error.message})`);
}

export interface VideoGenerationConformanceOptions {
  readonly provider: VideoGenerationProvider;
  readonly model: string;
  /** When set, an oversized prompt must fail with `VideoGenerationError("input_too_large")`. */
  readonly maxPromptChars?: number;
  /** Happy-path lifecycle probe: submit, poll to terminal state, assert result shape. */
  readonly sample?: { readonly prompt?: string; readonly maxPolls?: number };
}

/** Offline conformance for any `VideoGenerationProvider` (plan 061): typed
 *  empty-input and oversized-prompt errors, plus the submit→status lifecycle —
 *  a job id is returned, polling reaches a terminal state, and succeeded jobs
 *  carry a video with provenance (`provider`/`model`) and at least one source
 *  (`bytes` or `url`). */
export async function runVideoGenerationConformance(options: VideoGenerationConformanceOptions): Promise<VideoGenerationJob | undefined> {
  await assertVideoGenerationErrorCode(
    () => options.provider.submit({ model: options.model, prompt: "" }),
    "empty_input",
    "empty prompts must reject with VideoGenerationError(empty_input)",
  );
  if (options.maxPromptChars !== undefined) {
    await assertVideoGenerationErrorCode(
      () => options.provider.submit({ model: options.model, prompt: "x".repeat(options.maxPromptChars! + 1) }),
      "input_too_large",
      `prompts over ${options.maxPromptChars} chars must reject with VideoGenerationError(input_too_large)`,
    );
  }
  if (!options.sample) return undefined;
  const { jobId } = await options.provider.submit({ model: options.model, prompt: options.sample.prompt ?? "conformance clip" });
  if (typeof jobId !== "string" || jobId.length === 0) throw new Error("submit must return a non-empty job id");
  const maxPolls = options.sample.maxPolls ?? 10;
  let job: VideoGenerationJob | undefined;
  for (let poll = 0; poll < maxPolls; poll += 1) {
    job = await options.provider.status(jobId);
    if (!job) throw new Error("status must return a job");
    if (job.state === "succeeded" || job.state === "failed") break;
  }
  if (!job || (job.state !== "succeeded" && job.state !== "failed"))
    throw new Error(`status did not reach a terminal state within ${maxPolls} polls`);
  if (job.state === "failed") return job;
  const video = job.video;
  if (!video) throw new Error("succeeded jobs must carry a video");
  if (!video.bytes && !video.url) throw new Error("generated videos must carry bytes or a url");
  if (video.provider !== options.provider.id)
    throw new Error(`video provenance provider ${video.provider} must be preserved (${options.provider.id})`);
  if (video.model !== options.model) throw new Error(`video provenance model ${video.model} must be preserved (${options.model})`);
  return job;
}

async function assertVideoGenerationErrorCode(
  run: () => Promise<unknown>,
  code: VideoGenerationError["code"],
  label: string,
): Promise<void> {
  let error: unknown;
  try {
    await run();
  } catch (caught) {
    error = caught;
  }
  if (!(error instanceof VideoGenerationError))
    throw new Error(`${label}; got ${error === undefined ? "a successful result" : String(error)}`);
  if (error.code !== code) throw new Error(`${label}; got code ${error.code} (${error.message})`);
}

export interface ModerationConformanceOptions {
  readonly provider: ModerationProvider;
  readonly model: string;
  /** When set, an oversized input must fail with `ModerationError("input_too_large")`. */
  readonly maxInputChars?: number;
  /** Happy-path probe: a benign string classification. */
  readonly sample?: { readonly input?: string };
}

/** Offline conformance for any `ModerationProvider` (plan 061): typed empty-input
 *  and oversized-input errors, plus a classification probe — every category
 *  verdict carries a numeric score in [0,1], a boolean `flagged`, and the
 *  top-level `flagged` boolean is present. Scores are provider output; conformance
 *  asserts no local policy decisions are baked in. */
export async function runModerationConformance(options: ModerationConformanceOptions): Promise<ModerationResult | undefined> {
  await assertModerationErrorCode(
    () => options.provider.moderate({ input: "", model: options.model }),
    "empty_input",
    "empty inputs must reject with ModerationError(empty_input)",
  );
  if (options.maxInputChars !== undefined) {
    await assertModerationErrorCode(
      () => options.provider.moderate({ input: "x".repeat(options.maxInputChars! + 1), model: options.model }),
      "input_too_large",
      `inputs over ${options.maxInputChars} chars must reject with ModerationError(input_too_large)`,
    );
  }
  if (!options.sample) return undefined;
  const classified = await options.provider.moderate({ input: options.sample.input ?? "conformance probe", model: options.model });
  if (Array.isArray(classified)) throw new Error("single-string input must classify to one ModerationResult, not a batch");
  const result = classified as ModerationResult;
  if (typeof result.flagged !== "boolean") throw new Error("moderation results must carry a top-level flagged boolean");
  const entries = Object.entries(result.categories);
  if (entries.length === 0) throw new Error("moderation results must expose at least one category verdict");
  for (const [name, verdict] of entries) {
    if (typeof verdict.score !== "number" || !(verdict.score >= 0 && verdict.score <= 1))
      throw new Error(`category ${name} score ${verdict.score} must be a number in [0,1]`);
    if (typeof verdict.flagged !== "boolean") throw new Error(`category ${name} verdict must carry a flagged boolean`);
  }
  return result;
}

async function assertModerationErrorCode(run: () => Promise<unknown>, code: ModerationError["code"], label: string): Promise<void> {
  let error: unknown;
  try {
    await run();
  } catch (caught) {
    error = caught;
  }
  if (!(error instanceof ModerationError)) throw new Error(`${label}; got ${error === undefined ? "a successful result" : String(error)}`);
  if (error.code !== code) throw new Error(`${label}; got code ${error.code} (${error.message})`);
}

export interface BatchJobsConformanceOptions {
  readonly provider: BatchJobsProvider;
  /** Sample lifecycle driver: submitted via `submit` and expected to reach `completed`. */
  readonly sample?: {
    readonly model: string;
    readonly requests: readonly BatchRequestItem[];
  };
  /** When set, a submit over this count must fail with `BatchJobsError("too_many_requests")`. */
  readonly maxRequests?: number;
}

/** Offline conformance for any `BatchJobsProvider` (plan 061): typed empty/oversized
 *  submit errors, opaque job ids, status returning members of the neutral state
 *  union, terminal resolution via `pollBatch` (plain utility), and paged results
 *  that walk to exhaustion with cursor continuity. Failure/cancel terminal
 *  transitions are covered by provider fakes in adapter test suites. */
export async function runBatchJobsConformance(options: BatchJobsConformanceOptions): Promise<void> {
  await assertBatchJobsErrorCode(
    () => options.provider.submit({ model: "batch-model", requests: [] }),
    "empty_requests",
    "empty submits must reject with BatchJobsError(empty_requests)",
  );
  if (options.maxRequests !== undefined) {
    await assertBatchJobsErrorCode(
      () =>
        options.provider.submit({ model: "batch-model", requests: Array.from({ length: options.maxRequests! + 1 }, () => ({ body: {} })) }),
      "too_many_requests",
      `submits over ${options.maxRequests} requests must reject with BatchJobsError(too_many_requests)`,
    );
  }
  if (!options.sample) return;
  const submitted = await options.provider.submit({ model: options.sample.model, requests: options.sample.requests });
  if (typeof submitted.id !== "string" || submitted.id.length === 0) throw new Error("submit must return an opaque non-empty job id");
  const status = await options.provider.status(submitted.id);
  if (typeof status.state !== "string") throw new Error("status must return a typed job state");
  const terminal = await pollBatch(options.provider, submitted.id, { intervalMs: 1, maxAttempts: 10 });
  if (terminal.state !== "completed") throw new Error(`sample job must reach completed; got ${terminal.state}`);
  const seen: string[] = [];
  let cursor: string | null | undefined = null;
  let pages = 0;
  while (pages < 10) {
    const page = await options.provider.results(submitted.id, { cursor: cursor ?? null });
    for (const item of page.items) {
      if (typeof item.customId !== "string" || item.customId.length === 0) throw new Error("result items must carry non-empty custom ids");
      seen.push(item.customId);
    }
    if (!page.nextCursor) break;
    if (page.nextCursor === cursor) throw new Error("results cursor must advance between pages");
    cursor = page.nextCursor;
    pages += 1;
  }
  if (seen.length === 0) throw new Error("completed job must expose at least one result item");
  if (new Set(seen).size !== seen.length) throw new Error("result paging must not duplicate items across pages");
}

async function assertBatchJobsErrorCode(run: () => Promise<unknown>, code: BatchJobsError["code"], label: string): Promise<void> {
  let error: unknown;
  try {
    await run();
  } catch (caught) {
    error = caught;
  }
  if (!(error instanceof BatchJobsError)) throw new Error(`${label}; got ${error === undefined ? "a successful result" : String(error)}`);
  if (error.code !== code) throw new Error(`${label}; got code ${error.code} (${error.message})`);
}
