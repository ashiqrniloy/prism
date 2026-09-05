# Speech synthesis and transcription

## What it does

`SpeechProvider` is the provider-neutral speech contract: text→audio via
`synthesize` (full bytes) and `synthesizeStream` (first chunk as soon as the
provider responds). `TranscriptionProvider` is audio→text via `transcribe`
(one-shot) and `transcribeStream` (partial `TranscriptDelta` events, then one
`done`), sharing the Realtime `transcript_delta` event naming. Adapters ship in
[`@arnilo/prism-providers/openai`](providers/openai.md) (`/v1/audio/speech`,
`/v1/audio/transcriptions`); offline conformance runs via `runSpeechConformance`
and `runTranscriptionConformance` from `@arnilo/prism/testing/provider-conformance`.

## When to use it

Use it for one-shot voice output and batch/stream transcription where the host
owns playback, capture, and audio storage. Do not use it for interactive
bidirectional voice — that is the Realtime session contract
([`RealtimeSession`](public-contracts.md)), which keeps its own
`audio_delta`/`transcript_delta` events. Streaming here is one-directional:
synthesis streams audio out, transcription streams text in.

## Inputs / request

| Field | Type | Meaning |
| --- | --- | --- |
| `model` | `string` | Speech model (`tts-1`, `gpt-4o-mini-tts`) or transcription model (`whisper-1`, `gpt-4o-transcribe`). |
| `input` | `string` (speech) | Text to speak; non-empty, within the provider input cap (OpenAI: 4,096 chars). |
| `audio` | `Uint8Array` (transcription) | Audio bytes; non-empty, within the provider cap (OpenAI: 25 MiB). |
| `voice` / `format` / `speed` | `string?` / `string?` / `number?` (speech) | Voice id, audio container (`mp3`, `wav`, `opus`), playback speed. Adapter defaults when omitted. |
| `format` / `language` / `prompt` | `string?` | Audio container hint (maps to the upload filename), ISO-639-1 hint, spelling hint. |
| `signal` | `AbortSignal?` | Cancellation; observed by the adapter transport. |

Adapter options: `apiKey` (`CredentialValueSource` — the existing credential
seam, resolved per call and redacted from errors), `baseUrl`, `fetch` (inject a
fake transport for offline tests), `headers`, provider defaults
(`voice`/`format`), and `maxAudioBytes` (response ceiling for synthesis,
input ceiling for transcription).

## Outputs / response / events

| Field | Type | Meaning |
| --- | --- | --- |
| `audio` | `Uint8Array` / `ReadableStream<Uint8Array>` | Full synthesized bytes, or chunks in order — the first chunk is available as soon as the provider responds. |
| `format` | `string` | Actual audio container (request value or provider default). |
| `text` | `string` | Transcript; `TranscriptDone.text` is the final full text. |
| `usage` | `Usage?` | Transcription token usage (streaming `done` reports it; one-shot when the provider includes it). |

Streaming transcription yields `TranscriptDelta` (`{ type: "transcript_delta",
text }`, naming aligned with `RealtimeEvent.transcript_delta` — no `role`) then
exactly one `TranscriptDone`.

Failures throw `SpeechError` / `TranscriptionError` with a stable `code`:
`empty_input` (no text / no audio), `input_too_large` (speech text over the
provider cap), `audio_too_large` (transcription audio over the cap),
`request_failed` (non-2xx or stream error, secret-redacted message),
`response_malformed` (missing text, over-ceiling audio bytes),
`unsupported_model` (via `assertSpeechSupported` / `assertTranscriptionSupported`
when the host checks `ModelCapabilities.speech` / `transcription`).

## Request/response example

```json
{ "model": "tts-1", "input": "hello", "voice": "alloy", "response_format": "mp3" }
```

## Implementation example

```ts
import { createOpenAISpeechProvider, createOpenAITranscriptionProvider } from "@arnilo/prism-providers/openai";
import { runSpeechConformance, runTranscriptionConformance } from "@arnilo/prism/testing/provider-conformance";

const speech = createOpenAISpeechProvider({ apiKey: process.env.OPENAI_API_KEY });
const { audio } = await speech.synthesize({ model: "tts-1", input: "hi", voice: "alloy" });
const streamed = await speech.synthesizeStream({ model: "tts-1", input: "hi" });
// streamed.audio is a ReadableStream<Uint8Array>; first chunk resolves at first response bytes

const transcription = createOpenAITranscriptionProvider({ apiKey: process.env.OPENAI_API_KEY });
const { text } = await transcription.transcribe({ model: "whisper-1", audio, format: "mp3" });
for await (const event of transcription.transcribeStream({ model: "whisper-1", audio })) {
  if (event.type === "transcript_delta") process.stdout.write(event.text);
}

// Offline conformance (fake transport, no network):
await runSpeechConformance({
  provider: createOpenAISpeechProvider({ apiKey: "sk-test", fetch: fakeFetch }),
  model: "tts-1",
  maxInputChars: 4096,
  sample: { input: "hi", voice: "alloy" },
});
```

## Extension and configuration notes

- Implement `SpeechProvider` / `TranscriptionProvider` for other vendors; the
  contracts are structural — no base class, no registry.
- Models declare support with `capabilities.speech` / `capabilities.transcription`;
  hosts gate with the `modelSupports*` / `assert*Supported` guards, mirroring the
  structured-output and embeddings guard pattern.
- `synthesizeStream` returns a Web `ReadableStream` and `transcribeStream` an
  `AsyncIterable` — the repo's streaming conventions; no Node-only stream types.
- Adapters never truncate: over-cap inputs and responses reject with typed
  errors, so callers own splitting long text or large audio.

## Security and performance notes

- API keys resolve through the existing `CredentialValueSource` seam and are
  redacted from every thrown error (`redactSecrets`); no new secret paths.
- Synthesized audio is consumed under a byte ceiling
  (`DEFAULT_SPEECH_MAX_AUDIO_BYTES`, 25 MiB; `maxAudioBytes` override) — the
  stream errors instead of buffering without bound; transcription input is
  capped before any network I/O.
- Audio content and transcript text are never logged; error messages carry
  status and a redacted body only.
- One HTTP request per call; streaming paths forward provider chunks as they
  arrive (first byte at provider RTT, no full-response buffering).

## Related APIs

- [Realtime sessions](public-contracts.md): `RealtimeSession` for interactive
  bidirectional voice; `RealtimeEvent.transcript_delta` is this contract's
  naming anchor.
- [Provider conformance](provider-conformance.md): `runSpeechConformance` /
  `runTranscriptionConformance` and the offline conformance matrix.
- [Provider packages](provider-packages.md): subpath import rules for
  `@arnilo/prism-providers/openai`.
