/** Finite browser defaults/hard caps frozen in Phase 4 review-coverage. */

export const DEFAULT_MAX_PAGES = 4;
export const HARD_MAX_PAGES = 16;
export const DEFAULT_MAX_ACTIONS = 100;
export const HARD_MAX_ACTIONS = 256;
export const DEFAULT_MAX_QUEUED_ACTIONS = 16;
export const HARD_MAX_QUEUED_ACTIONS = 64;

export const DEFAULT_MAX_SNAPSHOT_REFS = 2_000;
export const HARD_MAX_SNAPSHOT_REFS = 10_000;
export const DEFAULT_MAX_SNAPSHOT_DEPTH = 30;
export const HARD_MAX_SNAPSHOT_DEPTH = 100;
export const DEFAULT_MAX_SNAPSHOT_BYTES = 256 * 1024;
export const HARD_MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

export const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
export const HARD_NAVIGATION_TIMEOUT_MS = 120_000;
export const DEFAULT_ACTION_TIMEOUT_MS = 10_000;
export const HARD_ACTION_TIMEOUT_MS = 60_000;
export const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
export const HARD_WAIT_TIMEOUT_MS = 120_000;
export const DEFAULT_RUN_WALL_TIME_MS = 20 * 60_000;
export const HARD_RUN_WALL_TIME_MS = 30 * 60_000;

export const DEFAULT_MAX_POPUPS = 4;
export const HARD_MAX_POPUPS = 16;
export const DEFAULT_MAX_DIALOGS = 16;
export const HARD_MAX_DIALOGS = 64;
export const DEFAULT_MAX_LISTENERS = 64;
export const HARD_MAX_LISTENERS = 256;

export const DEFAULT_MAX_ACTION_INPUT_BYTES = 64 * 1024;
export const HARD_MAX_ACTION_INPUT_BYTES = 256 * 1024;
export const DEFAULT_CLOSE_GRACE_MS = 5_000;
export const HARD_CLOSE_GRACE_MS = 30_000;

/** Network / artifact caps (Task 6). */
export const DEFAULT_MAX_NETWORK_REQUESTS = 1_000;
export const HARD_MAX_NETWORK_REQUESTS = 10_000;
export const DEFAULT_MAX_REDIRECTS_PER_REQUEST = 10;
export const HARD_MAX_REDIRECTS_PER_REQUEST = 32;
export const DEFAULT_MAX_WEBSOCKETS = 8;
export const HARD_MAX_WEBSOCKETS = 32;

export const DEFAULT_MAX_SCREENSHOTS = 16;
export const HARD_MAX_SCREENSHOTS = 64;
export const DEFAULT_MAX_SCREENSHOT_MEGAPIXELS = 16;
export const HARD_MAX_SCREENSHOT_MEGAPIXELS = 64;
export const DEFAULT_MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const HARD_MAX_SCREENSHOT_BYTES = 32 * 1024 * 1024;

export const DEFAULT_MAX_UPLOADS = 8;
export const HARD_MAX_UPLOADS = 32;
export const DEFAULT_MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
export const HARD_MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_UPLOAD_AGGREGATE_BYTES = 64 * 1024 * 1024;
export const HARD_MAX_UPLOAD_AGGREGATE_BYTES = 256 * 1024 * 1024;

export const DEFAULT_MAX_DOWNLOADS = 8;
export const HARD_MAX_DOWNLOADS = 32;
export const DEFAULT_MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
export const HARD_MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MAX_DOWNLOAD_AGGREGATE_BYTES = 64 * 1024 * 1024;
export const HARD_MAX_DOWNLOAD_AGGREGATE_BYTES = 512 * 1024 * 1024;

/** CDP (Task 4, 0.1.4): evaluate/observe/network-control bounds. */
export const DEFAULT_MAX_EVALUATE_RESULT_BYTES = 64 * 1024;
export const HARD_MAX_EVALUATE_RESULT_BYTES = 256 * 1024;
export const DEFAULT_MAX_CONSOLE_ENTRIES = 200;
export const HARD_MAX_CONSOLE_ENTRIES = 500;
export const DEFAULT_MAX_BLOCKED_URL_PATTERNS = 32;
export const HARD_MAX_BLOCKED_URL_PATTERNS = 128;
/** Hard caps for CDP throttle/emulate inputs (validated at action time, not configurable). */
export const HARD_MAX_THROTTLE_LATENCY_MS = 120_000;
export const HARD_MAX_THROTTLE_KBPS = 1_000_000;
export const HARD_MAX_EMULATE_DIMENSION = 16_384;
export const HARD_MAX_DEVICE_SCALE_FACTOR = 10;
export const HARD_MAX_EMULATE_UA_BYTES = 2_048;

