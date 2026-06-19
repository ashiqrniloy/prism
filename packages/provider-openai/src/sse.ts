export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) yield* eventData(part);
  }

  buffer += decoder.decode();
  if (buffer) yield* eventData(buffer);
}

function* eventData(event: string): Iterable<string> {
  const lines = event.split(/\r?\n/).filter((line) => line.startsWith("data:"));
  if (lines.length) yield lines.map((line) => line.slice(5).trimStart()).join("\n").trim();
}
