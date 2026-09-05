import type { BrowserDownloadOptions, DownloadBudget } from "../downloads.js";
import type { ResolvedBrowserLimits } from "../limits.js";
import type { BrowserNetworkPolicy, NetworkBudget } from "../network.js";
import type { ObservationRing } from "../observe.js";
import type { ScreenshotBudget } from "../screenshot.js";
import type { LiveSnapshot } from "../snapshot.js";
import type {
  BrowserActionName,
  BrowserActRequest,
  BrowserActResult,
  BrowserDownloadInfo,
  BrowserTarget,
  PlaywrightBrowserContext,
  PlaywrightCdpSession,
  PlaywrightDialog,
  PlaywrightLocator,
  PlaywrightPage,
} from "../types.js";
import type { BrowserUploadOptions, UploadBudget } from "../uploads.js";

export interface ManagedPage {
  readonly pageId: string;
  readonly page: PlaywrightPage;
  readonly kind: "main" | "popup";
  closed: boolean;
}

/** Per-page CDP state: session, observation ring, network/emulation controls. */
export interface PageCdpState {
  readonly session: PlaywrightCdpSession;
  readonly ring: ObservationRing;
  readonly unsubscribe: () => void;
  domainsEnabled: boolean;
  blockedPatterns: readonly string[] | undefined;
  throttled: boolean;
  emulated: boolean;
}

export interface RunSession {
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
  readonly cdpPages: Map<string, PageCdpState>;
}

export interface ActionContext {
  readonly limits: ResolvedBrowserLimits;
  readonly networkPolicy: BrowserNetworkPolicy;
  readonly downloads: BrowserDownloadOptions | undefined;
  readonly uploads: BrowserUploadOptions | undefined;
  chargeAction(session: RunSession): void;
  maybeSideEffect(
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
  ): Promise<void>;
  resultFor(session: RunSession, action: BrowserActionName, page: ManagedPage): BrowserActResult;
  resolvePage(session: RunSession, pageId?: string): ManagedPage;
  assertInputBytes(value: string): void;
  invalidateSnapshot(session: RunSession): void;
  safeUrl(page: PlaywrightPage): string;
  resolveTargetForAction(
    session: RunSession,
    page: PlaywrightPage,
    target: BrowserTarget,
    snapshotId: string | undefined,
  ): Promise<PlaywrightLocator>;
  navigateActive(session: RunSession, url: string, signal: AbortSignal | undefined, pageId?: string): Promise<void>;
  ensurePageCdp(session: RunSession, page: ManagedPage): Promise<PageCdpState>;
  toDownloadInfo(meta: {
    downloadId: string;
    suggestedName: string;
    bytes: number;
    sha256: string;
    mimeType?: string;
    released: boolean;
    url: string;
  }): BrowserDownloadInfo;
  throwIfAborted(signal: AbortSignal | undefined): void;
}

export type ActionHandler = (
  ctx: ActionContext,
  session: RunSession,
  request: BrowserActRequest,
  signal: AbortSignal | undefined,
) => Promise<BrowserActResult>;