export interface BrowserLimitOptions {
  readonly maxPages?: number;
  readonly maxActions?: number;
  readonly maxQueuedActions?: number;
  readonly maxSnapshotRefs?: number;
  readonly maxSnapshotDepth?: number;
  readonly maxSnapshotBytes?: number;
  readonly navigationTimeoutMs?: number;
  readonly actionTimeoutMs?: number;
  readonly waitTimeoutMs?: number;
  readonly runWallTimeMs?: number;
  readonly maxPopups?: number;
  readonly maxDialogs?: number;
  readonly maxListeners?: number;
  readonly maxActionInputBytes?: number;
  readonly closeGraceMs?: number;
  readonly maxNetworkRequests?: number;
  readonly maxRedirectsPerRequest?: number;
  readonly maxWebSockets?: number;
  readonly maxScreenshots?: number;
  readonly maxScreenshotMegapixels?: number;
  readonly maxScreenshotBytes?: number;
  readonly maxUploads?: number;
  readonly maxUploadBytes?: number;
  readonly maxUploadAggregateBytes?: number;
  readonly maxDownloads?: number;
  readonly maxDownloadBytes?: number;
  readonly maxDownloadAggregateBytes?: number;
  readonly maxEvaluateResultBytes?: number;
  readonly maxConsoleEntries?: number;
  readonly maxBlockedUrlPatterns?: number;
}

export interface ResolvedBrowserLimits {
  readonly maxPages: number;
  readonly maxActions: number;
  readonly maxQueuedActions: number;
  readonly maxSnapshotRefs: number;
  readonly maxSnapshotDepth: number;
  readonly maxSnapshotBytes: number;
  readonly navigationTimeoutMs: number;
  readonly actionTimeoutMs: number;
  readonly waitTimeoutMs: number;
  readonly runWallTimeMs: number;
  readonly maxPopups: number;
  readonly maxDialogs: number;
  readonly maxListeners: number;
  readonly maxActionInputBytes: number;
  readonly closeGraceMs: number;
  readonly maxNetworkRequests: number;
  readonly maxRedirectsPerRequest: number;
  readonly maxWebSockets: number;
  readonly maxScreenshots: number;
  readonly maxScreenshotMegapixels: number;
  readonly maxScreenshotBytes: number;
  readonly maxUploads: number;
  readonly maxUploadBytes: number;
  readonly maxUploadAggregateBytes: number;
  readonly maxDownloads: number;
  readonly maxDownloadBytes: number;
  readonly maxDownloadAggregateBytes: number;
  readonly maxEvaluateResultBytes: number;
  readonly maxConsoleEntries: number;
  readonly maxBlockedUrlPatterns: number;
}

