/**
 * Run-owned Playwright BrowserContext manager.
 * One non-persistent context per run; actions serialize through a per-run queue.
 * Task 6: egress routing, side-effect hooks, upload/download/screenshot policy.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { ACTION_HANDLERS, isActionName } from "./actions/index.js";
import type { ActionContext, ManagedPage, PageCdpState, RunSession } from "./actions/types.js";
import { type CdpMode, cdpNetworkEnable, cdpRuntimeEnable, createPageCdpSession, resolveCdpMode } from "./cdp.js";
import { type BrowserDownloadOptions, cleanupDownloads, createDownloadBudget, quarantineDownload } from "./downloads.js";
import { BrowserError } from "./errors.js";
import { evaluateInPage } from "./evaluate.js";
import { type BrowserLimitOptions, type ResolvedBrowserLimits, resolveBrowserLimits } from "./limits.js";
import { assertBrowserUrlAllowed, type BrowserNetworkPolicy, createNetworkBudget, installNetworkRouting } from "./network.js";
import { createObservationRing, installCdpObservation } from "./observe.js";
import { classifyBrowserOperation, isSideEffectAction } from "./policy.js";
import { createScreenshotBudget } from "./screenshot.js";
import { captureAriaSnapshot, toSnapshotResult } from "./snapshot.js";
import { resolveTargetLocator } from "./targets.js";
import type {
  BrowserActionName,
  BrowserActRequest,
  BrowserActResult,
  BrowserCdpOptions,
  BrowserDownloadInfo,
  BrowserEvaluateRequest,
  BrowserEvaluateResult,
  BrowserObserveResult,
  BrowserOpenResult,
  BrowserPageInfo,
  BrowserSnapshotResult,
  BrowserTarget,
  PlaywrightBrowser,
  PlaywrightBrowserContext,
  PlaywrightDialog,
  PlaywrightDownload,
  PlaywrightPage,
} from "./types.js";
import { type BrowserUploadOptions, createUploadBudget } from "./uploads.js";

export interface CreateBrowserManagerOptions {
  readonly browser: PlaywrightBrowser;
  readonly limits?: BrowserLimitOptions;
  /** CDP capability gating (Tasks 4-5, 0.1.4): default "auto" — enabled on Chromium hosts. */
  readonly cdp?: BrowserCdpOptions;
  /** Optional host hook invoked just before a mutating/high-impact action. */
  readonly beforeSideEffect?: (info: {
    runId: string;
    action: BrowserActionName | "evaluate" | "observe";
    url?: string;
    pageId?: string;
    origin?: string;
    paths?: readonly string[];
    resource?: string;
    metadata?: Readonly<Record<string, unknown>>;
  }) => void | Promise<void>;
  /**
   * Egress policy for context routing. Defaults to deny private/loopback/file/data
   * and requireContainedProxy:true (fail closed without host attestation).
   * Playwright routing is defense in depth — not a DNS firewall.
   */
  readonly networkPolicy?: BrowserNetworkPolicy;
  readonly uploads?: BrowserUploadOptions;
  readonly downloads?: BrowserDownloadOptions;
}

export interface BrowserManager {
  readonly limits: ResolvedBrowserLimits;
  open(runId: string, options?: { url?: string; signal?: AbortSignal }): Promise<BrowserOpenResult>;
  snapshot(runId: string, options?: { pageId?: string; signal?: AbortSignal }): Promise<BrowserSnapshotResult>;
  act(runId: string, request: BrowserActRequest, options?: { signal?: AbortSignal }): Promise<BrowserActResult>;
  evaluate(runId: string, request: BrowserEvaluateRequest, options?: { signal?: AbortSignal }): Promise<BrowserEvaluateResult>;
  observe(runId: string, options?: { pageId?: string; signal?: AbortSignal }): Promise<BrowserObserveResult>;
  closeRun(runId: string): Promise<void>;
  close(): Promise<void>;
  hasRun(runId: string): boolean;
  listDownloads(runId: string): readonly BrowserDownloadInfo[];
}

