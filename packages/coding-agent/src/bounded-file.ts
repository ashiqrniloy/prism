import { open } from "node:fs/promises";

/** Read one regular-file snapshot no larger than `maxBytes`; always closes its handle. */
export async function readFileBounded(
  path: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const size = (await handle.stat()).size;
    if (size > maxBytes) throw new Error(`File exceeds ${maxBytes} byte limit`);
    const buffer = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      if (signal?.aborted) throw new Error("Operation aborted");
      const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
