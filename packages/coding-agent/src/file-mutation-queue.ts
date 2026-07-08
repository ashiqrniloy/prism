/**
 * Serialize file mutation operations targeting the same file.
 * Operations for different files still run in parallel.
 *
 * Behavioral port of pi's core/tools/file-mutation-queue for @arnilo/prism-coding-agent.
 * stdlib only (node:fs/promises realpath, node:path resolve).
 *
 * ponytail: global process-wide Map mutex keyed by realpath. Ceiling: all
 * mutation queues share one process Map; if a host runs many concurrent
 * sessions in one process they all share the namespace (intended — same file
 * must serialize regardless of session). Upgrade path: scope the Map per
 * ToolRegistry if isolation between registries is ever needed.
 */
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

const fileMutationQueues = new Map<string, Promise<void>>();
let registrationQueue: Promise<void> = Promise.resolve();

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error as NodeJS.ErrnoException).code === "ENOTDIR")
  );
}

async function getMutationQueueKey(filePath: string): Promise<string> {
  const resolvedPath = resolve(filePath);
  try {
    return await realpath(resolvedPath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return resolvedPath;
    }
    throw error;
  }
}

/**
 * Run `fn` exclusively for `filePath`: concurrent calls with the same path
 * (or the same realpath) run one after another; calls for different paths run
 * in parallel. Resolves/rejects with `fn`'s result and always releases the slot.
 */
export async function withFileMutationQueue<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const registration = registrationQueue.then(async () => {
    const key = await getMutationQueueKey(filePath);
    const currentQueue: Promise<void> = fileMutationQueues.get(key) ?? Promise.resolve();
    let releaseNext!: () => void;
    const nextQueue = new Promise<void>((resolveQueue) => {
      releaseNext = resolveQueue;
    });
    const chainedQueue: Promise<void> = currentQueue.then(() => nextQueue);
    fileMutationQueues.set(key, chainedQueue);
    return { key, currentQueue, chainedQueue, releaseNext };
  });
  registrationQueue = registration.then(
    () => undefined,
    () => undefined,
  );
  const { key, currentQueue, chainedQueue, releaseNext } = await registration;
  await currentQueue;
  try {
    return await fn();
  } finally {
    releaseNext();
    if (fileMutationQueues.get(key) === chainedQueue) {
      fileMutationQueues.delete(key);
    }
  }
}