const DEFAULTS: ResolvedBrowserLimits = {
  maxPages: DEFAULT_MAX_PAGES,
  maxActions: DEFAULT_MAX_ACTIONS,
  maxQueuedActions: DEFAULT_MAX_QUEUED_ACTIONS,
  maxSnapshotRefs: DEFAULT_MAX_SNAPSHOT_REFS,
  maxSnapshotDepth: DEFAULT_MAX_SNAPSHOT_DEPTH,
  maxSnapshotBytes: DEFAULT_MAX_SNAPSHOT_BYTES,
  navigationTimeoutMs: DEFAULT_NAVIGATION_TIMEOUT_MS,
  actionTimeoutMs: DEFAULT_ACTION_TIMEOUT_MS,
  waitTimeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
  runWallTimeMs: DEFAULT_RUN_WALL_TIME_MS,
  maxPopups: DEFAULT_MAX_POPUPS,
  maxDialogs: DEFAULT_MAX_DIALOGS,
  maxListeners: DEFAULT_MAX_LISTENERS,
  maxActionInputBytes: DEFAULT_MAX_ACTION_INPUT_BYTES,
  closeGraceMs: DEFAULT_CLOSE_GRACE_MS,
  maxNetworkRequests: DEFAULT_MAX_NETWORK_REQUESTS,
  maxRedirectsPerRequest: DEFAULT_MAX_REDIRECTS_PER_REQUEST,
  maxWebSockets: DEFAULT_MAX_WEBSOCKETS,
  maxScreenshots: DEFAULT_MAX_SCREENSHOTS,
  maxScreenshotMegapixels: DEFAULT_MAX_SCREENSHOT_MEGAPIXELS,
  maxScreenshotBytes: DEFAULT_MAX_SCREENSHOT_BYTES,
  maxUploads: DEFAULT_MAX_UPLOADS,
  maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
  maxUploadAggregateBytes: DEFAULT_MAX_UPLOAD_AGGREGATE_BYTES,
  maxDownloads: DEFAULT_MAX_DOWNLOADS,
  maxDownloadBytes: DEFAULT_MAX_DOWNLOAD_BYTES,
  maxDownloadAggregateBytes: DEFAULT_MAX_DOWNLOAD_AGGREGATE_BYTES,
  maxEvaluateResultBytes: DEFAULT_MAX_EVALUATE_RESULT_BYTES,
  maxConsoleEntries: DEFAULT_MAX_CONSOLE_ENTRIES,
  maxBlockedUrlPatterns: DEFAULT_MAX_BLOCKED_URL_PATTERNS,
};

const HARD: ResolvedBrowserLimits = {
  maxPages: HARD_MAX_PAGES,
  maxActions: HARD_MAX_ACTIONS,
  maxQueuedActions: HARD_MAX_QUEUED_ACTIONS,
  maxSnapshotRefs: HARD_MAX_SNAPSHOT_REFS,
  maxSnapshotDepth: HARD_MAX_SNAPSHOT_DEPTH,
  maxSnapshotBytes: HARD_MAX_SNAPSHOT_BYTES,
  navigationTimeoutMs: HARD_NAVIGATION_TIMEOUT_MS,
  actionTimeoutMs: HARD_ACTION_TIMEOUT_MS,
  waitTimeoutMs: HARD_WAIT_TIMEOUT_MS,
  runWallTimeMs: HARD_RUN_WALL_TIME_MS,
  maxPopups: HARD_MAX_POPUPS,
  maxDialogs: HARD_MAX_DIALOGS,
  maxListeners: HARD_MAX_LISTENERS,
  maxActionInputBytes: HARD_MAX_ACTION_INPUT_BYTES,
  closeGraceMs: HARD_CLOSE_GRACE_MS,
  maxNetworkRequests: HARD_MAX_NETWORK_REQUESTS,
  maxRedirectsPerRequest: HARD_MAX_REDIRECTS_PER_REQUEST,
  maxWebSockets: HARD_MAX_WEBSOCKETS,
  maxScreenshots: HARD_MAX_SCREENSHOTS,
  maxScreenshotMegapixels: HARD_MAX_SCREENSHOT_MEGAPIXELS,
  maxScreenshotBytes: HARD_MAX_SCREENSHOT_BYTES,
  maxUploads: HARD_MAX_UPLOADS,
  maxUploadBytes: HARD_MAX_UPLOAD_BYTES,
  maxUploadAggregateBytes: HARD_MAX_UPLOAD_AGGREGATE_BYTES,
  maxDownloads: HARD_MAX_DOWNLOADS,
  maxDownloadBytes: HARD_MAX_DOWNLOAD_BYTES,
  maxDownloadAggregateBytes: HARD_MAX_DOWNLOAD_AGGREGATE_BYTES,
  maxEvaluateResultBytes: HARD_MAX_EVALUATE_RESULT_BYTES,
  maxConsoleEntries: HARD_MAX_CONSOLE_ENTRIES,
  maxBlockedUrlPatterns: HARD_MAX_BLOCKED_URL_PATTERNS,
};

export const DEFAULT_BROWSER_LIMITS = DEFAULTS;
export const HARD_BROWSER_LIMITS = HARD;

function validate(name: keyof ResolvedBrowserLimits, value: number): number {
  const hard = HARD[name];
  if (!Number.isSafeInteger(value) || value < 1 || value > hard) {
    throw new RangeError(`${name} must be a positive safe integer at most ${hard}`);
  }
  return value;
}