let pageSeq = 0;
function nextPageId(): string {
  pageSeq += 1;
  return `page_${pageSeq}`;
}

function defaultNetworkPolicy(input?: BrowserNetworkPolicy): BrowserNetworkPolicy {
  return {
    requireContainedProxy: input?.requireContainedProxy ?? true,
    allowLoopback: input?.allowLoopback ?? false,
    allowPrivateHosts: input?.allowPrivateHosts ?? false,
    ...(input?.containedProxyAttestation ? { containedProxyAttestation: input.containedProxyAttestation } : {}),
    ...(input?.validateUrl ? { validateUrl: input.validateUrl } : {}),
  };
}

export function createBrowserManager(options: CreateBrowserManagerOptions): BrowserManager {
  if (!options?.browser || typeof options.browser.newContext !== "function") {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "createBrowserManager requires a host-supplied Playwright Browser with newContext()");
  }
  const limits = resolveBrowserLimits(options.limits);
  const networkPolicy = defaultNetworkPolicy(options.networkPolicy);
  const cdpMode: CdpMode = resolveCdpMode(options.cdp);
  const runs = new Map<string, RunSession>();
  const creating = new Map<string, Promise<RunSession>>();
  let closed = false;

  const manager: BrowserManager = {
    limits,
    async open(runId, openOptions) {
      assertManagerOpen();
      const id = assertRunId(runId);
      if (openOptions?.url) {
        assertInputBytes(openOptions.url);
        await assertBrowserUrlAllowed(openOptions.url, networkPolicy);
      }
      const session = await ensureSession(id);
      return enqueue(session, openOptions?.signal, async () => {
        assertSessionUsable(session);
        chargeWallTime(session);
        if (openOptions?.url) {
          await maybeSideEffect(session, "navigate", { url: openOptions.url });
          await navigateActive(session, openOptions.url, openOptions.signal);
        }
        return summarizeOpen(session);
      });
    },

    async snapshot(runId, snapOptions) {
      assertManagerOpen();
      const id = assertRunId(runId);
      const session = runs.get(id);
      if (!session) throw new BrowserError("ERR_PRISM_BROWSER_STATE", `No browser context for run ${id}`);
      return enqueue(session, snapOptions?.signal, async () => {
        assertSessionUsable(session);
        chargeWallTime(session);
        const page = resolvePage(session, snapOptions?.pageId);
        const live = await captureAriaSnapshot(page.page, page.pageId, limits);
        session.snapshot = live;
        return toSnapshotResult(live);
      });
    },

    async act(runId, request, actOptions) {
      assertManagerOpen();
      const id = assertRunId(runId);
      const session = runs.get(id);
      if (!session) throw new BrowserError("ERR_PRISM_BROWSER_STATE", `No browser context for run ${id}`);
      return enqueue(session, actOptions?.signal, async () => {
        assertSessionUsable(session);
        chargeWallTime(session);
        return performAction(session, request, actOptions?.signal);
      });
    },

    async evaluate(runId, request, evalOptions) {
      assertManagerOpen();
      const id = assertRunId(runId);
      const session = runs.get(id);
      if (!session) throw new BrowserError("ERR_PRISM_BROWSER_STATE", `No browser context for run ${id}`);
      return enqueue(session, evalOptions?.signal, async () => {
        assertSessionUsable(session);
        chargeWallTime(session);
        const page = resolvePage(session, request.pageId);
        chargeAction(session);
        await maybeSideEffect(session, "evaluate", { pageId: page.pageId });
        const state = await ensurePageCdp(session, page);
        const outcome = await evaluateInPage(state.session, request, limits);
        return {
          pageId: page.pageId,
          url: safeUrl(page.page),
          ...(outcome.value !== undefined ? { value: outcome.value } : {}),
          ...(outcome.exception !== undefined ? { exception: outcome.exception } : {}),
          ...(outcome.truncated ? { truncated: true } : {}),
        };
      });
    },

    async observe(runId, observeOptions) {
      assertManagerOpen();
      const id = assertRunId(runId);
      const session = runs.get(id);
      if (!session) throw new BrowserError("ERR_PRISM_BROWSER_STATE", `No browser context for run ${id}`);
      return enqueue(session, observeOptions?.signal, async () => {
        assertSessionUsable(session);
        chargeWallTime(session);
        const page = resolvePage(session, observeOptions?.pageId);
        const state = await ensurePageCdp(session, page);
        if (!state.domainsEnabled) {
          await cdpRuntimeEnable(state.session);
          await cdpNetworkEnable(state.session);
          state.domainsEnabled = true;
        }
        const { console: consoleEntries, network, truncated } = state.ring.drain();
        return {
          pageId: page.pageId,
          url: safeUrl(page.page),
          console: consoleEntries,
          network,
          truncated,
        };
      });
    },

    async closeRun(runId) {
      const id = assertRunId(runId);
      const session = runs.get(id);
      if (!session) return;
      await disposeSession(session);
      runs.delete(id);
    },

    async close() {
      closed = true;
      const sessions = [...runs.values()];
      runs.clear();
      await Promise.all(sessions.map((session) => disposeSession(session)));
    },

    hasRun(runId) {
      return runs.has(runId);
    },

    listDownloads(runId) {
      const session = runs.get(assertRunId(runId));
      if (!session) return [];
      return [...session.downloadBudget.items.values()].map(toDownloadInfo);
    },
  };

  return manager;

  function assertManagerOpen(): void {
    if (closed) throw new BrowserError("ERR_PRISM_BROWSER_CLOSED", "Browser manager is closed");
  }

  function assertSessionUsable(session: RunSession): void {
    if (session.closed) {
      throw new BrowserError("ERR_PRISM_BROWSER_CLOSED", `Browser context for run ${session.runId} is closed`);
    }
    if (session.crashed) {
      throw new BrowserError("ERR_PRISM_BROWSER_CLOSED", `Browser context for run ${session.runId} crashed`);
    }
  }

  async function ensureSession(runId: string): Promise<RunSession> {
    const existing = runs.get(runId);
    if (existing && !existing.closed) return existing;
    const pending = creating.get(runId);
    if (pending) return pending;
    const created = createSession(runId).finally(() => creating.delete(runId));
    creating.set(runId, created);
    return created;
  }

  async function createSession(runId: string): Promise<RunSession> {
    if (runs.has(runId)) return runs.get(runId)!;
    const acceptDownloads = Boolean(options.downloads);
    let context: PlaywrightBrowserContext;
    try {
      context = await options.browser.newContext({
        serviceWorkers: "block",
        acceptDownloads,
        ...(networkPolicy.containedProxyAttestation ? { proxy: { server: networkPolicy.containedProxyAttestation.proxyEndpoint } } : {}),
      });
    } catch (error) {
      throw new BrowserError(
        "ERR_PRISM_BROWSER",
        `Failed to create BrowserContext: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    context.setDefaultTimeout?.(limits.actionTimeoutMs);
    context.setDefaultNavigationTimeout?.(limits.navigationTimeoutMs);

    const session: RunSession = {
      runId,
      context,
      createdAt: Date.now(),
      pages: new Map(),
      activePageId: undefined,
      actionCount: 0,
      popupCount: 0,
      dialogCount: 0,
      listenerCount: 0,
      snapshot: undefined,
      pendingDialog: undefined,
      closed: false,
      crashed: false,
      queue: Promise.resolve(),
      queued: 0,
      cleanup: [],
      networkBudget: createNetworkBudget(),
      uploadBudget: createUploadBudget(),
      downloadBudget: createDownloadBudget(),
      screenshotBudget: createScreenshotBudget(),
      lastDownloadId: undefined,
      cdpPages: new Map(),
    };

    // Always install routing for defense-in-depth scheme/private denial.
    try {
      const uninstall = await installNetworkRouting({
        context,
        policy: networkPolicy,
        limits,
        budget: session.networkBudget,
      });
      session.cleanup.push(uninstall);
      session.listenerCount += 1;
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }

    const onPage = (pageOrDownload: PlaywrightPage | PlaywrightDownload) => {
      if (!pageOrDownload || typeof (pageOrDownload as PlaywrightPage).goto !== "function") return;
      void acceptPage(session, pageOrDownload as PlaywrightPage, "popup");
    };
    context.on("page", onPage);
    session.cleanup.push(() => context.off?.("page", onPage as never));
    session.listenerCount += 1;

    if (acceptDownloads && options.downloads) {
      const onDownload = (download: PlaywrightDownload) => {
        void (async () => {
          try {
            const meta = await quarantineDownload(download, options.downloads!, limits, session.downloadBudget);
            session.lastDownloadId = meta.downloadId;
          } catch {
            /* quarantine errors surface on next download_release / list; do not freeze queue */
          }
        })();
      };
      context.on("download", onDownload as (pageOrDownload: PlaywrightPage | PlaywrightDownload) => void);
      session.cleanup.push(() => context.off?.("download", onDownload as never));
      session.listenerCount += 1;
    }

    const first = await context.newPage();
    await acceptPage(session, first, "main");
    runs.set(runId, session);
    return session;
  }

  async function acceptPage(session: RunSession, page: PlaywrightPage, kind: "main" | "popup"): Promise<ManagedPage | undefined> {
    if (session.closed) {
      try {
        await page.close();
      } catch {
        /* ignore */
      }
      return undefined;
    }
    if (kind === "popup") {
      if (session.popupCount >= limits.maxPopups || session.pages.size >= limits.maxPages) {
        try {
          await page.close();
        } catch {
          /* ignore */
        }
        invalidateSnapshot(session);
        return undefined;
      }
      session.popupCount += 1;
    } else if (session.pages.size >= limits.maxPages) {
      try {
        await page.close();
      } catch {
        /* ignore */
      }
      throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `maxPages ${limits.maxPages} exceeded`);
    }

    const managed: ManagedPage = {
      pageId: nextPageId(),
      page,
      kind,
      closed: false,
    };
    session.pages.set(managed.pageId, managed);
    if (!session.activePageId) session.activePageId = managed.pageId;

    const onDialog = (dialog: PlaywrightDialog) => {
      session.dialogCount += 1;
      if (session.dialogCount > limits.maxDialogs) {
        void dialog.dismiss().catch(() => undefined);
        return;
      }
      session.pendingDialog = dialog;
    };
    const onClose = () => {
      managed.closed = true;
      if (session.activePageId === managed.pageId) {
        session.activePageId = [...session.pages.values()].find((p) => !p.closed)?.pageId;
      }
      invalidateSnapshot(session);
    };
    const onCrash = () => {
      managed.closed = true;
      session.crashed = true;
      invalidateSnapshot(session);
    };
    page.on("dialog", onDialog);
    page.on("close", onClose);
    page.on("crash", onCrash);
    session.listenerCount += 3;
    session.cleanup.push(() => {
      page.off?.("dialog", onDialog as never);
      page.off?.("close", onClose as never);
      page.off?.("crash", onCrash as never);
    });
    invalidateSnapshot(session);
    return managed;
  }

  async function enqueue<T>(session: RunSession, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    if (session.queued >= limits.maxQueuedActions) {
      throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `maxQueuedActions ${limits.maxQueuedActions} exceeded`);
    }
    session.queued += 1;
    const run = session.queue.then(async () => {
      throwIfAborted(signal);
      return work();
    });
    session.queue = run.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await run;
    } finally {
      session.queued = Math.max(0, session.queued - 1);
    }
  }

  async function performAction(
    session: RunSession,
    request: BrowserActRequest,
    signal: AbortSignal | undefined,
  ): Promise<BrowserActResult> {
    throwIfAborted(signal);
    const action = request.action;
    if (!isActionName(action)) {
      throw new BrowserError("ERR_PRISM_BROWSER_INPUT", `Unsupported action: ${String(action)}`);
    }
    const handler = ACTION_HANDLERS[action];
    if (!handler) {
      throw new BrowserError("ERR_PRISM_BROWSER_INPUT", `Unsupported action: ${action}`);
    }
    const ctx: ActionContext = {
      limits,
      networkPolicy,
      downloads: options.downloads,
      uploads: options.uploads,
      chargeAction,
      maybeSideEffect,
      resultFor,
      resolvePage,
      assertInputBytes,
      invalidateSnapshot,
      safeUrl,
      resolveTargetForAction,
      navigateActive,
      ensurePageCdp,
      toDownloadInfo,
      throwIfAborted,
    };
    return handler(ctx, session, request, signal);
  }

  async function ensurePageCdp(session: RunSession, page: ManagedPage): Promise<PageCdpState> {
    if (cdpMode === "off") {
      throw new BrowserError("ERR_PRISM_BROWSER_CDP_UNAVAILABLE", "CDP tools are disabled (cdp mode 'off')");
    }
    const existing = session.cdpPages.get(page.pageId);
    if (existing) return existing;
    const cdpSession = await createPageCdpSession(options.browser, session.context, page.page);
    const ring = createObservationRing({
      maxConsoleEntries: limits.maxConsoleEntries,
      maxNetworkRequests: limits.maxNetworkRequests,
    });
    const unsubscribe = installCdpObservation(cdpSession, ring);
    const state: PageCdpState = {
      session: cdpSession,
      ring,
      unsubscribe,
      domainsEnabled: false,
      blockedPatterns: undefined,
      throttled: false,
      emulated: false,
    };
    session.cdpPages.set(page.pageId, state);
    session.cleanup.push(() => {
      try {
        state.unsubscribe();
      } catch {
        /* ignore */
      }
      void cdpSession.detach?.().catch(() => undefined);
    });
    return state;
  }

  async function resolveTargetForAction(session: RunSession, page: PlaywrightPage, target: BrowserTarget, snapshotId: string | undefined) {
    if ("ref" in target) {
      const live = session.snapshot;
      if (!live || live.snapshotId !== snapshotId) {
        throw new BrowserError("ERR_PRISM_BROWSER_TARGET", "Stale snapshotId; call browser_snapshot before using refs");
      }
      return resolveTargetLocator(page, target, live.refs, live.snapshotId);
    }
    return resolveTargetLocator(page, target, undefined, undefined);
  }

  async function navigateActive(session: RunSession, url: string, signal: AbortSignal | undefined, pageId?: string): Promise<void> {
    throwIfAborted(signal);
    await assertBrowserUrlAllowed(url, networkPolicy);
    const page = resolvePage(session, pageId);
    await page.page.goto(url, {
      timeout: limits.navigationTimeoutMs,
      waitUntil: "domcontentloaded",
    });
    invalidateSnapshot(session);
  }

  async function maybeSideEffect(
    session: RunSession,
    action: BrowserActionName | "evaluate" | "observe",
    meta: {
      url?: string;
      pageId?: string;
      paths?: readonly string[];
      resource?: string;
      dialogResponse?: "accept" | "dismiss";
      pageKind?: "main" | "popup";
    },
  ): Promise<void> {
    if (!options.beforeSideEffect) return;
    const classified = classifyBrowserOperation(action, {
      dialogResponse: meta.dialogResponse,
      hasUrl: Boolean(meta.url),
      pageKind: meta.pageKind,
    });
    if (!classified.requiresSideEffectHook && !isSideEffectAction(action)) return;
    if (!classified.requiresSideEffectHook) return;
    let origin: string | undefined;
    if (meta.url) {
      try {
        origin = new URL(meta.url).origin;
      } catch {
        origin = undefined;
      }
    }
    await options.beforeSideEffect({
      runId: session.runId,
      action,
      url: meta.url,
      pageId: meta.pageId,
      origin,
      paths: meta.paths,
      resource: meta.resource,
      metadata: {
        action,
        effect: classified.effect,
        risk: classified.risk,
        operation: classified.operation,
      },
    });
  }

  function resolvePage(session: RunSession, pageId?: string): ManagedPage {
    const id = pageId ?? session.activePageId;
    if (!id) throw new BrowserError("ERR_PRISM_BROWSER_STATE", "No active page");
    const page = session.pages.get(id);
    if (!page || page.closed || page.page.isClosed()) {
      throw new BrowserError("ERR_PRISM_BROWSER_STATE", `Page ${id} is closed`);
    }
    return page;
  }

  function chargeWallTime(session: RunSession): void {
    if (Date.now() - session.createdAt > limits.runWallTimeMs) {
      throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `runWallTimeMs ${limits.runWallTimeMs} exceeded`);
    }
  }

  function chargeAction(session: RunSession): void {
    if (session.actionCount >= limits.maxActions) {
      throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `maxActions ${limits.maxActions} exceeded`);
    }
    session.actionCount += 1;
  }

  function assertInputBytes(value: string): void {
    if (Buffer.byteLength(value, "utf8") > limits.maxActionInputBytes) {
      throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `action input exceeds maxActionInputBytes ${limits.maxActionInputBytes}`);
    }
  }

  function resultFor(session: RunSession, action: BrowserActionName, page: ManagedPage): BrowserActResult {
    return {
      action,
      pageId: page.pageId,
      url: safeUrl(page.page),
      title: "",
      pages: listPages(session),
    };
  }

  async function disposeSession(session: RunSession): Promise<void> {
    if (session.closed) return;
    session.closed = true;
    invalidateSnapshot(session);
    await cleanupDownloads(session.downloadBudget).catch(() => undefined);
    for (const dispose of session.cleanup.splice(0)) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
    session.cdpPages.clear();
    const closePromise = session.context.close();
    const grace = sleep(limits.closeGraceMs);
    await Promise.race([closePromise.catch(() => undefined), grace]);
    try {
      await closePromise;
    } catch {
      /* ignore */
    }
  }

  function summarizeOpen(session: RunSession): BrowserOpenResult {
    const page = resolvePage(session);
    return {
      runId: session.runId,
      pageId: page.pageId,
      url: safeUrl(page.page),
      title: "",
      pages: listPages(session),
    };
  }
}

function listPages(session: RunSession): BrowserPageInfo[] {
  const out: BrowserPageInfo[] = [];
  for (const page of session.pages.values()) {
    if (page.closed) continue;
    out.push({
      pageId: page.pageId,
      url: safeUrl(page.page),
      title: "",
      active: page.pageId === session.activePageId,
      kind: page.kind,
    });
  }
  return out;
}

function toDownloadInfo(meta: {
  downloadId: string;
  suggestedName: string;
  bytes: number;
  sha256: string;
  mimeType?: string;
  released: boolean;
  url: string;
}): BrowserDownloadInfo {
  return {
    downloadId: meta.downloadId,
    suggestedName: meta.suggestedName,
    bytes: meta.bytes,
    sha256: meta.sha256,
    mimeType: meta.mimeType,
    released: meta.released,
    url: meta.url,
  };
}

function invalidateSnapshot(session: RunSession): void {
  session.snapshot = undefined;
}

function safeUrl(page: PlaywrightPage): string {
  try {
    return page.url().slice(0, 2_048);
  } catch {
    return "";
  }
}

function assertRunId(runId: string): string {
  if (typeof runId !== "string" || !runId || Buffer.byteLength(runId, "utf8") > 256) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "runId must be a non-empty string ≤256 bytes");
  }
  return runId;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new BrowserError("ERR_PRISM_BROWSER", "Operation aborted");
  }
}
