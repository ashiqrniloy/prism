import { open, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { MemoryValidationError } from "../errors.js";
import { LOCK_FILE } from "./layout.js";

/**
 * Write serialization for the markdown store: an in-process promise queue plus a cross-process
 * `<root>/.lock` (`open wx`). A stale lock (dead owner pid, or older than 30 s) is reclaimed.
 */

const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const sleep = (ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

async function acquireFileLock(lockPath: string): Promise<() => Promise<void>> {
  const start = Date.now();
  let delay = 10;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`);
      return async () => {
        await handle.close();
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    try {
      const info = await stat(lockPath);
      const raw = await readFile(lockPath, "utf8").catch(() => "");
      const pid = Number.parseInt(raw.trim(), 10);
      if (!Number.isFinite(pid) || !isAlive(pid) || Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        await rm(lockPath, { force: true });
        continue;
      }
    } catch {
      // The lock disappeared between attempts; retry immediately.
    }
    if (Date.now() - start > LOCK_TIMEOUT_MS) {
      throw new MemoryValidationError(`timed out acquiring the markdown store lock: ${lockPath}`);
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 200);
  }
}

export interface WriteLock {
  run<T>(fn: () => Promise<T>): Promise<T>;
  drain(): Promise<void>;
}

export function createWriteLock(root: string): WriteLock {
  const lockPath = join(root, LOCK_FILE);
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const next = tail.then(async () => {
        const release = await acquireFileLock(lockPath);
        try {
          return await fn();
        } finally {
          await release();
        }
      });
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    async drain() {
      await tail;
    },
  };
}