export function resolveBrowserLimits(input: BrowserLimitOptions = {}): ResolvedBrowserLimits {
  return {
    maxPages: validate("maxPages", input.maxPages ?? DEFAULTS.maxPages),
    maxActions: validate("maxActions", input.maxActions ?? DEFAULTS.maxActions),
    maxQueuedActions: validate("maxQueuedActions", input.maxQueuedActions ?? DEFAULTS.maxQueuedActions),
    maxSnapshotRefs: validate("maxSnapshotRefs", input.maxSnapshotRefs ?? DEFAULTS.maxSnapshotRefs),
    maxSnapshotDepth: validate("maxSnapshotDepth", input.maxSnapshotDepth ?? DEFAULTS.maxSnapshotDepth),
    maxSnapshotBytes: validate("maxSnapshotBytes", input.maxSnapshotBytes ?? DEFAULTS.maxSnapshotBytes),
    navigationTimeoutMs: validate("navigationTimeoutMs", input.navigationTimeoutMs ?? DEFAULTS.navigationTimeoutMs),
    actionTimeoutMs: validate("actionTimeoutMs", input.actionTimeoutMs ?? DEFAULTS.actionTimeoutMs),
    waitTimeoutMs: validate("waitTimeoutMs", input.waitTimeoutMs ?? DEFAULTS.waitTimeoutMs),
    runWallTimeMs: validate("runWallTimeMs", input.runWallTimeMs ?? DEFAULTS.runWallTimeMs),
    maxPopups: validate("maxPopups", input.maxPopups ?? DEFAULTS.maxPopups),
    maxDialogs: validate("maxDialogs", input.maxDialogs ?? DEFAULTS.maxDialogs),
    maxListeners: validate("maxListeners", input.maxListeners ?? DEFAULTS.maxListeners),
    maxActionInputBytes: validate("maxActionInputBytes", input.maxActionInputBytes ?? DEFAULTS.maxActionInputBytes),
    closeGraceMs: validate("closeGraceMs", input.closeGraceMs ?? DEFAULTS.closeGraceMs),
    maxNetworkRequests: validate("maxNetworkRequests", input.maxNetworkRequests ?? DEFAULTS.maxNetworkRequests),
    maxRedirectsPerRequest: validate("maxRedirectsPerRequest", input.maxRedirectsPerRequest ?? DEFAULTS.maxRedirectsPerRequest),
    maxWebSockets: validate("maxWebSockets", input.maxWebSockets ?? DEFAULTS.maxWebSockets),
    maxScreenshots: validate("maxScreenshots", input.maxScreenshots ?? DEFAULTS.maxScreenshots),
    maxScreenshotMegapixels: validate("maxScreenshotMegapixels", input.maxScreenshotMegapixels ?? DEFAULTS.maxScreenshotMegapixels),
    maxScreenshotBytes: validate("maxScreenshotBytes", input.maxScreenshotBytes ?? DEFAULTS.maxScreenshotBytes),
    maxUploads: validate("maxUploads", input.maxUploads ?? DEFAULTS.maxUploads),
    maxUploadBytes: validate("maxUploadBytes", input.maxUploadBytes ?? DEFAULTS.maxUploadBytes),
    maxUploadAggregateBytes: validate("maxUploadAggregateBytes", input.maxUploadAggregateBytes ?? DEFAULTS.maxUploadAggregateBytes),
    maxDownloads: validate("maxDownloads", input.maxDownloads ?? DEFAULTS.maxDownloads),
    maxDownloadBytes: validate("maxDownloadBytes", input.maxDownloadBytes ?? DEFAULTS.maxDownloadBytes),
    maxDownloadAggregateBytes: validate("maxDownloadAggregateBytes", input.maxDownloadAggregateBytes ?? DEFAULTS.maxDownloadAggregateBytes),
    maxEvaluateResultBytes: validate("maxEvaluateResultBytes", input.maxEvaluateResultBytes ?? DEFAULTS.maxEvaluateResultBytes),
    maxConsoleEntries: validate("maxConsoleEntries", input.maxConsoleEntries ?? DEFAULTS.maxConsoleEntries),
    maxBlockedUrlPatterns: validate("maxBlockedUrlPatterns", input.maxBlockedUrlPatterns ?? DEFAULTS.maxBlockedUrlPatterns),
  };
}
