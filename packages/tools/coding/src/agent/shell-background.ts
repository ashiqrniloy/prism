/**
 * Background processes for the coding tools (plan 189 Task 9).
 *
 * One lazy runtime over the process-session library: nothing is constructed until the first
 * `shell({ background: true })` call, so a session that never backgrounds a command pays nothing.
 * Every process is owned by the calling session (`owner: sessionId`), which gives the invariants
 * for free: `get(id, sessionId)` refuses another session's id, `cancelOwned(sessionId)` kills
 * exactly that session's processes without touching another's, and the listener in `src/index.ts`
 * makes `session.closed` — also emitted for every open session by `agent.dispose()` — the kill
 * switch.
 *
 * The process-session registry is the single spawner: this module never spawns a child itself.
 */

import type { ExecutionPolicy } from "./execution-policy.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, HARD_MAX_LINES, validateCodingLimit } from "./limits.js";
import { createProcessSessions } from "./process/sessions.js";
import type { ProcessSandboxBackend, ProcessSession, ProcessSessions } from "./process/types.js";
import { ProcessSessionError } from "./process/types.js";
import type { ShellConfig } from "./shell.js";
import { formatSize, truncateTail } from "./truncate.js";

/** Default live background processes per session. */
export const DEFAULT_MAX_BACKGROUND_PROCESSES = 4;
/** Hard cap on live background processes per session. */
export const HARD_MAX_BACKGROUND_PROCESSES = 16;
/** How long `shell({ background: true })` waits for first output before returning. */
export const BACKGROUND_FIRST_OUTPUT_MS = 1000;
/** Longest `shell_output({ waitSeconds })` may wait. */
export const HARD_MAX_BACKGROUND_WAIT_SECONDS = 60;

export interface BackgroundProcessOptions {
  /** Per-session live process cap (default 4, hard 16). */
  readonly maxProcesses?: number;
  /** Per-process wall lifetime (default: the process-session default, 4 h). */
  readonly maxLifetimeMs?: number;
  /** Caps for the output `shell_output` returns (default 2000 lines / 50KB tail). */
  readonly maxLines?: number;
  readonly maxBytes?: number;
  /** Resolved shell (`<shell> -c <command>`), so background commands run exactly like foreground ones. */
  readonly shell?: ShellConfig;
  /** The same adapter the shell uses; absent means native spawn on the host. */
  readonly sandbox?: ProcessSandboxBackend;
  readonly policy?: ExecutionPolicy;
}

export interface BackgroundStartInput {
  /** The command as the shell tool would run it (after `commandPrefix`, `spawnHook`, policy rewrite). */
  readonly command: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly sessionId: string;
}

export interface BackgroundStarted {
  readonly id: string;
  /** Output that arrived within {@link BACKGROUND_FIRST_OUTPUT_MS}, formatted with the shell's caps. */
  readonly output: string;
  readonly running: boolean;
  readonly exitCode: number | null;
}

export interface BackgroundReadInput {
  readonly id: string;
  readonly sessionId: string;
  readonly waitSeconds: number;
  readonly kill: boolean;
}

export interface BackgroundRead {
  readonly id: string;
  /** Output produced since the previous `shell_output` call for this id. */
  readonly output: string;
  readonly running: boolean;
  readonly exitCode: number | null;
  readonly state: string;
}

export interface BackgroundProcesses {
  readonly maxProcesses: number;
  start(input: BackgroundStartInput): Promise<BackgroundStarted>;
  read(input: BackgroundReadInput): Promise<BackgroundRead>;
  /** Kill every process this session owns. Idempotent; also runs on `session.closed`. */
  killSession(sessionId: string): Promise<void>;
  /** Live (starting/running) processes owned by `sessionId`. */
  liveCount(sessionId: string): number;
}

interface Tracked {
  readonly handle: ProcessSession;
  readonly cwd: string;
  cursor: number;
}

