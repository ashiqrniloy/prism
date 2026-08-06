/**
 * Minimal JSON-RPC LSP client over child stdio (LSP 3.17 framing).
 * Lazy start; bounded pending requests, message bytes, timeout, restart budget.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { encodeLspFrame, LspFrameError, LspFrameReader } from "./framing.js";
import { LanguageIntelligenceError, type ResolvedLanguageIntelligenceLimits } from "./types.js";

export interface LspServerSpec {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly rootUri: string;
}

type Pending = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly abortHandler?: () => void;
  readonly signal?: AbortSignal;
};

export class LspClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private reader: LspFrameReader;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private startPromise: Promise<void> | undefined;
  private disposed = false;
  private shuttingDown = false;
  private capabilities: Record<string, unknown> = {};
  /** file URI → latest diagnostics payload from publishDiagnostics */
  readonly diagnosticsByUri = new Map<string, unknown>();
  private readonly onUnexpectedExit: () => void;

  constructor(
    readonly spec: LspServerSpec,
    private readonly limits: ResolvedLanguageIntelligenceLimits,
    hooks?: { onUnexpectedExit?: () => void },
  ) {
    this.reader = new LspFrameReader(limits.maxMessageBytes);
    this.onUnexpectedExit = hooks?.onUnexpectedExit ?? (() => {});
  }

  get started(): boolean {
    return this.child !== undefined && !this.disposed;
  }

  async ensureStarted(signal?: AbortSignal): Promise<void> {
    if (this.disposed) {
      throw new LanguageIntelligenceError("ERR_PRISM_LSP_SERVER", `LSP server ${this.spec.name} is disposed`);
    }
    if (this.child) return;
    if (!this.startPromise) {
      this.startPromise = this.spawnAndInitialize(signal).finally(() => {
        this.startPromise = undefined;
      });
    }
    await this.startPromise;
  }

  async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    await this.ensureStarted(signal);
    if (this.pending.size >= this.limits.maxPendingRequests) {
      throw new LanguageIntelligenceError("ERR_PRISM_LSP_LIMIT", `LSP pending requests exceed ${this.limits.maxPendingRequests}`);
    }
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        cleanupAbort();
        reject(
          new LanguageIntelligenceError("ERR_PRISM_LSP_TIMEOUT", `LSP request ${method} timed out after ${this.limits.requestTimeoutMs}ms`),
        );
      }, this.limits.requestTimeoutMs);

      const abortHandler = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new LanguageIntelligenceError("ERR_PRISM_LSP_TIMEOUT", "LSP request aborted"));
      };
      const cleanupAbort = () => {
        if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
      };

      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          reject(new LanguageIntelligenceError("ERR_PRISM_LSP_TIMEOUT", "LSP request aborted"));
          return;
        }
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      this.pending.set(id, { resolve, reject, timer, abortHandler, signal });
      try {
        this.write(payload);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        cleanupAbort();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.child) return;
    this.write({ jsonrpc: "2.0", method, params });
  }

  hasCapability(key: string): boolean {
    return this.capabilities[key] !== undefined && this.capabilities[key] !== false;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.shuttingDown = true;
    this.rejectAll(new LanguageIntelligenceError("ERR_PRISM_LSP_SERVER", `LSP server ${this.spec.name} disposed`));
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
    if (!child.killed) {
      child.kill("SIGTERM");
    }
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      const t = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  private write(message: unknown): void {
    if (!this.child?.stdin.writable) {
      throw new LanguageIntelligenceError("ERR_PRISM_LSP_SERVER", `LSP server ${this.spec.name} stdin closed`);
    }
    const frame = encodeLspFrame(message);
    if (frame.length > this.limits.maxMessageBytes + 64) {
      // header overhead small; body already sized by JSON
      throw new LanguageIntelligenceError("ERR_PRISM_LSP_LIMIT", "Outgoing LSP frame exceeds message byte cap");
    }
    this.child.stdin.write(frame);
  }

  private async spawnAndInitialize(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new LanguageIntelligenceError("ERR_PRISM_LSP_TIMEOUT", "LSP start aborted");
    }
    this.reader = new LspFrameReader(this.limits.maxMessageBytes);
    const child = spawn(this.spec.command, [...this.spec.args], {
      cwd: this.spec.cwd,
      env: { ...process.env, ...this.spec.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    child.stdout.on("data", (chunk: Buffer) => {
      try {
        for (const msg of this.reader.push(chunk)) this.onMessage(msg);
      } catch (error) {
        this.failTransport(error);
      }
    });
    child.stderr.on("data", () => {
      /* discard; hosts can redirect via env if needed */
    });
    child.on("error", (error) => {
      this.failTransport(new LanguageIntelligenceError("ERR_PRISM_LSP_SERVER", `LSP spawn failed: ${error.message}`));
    });
    child.on("exit", (code, signalName) => {
      if (this.disposed || this.shuttingDown) return;
      this.child = undefined;
      this.rejectAll(
        new LanguageIntelligenceError("ERR_PRISM_LSP_SERVER", `LSP server ${this.spec.name} exited (code=${code}, signal=${signalName})`),
      );
      this.onUnexpectedExit();
    });

    try {
      const initResult = (await this.requestUnlocked(
        "initialize",
        {
          processId: process.pid,
          rootUri: this.spec.rootUri,
          capabilities: {
            workspace: { applyEdit: true },
            textDocument: {
              hover: { contentFormat: ["plaintext", "markdown"] },
              publishDiagnostics: {},
            },
          },
          workspaceFolders: [{ uri: this.spec.rootUri, name: "workspace" }],
        },
        signal,
      )) as { capabilities?: Record<string, unknown> };

      this.capabilities = initResult?.capabilities ?? {};
      this.notify("initialized", {});
    } catch (error) {
      this.shuttingDown = true;
      this.child = undefined;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      throw error;
    }
  }

  /** Internal request used during initialize before ensureStarted recursion. */
  private requestUnlocked(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.pending.size >= this.limits.maxPendingRequests) {
      throw new LanguageIntelligenceError("ERR_PRISM_LSP_LIMIT", `LSP pending requests exceed ${this.limits.maxPendingRequests}`);
    }
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        cleanupAbort();
        reject(
          new LanguageIntelligenceError("ERR_PRISM_LSP_TIMEOUT", `LSP request ${method} timed out after ${this.limits.requestTimeoutMs}ms`),
        );
      }, this.limits.requestTimeoutMs);

      const abortHandler = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new LanguageIntelligenceError("ERR_PRISM_LSP_TIMEOUT", "LSP request aborted"));
      };
      const cleanupAbort = () => {
        if (signal) signal.removeEventListener("abort", abortHandler);
      };

      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          reject(new LanguageIntelligenceError("ERR_PRISM_LSP_TIMEOUT", "LSP request aborted"));
          return;
        }
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      this.pending.set(id, { resolve, reject, timer, abortHandler, signal });
      try {
        this.write(payload);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        cleanupAbort();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private onMessage(msg: unknown): void {
    if (!msg || typeof msg !== "object") {
      throw new LspFrameError("ERR_PRISM_LSP_FRAMING", "LSP message is not an object");
    }
    const m = msg as {
      id?: number | string;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { message?: string; code?: number };
    };

    if (m.method && m.id === undefined) {
      if (m.method === "textDocument/publishDiagnostics" && m.params && typeof m.params === "object") {
        const p = m.params as { uri?: string; diagnostics?: unknown };
        if (typeof p.uri === "string") this.diagnosticsByUri.set(p.uri, p.diagnostics ?? []);
      }
      return;
    }

    if (m.id === undefined) return;
    const id = typeof m.id === "number" ? m.id : Number(m.id);
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (pending.signal && pending.abortHandler) {
      pending.signal.removeEventListener("abort", pending.abortHandler);
    }
    if (m.error) {
      pending.reject(new LanguageIntelligenceError("ERR_PRISM_LSP_SERVER", m.error.message ?? `LSP error code ${m.error.code}`));
      return;
    }
    pending.resolve(m.result);
  }

  private failTransport(error: unknown): void {
    const err =
      error instanceof LanguageIntelligenceError
        ? error
        : error instanceof LspFrameError
          ? new LanguageIntelligenceError(error.code, error.message)
          : new LanguageIntelligenceError("ERR_PRISM_LSP_FRAMING", error instanceof Error ? error.message : String(error));
    this.rejectAll(err);
    void this.dispose();
  }

  private rejectAll(error: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      if (p.signal && p.abortHandler) p.signal.removeEventListener("abort", p.abortHandler);
      p.reject(error);
    }
    this.pending.clear();
  }
}
