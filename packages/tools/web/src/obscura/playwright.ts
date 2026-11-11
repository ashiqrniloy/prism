/**
 * Structural Playwright surface the Obscura CDP composition consumes.
 *
 * Mirrors the subset of `packages/tools/browser/src/types.ts` that `connectObscuraCdp` needs,
 * so this package carries no runtime or type dependency on the browser package. The two copies
 * are structurally identical; a later phase that consolidates browser automation can share one.
 */
export interface PlaywrightLocator {
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  type?(text: string, options?: { timeout?: number; delay?: number }): Promise<void>;
  pressSequentially?(text: string, options?: { timeout?: number; delay?: number }): Promise<void>;
  selectOption(
    values: string | readonly string[] | { label?: string; value?: string } | ReadonlyArray<{ label?: string; value?: string }>,
    options?: { timeout?: number },
  ): Promise<string[]>;
  check(options?: { timeout?: number }): Promise<void>;
  uncheck(options?: { timeout?: number }): Promise<void>;
  scrollIntoViewIfNeeded?(options?: { timeout?: number }): Promise<void>;
  setInputFiles?(
    files: string | readonly string[] | { name: string; mimeType: string; buffer: Buffer },
    options?: { timeout?: number },
  ): Promise<void>;
  count(): Promise<number>;
  first(): PlaywrightLocator;
  nth(index: number): PlaywrightLocator;
}

export interface PlaywrightDialog {
  type(): string;
  message(): string;
  accept(promptText?: string): Promise<void>;
  dismiss(): Promise<void>;
}

export interface PlaywrightRequest {
  url(): string;
  resourceType?(): string;
  redirectedFrom?(): PlaywrightRequest | null;
  method?(): string;
}

export interface PlaywrightRoute {
  request(): PlaywrightRequest;
  continue(options?: { url?: string; headers?: Record<string, string> }): Promise<void>;
  abort(errorCode?: string): Promise<void>;
  fulfill?(options?: { status?: number; body?: string | Buffer; contentType?: string }): Promise<void>;
}

export interface PlaywrightDownload {
  url(): string;
  suggestedFilename(): string;
  createReadStream?(): Promise<NodeJS.ReadableStream | null>;
  saveAs?(path: string): Promise<void>;
  cancel?(): Promise<void>;
  failure?(): Promise<string | null>;
}

export interface PlaywrightPage {
  readonly url: () => string;
  title(): Promise<string>;
  goto(url: string, options?: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit" }): Promise<unknown>;
  ariaSnapshot(options?: { mode?: "ai" | "default"; depth?: number; boxes?: boolean; timeout?: number }): Promise<string>;
  screenshot?(options?: {
    type?: "png" | "jpeg";
    fullPage?: boolean;
    clip?: { x: number; y: number; width: number; height: number };
    timeout?: number;
  }): Promise<Buffer>;
  locator(selector: string): PlaywrightLocator;
  getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean }): PlaywrightLocator;
  getByLabel(text: string | RegExp, options?: { exact?: boolean }): PlaywrightLocator;
  getByTestId(testId: string | RegExp): PlaywrightLocator;
  getByText(text: string | RegExp, options?: { exact?: boolean }): PlaywrightLocator;
  waitForTimeout?(timeout: number): Promise<void>;
  waitForURL?(url: string | RegExp, options?: { timeout?: number }): Promise<void>;
  waitForSelector?(selector: string, options?: { timeout?: number }): Promise<unknown>;
  close(): Promise<void>;
  isClosed(): boolean;
  on(event: "dialog", handler: (dialog: PlaywrightDialog) => void): void;
  on(event: "popup" | "close" | "crash" | "download", handler: (page?: PlaywrightPage | PlaywrightDownload) => void): void;
  off?(event: string, handler: (...args: never[]) => void): void;
  once?(event: string, handler: (...args: never[]) => void): void;
  mouse?: {
    wheel(deltaX: number, deltaY: number): Promise<void>;
  };
  evaluate?<T = unknown>(pageFunction: string | ((arg: unknown) => T | Promise<T>), arg?: unknown): Promise<T>;
}

export interface PlaywrightBrowserContext {
  newPage(): Promise<PlaywrightPage>;
  pages(): PlaywrightPage[];
  close(): Promise<void>;
  on(event: "page" | "download", handler: (pageOrDownload: PlaywrightPage | PlaywrightDownload) => void): void;
  off?(event: string, handler: (...args: never[]) => void): void;
  route?(url: string | RegExp, handler: (route: PlaywrightRoute) => unknown): Promise<void>;
  unroute?(url: string | RegExp, handler?: (route: PlaywrightRoute) => unknown): Promise<void>;
  setDefaultTimeout?(timeout: number): void;
  setDefaultNavigationTimeout?(timeout: number): void;
  /** CDP (Chromium only): page-level Chrome DevTools Protocol session. */
  newCDPSession?(page: PlaywrightPage): Promise<PlaywrightCdpSession>;
}

export interface PlaywrightBrowser {
  newContext(options?: {
    serviceWorkers?: "allow" | "block";
    acceptDownloads?: boolean;
    javaScriptEnabled?: boolean;
    userAgent?: string;
    viewport?: { width: number; height: number } | null;
    // Host may pass storageState; Prism never returns or persists it.
    storageState?: string | { cookies?: unknown[]; origins?: unknown[] };
    proxy?: { server: string; bypass?: string; username?: string; password?: string };
  }): Promise<PlaywrightBrowserContext>;
  isConnected?(): boolean;
  version?(): string;
  close?(): Promise<void>;
  /** CDP (Chromium only): browser-level Chrome DevTools Protocol session. */
  newBrowserCDPSession?(): Promise<PlaywrightCdpSession>;
}

/**
 * Structural Chrome DevTools Protocol session surface (playwright-core CDPSession).
 * Hosts that want CDP tools must supply a Chromium-based Playwright Browser whose
 * contexts expose newCDPSession(page); fakes in tests supply the same surface.
 * No playwright import occurs at package load time.
 */
export interface PlaywrightCdpSession {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(event: string, handler: (params: Record<string, unknown>) => void): void;
  off?(event: string, handler: (params: Record<string, unknown>) => void): void;
  detach?(): Promise<void>;
}