export function createBackgroundProcesses(options: BackgroundProcessOptions = {}): BackgroundProcesses {
  const maxProcesses = validateCodingLimit(
    "maxProcesses",
    options.maxProcesses ?? DEFAULT_MAX_BACKGROUND_PROCESSES,
    HARD_MAX_BACKGROUND_PROCESSES,
  );
  const maxLines = validateCodingLimit("maxLines", options.maxLines ?? DEFAULT_MAX_LINES, HARD_MAX_LINES);
  const shell: ShellConfig = options.shell ?? { shell: "/bin/sh", args: ["-c"] };
  const tracked = new Map<string, Tracked>();
  // One registry per workspace root: the session library contains every cwd under its own root,
  // and a worktree-bound session runs in a directory outside the package root.
  const registries = new Map<string, ProcessSessions>();

  const sessions = (cwd: string): ProcessSessions => {
    const existing = registries.get(cwd);
    if (existing !== undefined) return existing;
    const created = createProcessSessions({
      cwd,
      ...(options.sandbox !== undefined ? { sandbox: options.sandbox } : {}),
      ...(options.policy !== undefined ? { policy: options.policy } : {}),
      // The per-session cap below is the real bound; this only bounds the total.
      limits: {
        maxSessions: HARD_MAX_BACKGROUND_PROCESSES * 2,
        ...(options.maxLifetimeMs !== undefined ? { maxLifetimeMs: options.maxLifetimeMs } : {}),
      },
    });
    registries.set(cwd, created);
    return created;
  };

  /** The registries this session actually owns processes in. */
  const registriesOf = (sessionId: string): ProcessSessions[] => [...new Set(owned(sessionId).map((entry) => sessions(entry.cwd)))];

  const owned = (sessionId: string): Tracked[] => [...tracked.values()].filter((e) => e.handle.owner === sessionId);
  const alive = (handle: ProcessSession): boolean => handle.state === "starting" || handle.state === "running";
  const live = (sessionId: string): Tracked[] => owned(sessionId).filter((e) => alive(e.handle));

  const exitOf = async (handle: ProcessSession): Promise<number | null> => {
    if (alive(handle)) return null;
    // Resolves immediately for a finished record; never a fabricated code for a live one.
    return (await handle.wait()).exitCode;
  };

  const format = (data: string): string => {
    if (data.length === 0) return "";
    const truncation = truncateTail(data, { maxLines, maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES });
    return truncation.truncated
      ? `${truncation.content}\n\n[showing the last ${formatSize(truncation.outputBytes)} of ${truncation.totalLines} new line(s)]`
      : truncation.content;
  };

  /** Keep at most 32 finished records per session so a chatty session cannot grow the map. */
  const prune = (sessionId: string): void => {
    const finished = owned(sessionId).filter((e) => !alive(e.handle));
    for (const entry of finished.slice(0, Math.max(0, finished.length - 32))) tracked.delete(entry.handle.id);
  };

  /** One chunk from the cursor; the chunk cap keeps each read bounded. */
  const readOnce = async (entry: Tracked): Promise<string> => {
    const chunk = await entry.handle.output({ cursor: entry.cursor });
    entry.cursor = chunk.cursor;
    return chunk.data;
  };

  /**
   * Everything that accumulated since the last call, in whole chunks, so one `shell_output` sees a
   * burst instead of only its first chunk. Bounded at twice the format cap: anything past that is
   * truncated away by `format` anyway.
   */
  const drainLimitBytes = (options.maxBytes ?? DEFAULT_MAX_BYTES) * 2;
  const readAvailable = async (entry: Tracked): Promise<string> => {
    let data = "";
    while (data.length < drainLimitBytes) {
      const chunk = await readOnce(entry);
      data += chunk;
      if (chunk.length === 0) break;
    }
    return data;
  };

  /**
   * Waits for the next publication (`ProcessSession.onOutput`: a chunk or the terminal transition)
   * or `ms`, never polls. Returns what accumulated in the meantime.
   */
  const waitFor = async (entry: Tracked, ms: number): Promise<string> => {
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    let unsubscribe = (): void => undefined;
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
    };
    const signalled = new Promise<void>((resolve) => {
      // Subscribe before the first read, so a chunk published in between cannot be missed.
      unsubscribe = entry.handle.onOutput(() => {
        stop();
        resolve();
      });
      timer = setTimeout(() => {
        stop();
        resolve();
      }, ms);
    });
    try {
      const immediate = await readAvailable(entry);
      if (immediate.length > 0 || !alive(entry.handle)) return immediate;
      await signalled;
      return await readAvailable(entry);
    } finally {
      stop();
    }
  };

  return {
    maxProcesses,

    async start(input) {
      const running = live(input.sessionId).length;
      if (running >= maxProcesses) {
        throw new ProcessSessionError(
          "ERR_PRISM_PROCESS_LIMIT",
          `session already has ${running} background process(es) (max ${maxProcesses}); call shell_output({ id, kill: true }) first`,
        );
      }
      const env: Record<string, string> = {};
      for (const [name, value] of Object.entries(input.env)) if (value !== undefined) env[name] = value;
      const handle = await sessions(input.cwd).start({
        command: shell.shell,
        args: [...shell.args, input.command],
        cwd: input.cwd,
        env,
        owner: input.sessionId,
      });
      const entry: Tracked = { handle, cwd: input.cwd, cursor: 0 };
      tracked.set(handle.id, entry);
      prune(input.sessionId);
      const output = format(await waitFor(entry, BACKGROUND_FIRST_OUTPUT_MS));
      return { id: handle.id, output, running: alive(handle), exitCode: await exitOf(handle) };
    },

    async read(input) {
      const entry = tracked.get(input.id);
      if (entry === undefined) {
        throw new ProcessSessionError("ERR_PRISM_PROCESS_STATE", `unknown process: ${input.id}`);
      }
      // Throws ERR_PRISM_PROCESS_OWNERSHIP for another session's id; never leaks its output.
      const handle = sessions(entry.cwd).get(input.id, input.sessionId);
      if (input.kill && alive(handle)) await handle.kill();
      const output = format(
        input.waitSeconds > 0
          ? await waitFor(entry, Math.min(input.waitSeconds, HARD_MAX_BACKGROUND_WAIT_SECONDS) * 1000)
          : await readAvailable(entry),
      );
      return { id: handle.id, output, running: alive(handle), exitCode: await exitOf(handle), state: handle.state };
    },

    async killSession(sessionId) {
      const entries = owned(sessionId);
      if (entries.length === 0) return;
      for (const registry of registriesOf(sessionId)) await registry.cancelOwned(sessionId);
      for (const [id, entry] of tracked) if (entry.handle.owner === sessionId) tracked.delete(id);
    },

    liveCount(sessionId) {
      return live(sessionId).length;
    },
  };
}
