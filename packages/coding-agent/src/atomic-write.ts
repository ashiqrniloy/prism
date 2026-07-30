/**
 * Same-directory temp + rename for crash-safe UTF-8 file replacement.
 * Custom WriteOperations/EditOperations should provide equivalent durability.
 */
import { randomBytes } from "node:crypto";
import { rename as fsRename, unlink as fsUnlink, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function atomicWriteUtf8File(targetPath: string, content: string, options?: { signal?: AbortSignal }): Promise<void> {
  const dir = dirname(targetPath);
  const tempPath = join(dir, `.prism-write-${randomBytes(8).toString("hex")}`);
  try {
    await fsWriteFile(tempPath, content, { encoding: "utf-8", signal: options?.signal });
    if (options?.signal?.aborted) {
      await fsUnlink(tempPath).catch(() => {});
      throw new Error("Operation aborted");
    }
    await fsRename(tempPath, targetPath);
  } catch (error) {
    await fsUnlink(tempPath).catch(() => {});
    throw error;
  }
}
