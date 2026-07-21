/**
 * Run-owned Playwright BrowserContext manager.
 * One non-persistent context per run; actions serialize through a per-run queue.
 * Task 6: egress routing, side-effect hooks, upload/download/screenshot policy.
 */
import {
  cleanupDownloads,
  createDownloadBudget,
  quarantineDownload,
  releaseDownload,
  type BrowserDownloadOptions,
  type DownloadBudget,
} from "./downloads.js";
import { BrowserError } from "./errors.js";
import {
  resolveBrowserLimits,
  type BrowserLimitOptions,
  type ResolvedBrowserLimits,
} from "./limits.js";
import {
  assertBrowserUrlAllowed,
  createNetworkBudget,
  installNetworkRouting,
  type BrowserNetworkPolicy,
  type NetworkBudget,
} from "./network.js";
import { classifyBrowserOperation, isSideEffectAction } from "./policy.js";
import { captureBoundedScreenshot, createScreenshotBudget, type ScreenshotBudget } from "./screenshot.js";
import { captureAriaSnapshot, toSnapshotResult, type LiveSnapshot } from "./snapshot.js";
import { normalizeTarget, requireUniqueLocator, resolveTargetLocator } from "./targets.js";
import type {
  BrowserActRequest,
  BrowserActResult,
  BrowserActionName,
  BrowserDownloadInfo,
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
import {
  approveUploadPaths,
  createUploadBudget,
  type BrowserUploadOptions,
  type UploadBudget,
} from "./uploads.js";

export interface CreateBrowserManagerOptions {
  readonly browser: PlaywrightBrowser;
  readonly limits?: BrowserLimitOptions;
  /** Optional host hook invoked just before a mutating/high-impact action. */
  readonly beforeSideEffect?: (info: {
    runId: string;
    action: BrowserActionName;
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

interface ManagedPage {
  readonly pageId: string;
  readonly page: PlaywrightPage;
  readonly kind: "main" | "popup";
  closed: boolean;
}

interface RunSession {
  readonly runId: string;
  readonly context: PlaywrightBrowserContext;
  readonly createdAt: number;
  readonly pages: Map<string, ManagedPage>;
  activePageId: string | undefined;
  actionCount: number;
  popupCount: number;
  dialogCount: number;
  listenerCount: number;
  snapshot: LiveSnapshot | undefined;
  pendingDialog: PlaywrightDialog | undefined;
  closed: boolean;
  crashed: boolean;
  queue: Promise<unknown>;
  queued: number;
  readonly cleanup: Array<() => void>;
  readonly networkBudget: NetworkBudget;
  readonly uploadBudget: UploadBudget;
  readonly downloadBudget: DownloadBudget;
  readonly screenshotBudget: ScreenshotBudget;
  lastDownloadId: string | undefined;
}

export interface BrowserManager {
  readonly limits: ResolvedBrowserLimits;
  open(runId: string, options?: { url?: string; signal?: AbortSignal }): Promise<BrowserOpenResult>;
  snapshot(runId: string, options?: { pageId?: string; signal?: AbortSignal }): Promise<BrowserSnapshotResult>;
  act(runId: string, request: BrowserActRequest, options?: { signal?: AbortSignal }): Promise<BrowserActResult>;
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
    ...(input?.containedProxyAttestation
      ? { containedProxyAttestation: input.containedProxyAttestation }
      : {}),
    ...(input?.validateUrl ? { validateUrl: input.validateUrl } : {}),
  };
}

export function createBrowserManager(options: CreateBrowserManagerOptions): BrowserManager {
  if (!options?.browser || typeof options.browser.newContext !== "function") {
    throw new BrowserError(
      "ERR_PRISM_BROWSER_INPUT",
      "createBrowserManager requires a host-supplied Playwright Browser with newContext()",
    );
  }
  const limits = resolveBrowserLimits(options.limits);
  const networkPolicy = defaultNetworkPolicy(options.networkPolicy);
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
        ...(networkPolicy.containedProxyAttestation
          ? { proxy: { server: networkPolicy.containedProxyAttestation.proxyEndpoint } }
          : {}),
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
            const meta = await quarantineDownload(
              download,
              options.downloads!,
              limits,
              session.downloadBudget,
            );
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

  async function enqueue<T>(
    session: RunSession,
    signal: AbortSignal | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
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

    if (action === "select_page") {
      const id = request.pageId;
      if (typeof id !== "string" || !id) {
        throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "select_page requires pageId");
      }
      const page = session.pages.get(id);
      if (!page || page.closed) {
        throw new BrowserError("ERR_PRISM_BROWSER_STATE", `Unknown or closed pageId ${id}`);
      }
      chargeAction(session);
      await maybeSideEffect(session, action, {
        pageId: id,
        pageKind: page.kind,
      });
      session.activePageId = id;
      return resultFor(session, action, page);
    }

    if (action === "dialog") {
      chargeAction(session);
      await maybeSideEffect(session, action, {
        dialogResponse: request.dialogResponse ?? "dismiss",
      });
      const dialog = session.pendingDialog;
      if (!dialog) {
        throw new BrowserError("ERR_PRISM_BROWSER_STATE", "No pending dialog");
      }
      const response = request.dialogResponse ?? "dismiss";
      if (response === "accept") {
        assertInputBytes(request.promptText ?? "");
        await dialog.accept(request.promptText);
      } else {
        await dialog.dismiss();
      }
      session.pendingDialog = undefined;
      invalidateSnapshot(session);
      const page = resolvePage(session, request.pageId);
      return { ...resultFor(session, action, page), dialogHandled: true };
    }

    if (action === "download_release") {
      if (!options.downloads) {
        throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "downloads are not configured");
      }
      const downloadId = request.downloadId ?? session.lastDownloadId;
      if (!downloadId) {
        throw new BrowserError("ERR_PRISM_BROWSER_STATE", "No downloadId available");
      }
      chargeAction(session);
      await maybeSideEffect(session, action, { resource: downloadId });
      const meta = await releaseDownload(downloadId, options.downloads, session.downloadBudget);
      const page = resolvePage(session, request.pageId);
      return {
        ...resultFor(session, action, page),
        download: toDownloadInfo(meta),
      };
    }

    if (action === "screenshot") {
      const page = resolvePage(session, request.pageId);
      chargeAction(session);
      await maybeSideEffect(session, action, { pageId: page.pageId, url: safeUrl(page.page) });
      const shot = await captureBoundedScreenshot({
        page: page.page,
        limits,
        budget: session.screenshotBudget,
        fullPage: request.fullPage,
        clip: request.clip ? { ...request.clip } : undefined,
        signal,
      });
      return {
        ...resultFor(session, action, page),
        screenshotBytes: shot.bytes,
        image: shot.image,
      };
    }

    if (action === "upload") {
      if (!options.uploads) {
        throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "uploads are not configured");
      }
      const page = resolvePage(session, request.pageId);
      if (!request.target) {
        throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "upload requires target");
      }
      const paths = request.paths;
      if (!paths || paths.length === 0) {
        throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "upload requires paths");
      }
      for (const p of paths) assertInputBytes(p);
      const approved = await approveUploadPaths(paths, options.uploads, limits, session.uploadBudget);
      const target = normalizeTarget(request.target);
      if ("ref" in target && !request.snapshotId) {
        throw new BrowserError("ERR_PRISM_BROWSER_TARGET", "ref actions require snapshotId");
      }
      const locator = await resolveTargetForAction(session, page.page, target, request.snapshotId);
      const unique = await requireUniqueLocator(locator);
      if (typeof unique.setInputFiles !== "function") {
        throw new BrowserError("ERR_PRISM_BROWSER", "Locator.setInputFiles is unavailable");
      }
      chargeAction(session);
      await maybeSideEffect(session, action, {
        pageId: page.pageId,
        paths: approved.map((f) => f.path),
      });
      await unique.setInputFiles(
        approved.map((f) => f.path),
        { timeout: limits.actionTimeoutMs },
      );
      invalidateSnapshot(session);
      return {
        ...resultFor(session, action, page),
        uploads: approved.map((f) => ({ path: f.name, bytes: f.bytes, sha256: f.sha256 })),
      };
    }

    if (action === "wait") {
      chargeAction(session);
      const page = resolvePage(session, request.pageId);
      const timeout = clampTimeout(request.timeoutMs, limits.waitTimeoutMs);
      if (typeof request.url === "string" && request.url) {
        assertInputBytes(request.url);
        if (!page.page.waitForURL) {
          throw new BrowserError("ERR_PRISM_BROWSER", "Page does not support waitForURL");
        }
        await page.page.waitForURL(request.url, { timeout });
      } else if (typeof request.text === "string" && request.text) {
        assertInputBytes(request.text);
        const locator = page.page.getByText(request.text, { exact: false });
        const start = Date.now();
        while (Date.now() - start < timeout) {
          throwIfAborted(signal);
          if ((await locator.count()) > 0) break;
          await sleep(50);
        }
        if ((await locator.count()) === 0) {
          throw new BrowserError("ERR_PRISM_BROWSER", `wait text not found within ${timeout}ms`);
        }
      } else {
        await sleep(Math.min(timeout, limits.waitTimeoutMs));
      }
      return resultFor(session, action, page);
    }

    if (action === "navigate") {
      const url = request.url;
      if (typeof url !== "string" || !url) {
        throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "navigate requires url");
      }
      assertInputBytes(url);
      await assertBrowserUrlAllowed(url, networkPolicy);
      chargeAction(session);
      await maybeSideEffect(session, action, { url, pageId: request.pageId });
      await navigateActive(session, url, signal, request.pageId);
      const page = resolvePage(session, request.pageId);
      return resultFor(session, action, page);
    }

    if (action === "scroll") {
      const page = resolvePage(session, request.pageId);
      chargeAction(session);
      await maybeSideEffect(session, action, { pageId: page.pageId });
      if (request.target) {
        const target = normalizeTarget(request.target);
        const locator = await resolveTargetForAction(session, page.page, target, request.snapshotId);
        const unique = await requireUniqueLocator(locator);
        await unique.scrollIntoViewIfNeeded?.({ timeout: limits.actionTimeoutMs });
      } else if (page.page.mouse?.wheel) {
        const amount = Number.isSafeInteger(request.amount) ? Number(request.amount) : 600;
        const delta = request.direction === "up" ? -Math.abs(amount) : Math.abs(amount);
        await page.page.mouse.wheel(0, delta);
      } else {
        throw new BrowserError("ERR_PRISM_BROWSER", "scroll requires a target or page.mouse.wheel support");
      }
      invalidateSnapshot(session);
      return resultFor(session, action, page);
    }

    // Locator-backed actions.
    const page = resolvePage(session, request.pageId);
    if (!request.target) {
      throw new BrowserError("ERR_PRISM_BROWSER_INPUT", `${action} requires target`);
    }
    const target = normalizeTarget(request.target);
    if ("ref" in target && !request.snapshotId) {
      throw new BrowserError("ERR_PRISM_BROWSER_TARGET", "ref actions require snapshotId");
    }
    const locator = await resolveTargetForAction(session, page.page, target, request.snapshotId);
    const unique = await requireUniqueLocator(locator);
    chargeAction(session);
    await maybeSideEffect(session, action, { pageId: page.pageId });
    const timeout = limits.actionTimeoutMs;

    switch (action) {
      case "click":
        await unique.click({ timeout });
        break;
      case "fill": {
        const text = requireText(request.text);
        assertInputBytes(text);
        await unique.fill(text, { timeout });
        break;
      }
      case "type": {
        const text = requireText(request.text);
        assertInputBytes(text);
        if (unique.pressSequentially) await unique.pressSequentially(text, { timeout });
        else if (unique.type) await unique.type(text, { timeout });
        else await unique.fill(text, { timeout });
        break;
      }
      case "select": {
        const values = request.values;
        if (!values || values.length === 0) {
          throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "select requires values");
        }
        for (const v of values) assertInputBytes(v);
        await unique.selectOption([...values], { timeout });
        break;
      }
      case "check":
        await unique.check({ timeout });
        break;
      case "uncheck":
        await unique.uncheck({ timeout });
        break;
      default:
        throw new BrowserError("ERR_PRISM_BROWSER_INPUT", `Unsupported action: ${action}`);
    }
    invalidateSnapshot(session);
    return resultFor(session, action, page);
  }

  async function resolveTargetForAction(
    session: RunSession,
    page: PlaywrightPage,
    target: BrowserTarget,
    snapshotId: string | undefined,
  ) {
    if ("ref" in target) {
      const live = session.snapshot;
      if (!live || live.snapshotId !== snapshotId) {
        throw new BrowserError(
          "ERR_PRISM_BROWSER_TARGET",
          "Stale snapshotId; call browser_snapshot before using refs",
        );
      }
      return resolveTargetLocator(page, target, live.refs, live.snapshotId);
    }
    return resolveTargetLocator(page, target, undefined, undefined);
  }

  async function navigateActive(
    session: RunSession,
    url: string,
    signal: AbortSignal | undefined,
    pageId?: string,
  ): Promise<void> {
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
    action: BrowserActionName,
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
      throw new BrowserError(
        "ERR_PRISM_BROWSER_LIMIT",
        `action input exceeds maxActionInputBytes ${limits.maxActionInputBytes}`,
      );
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

function requireText(text: unknown): string {
  if (typeof text !== "string") {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "text is required");
  }
  return text;
}

function clampTimeout(value: number | undefined, hard: number): number {
  if (value === undefined) return hard;
  if (!Number.isSafeInteger(value) || value < 1 || value > hard) {
    throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `timeoutMs must be 1..${hard}`);
  }
  return value;
}

function isActionName(value: string): value is BrowserActionName {
  return (
    value === "navigate" ||
    value === "click" ||
    value === "type" ||
    value === "fill" ||
    value === "select" ||
    value === "check" ||
    value === "uncheck" ||
    value === "scroll" ||
    value === "wait" ||
    value === "dialog" ||
    value === "select_page" ||
    value === "upload" ||
    value === "screenshot" ||
    value === "download_release"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
