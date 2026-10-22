import { writeFile as fsWriteFile, open } from "node:fs/promises";

import type { WorkSandboxFilesystem } from "./filesystem.js";

/**
 * `node:fs`-backed `WorkSandboxFilesystem` rooted at an absolute host path. The host chooses the
 * root; every path is resolved and contained by {@link resolveSandboxPath} before it reaches here.
 * Reads are bounded before allocation, so an oversize file fails closed instead of loading.
 */
export function createLocalWorkFilesystem(root: string): WorkSandboxFilesystem {
  return {
    root,
    async readFile(path, options) {
      const handle = await open(path, "r");
      try {
        const buffer = Buffer.alloc(options.maxBytes + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
        if (bytesRead > options.maxBytes) {
          throw new Error(`file exceeds the ${options.maxBytes} byte cap`);
        }
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },
    async writeFile(path, bytes, options) {
      if (bytes.byteLength > options.maxBytes) {
        throw new Error(`bytes exceed the ${options.maxBytes} byte cap`);
      }
      await fsWriteFile(path, bytes);
    },
  };
}
