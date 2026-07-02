/**
 * A single SSE frame decoded from the NeuralWatt stream. `data` frames carry
 * Chat Completions JSON payloads; `comment` frames carry NeuralWatt `: energy`
 * / `: cost` telemetry comments.
 */
export type NeuralWattSseFrame =
  | { readonly kind: "data"; readonly data: string }
  | { readonly kind: "comment"; readonly text: string };

/**
 * NeuralWatt SSE reader. Mirrors the OpenAI-compatible `data:` SSE convention
 * and additionally surfaces `:` comment frames so NeuralWatt's `: energy` /
 * `: cost` telemetry is no longer silently dropped. Parsing is a single pass
 * over the chunk buffer; no full-completion buffering.
 */
export async function* readNeuralWattSseFrames(body: ReadableStream<Uint8Array>): AsyncIterable<NeuralWattSseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) yield* frameData(part);
  }

  buffer += decoder.decode();
  if (buffer) yield* frameData(buffer);
}

function* frameData(event: string): Iterable<NeuralWattSseFrame> {
  const dataLines: string[] = [];
  for (const line of event.split(/\r?\n/)) {
    if (line.startsWith(":")) {
      yield { kind: "comment", text: line.slice(1).trimStart() };
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  const data = dataLines.join("\n").trim();
  if (data) yield { kind: "data", data };
}
