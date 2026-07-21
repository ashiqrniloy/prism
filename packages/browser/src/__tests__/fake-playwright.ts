/**
 * Network-free fake Playwright surfaces for default browser package tests.
 */
import { Readable } from "node:stream";
import type {
  PlaywrightBrowser,
  PlaywrightBrowserContext,
  PlaywrightDialog,
  PlaywrightDownload,
  PlaywrightLocator,
  PlaywrightPage,
  PlaywrightRoute,
  PlaywrightRequest,
} from "../types.js";

type Handler = (...args: never[]) => void;

class Emitter {
  private readonly map = new Map<string, Set<Handler>>();
  on(event: string, handler: Handler): void {
    let set = this.map.get(event);
    if (!set) {
      set = new Set();
      this.map.set(event, set);
    }
    set.add(handler);
  }
  off(event: string, handler: Handler): void {
    this.map.get(event)?.delete(handler);
  }
  emit(event: string, ...args: never[]): void {
    for (const handler of [...(this.map.get(event) ?? [])]) handler(...args);
  }
}

export interface FakeElement {
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  value?: string;
  checked?: boolean;
  options?: string[];
  files?: string[];
}

export class FakeLocator implements PlaywrightLocator {
  constructor(
    private readonly page: FakePage,
    private readonly resolve: () => FakeElement[],
  ) {}
  async count(): Promise<number> {
    return this.resolve().length;
  }
  first(): PlaywrightLocator {
    return new FakeLocator(this.page, () => {
      const all = this.resolve();
      return all.length ? [all[0]!] : [];
    });
  }
  nth(index: number): PlaywrightLocator {
    return new FakeLocator(this.page, () => {
      const el = this.resolve()[index];
      return el ? [el] : [];
    });
  }
  async click(): Promise<void> {
    const el = unique(this.resolve(), "click");
    this.page.record(`click:${el.ref}`);
    this.page.bumpGeneration();
  }
  async fill(value: string): Promise<void> {
    const el = unique(this.resolve(), "fill");
    el.value = value;
    this.page.record(`fill:${el.ref}:${value}`);
    this.page.bumpGeneration();
  }
  async type(text: string): Promise<void> {
    return this.fill((unique(this.resolve(), "type").value ?? "") + text);
  }
  async pressSequentially(text: string): Promise<void> {
    return this.type(text);
  }
  async selectOption(values: string | readonly string[]): Promise<string[]> {
    const el = unique(this.resolve(), "select");
    const list = Array.isArray(values) ? [...values] : [values];
    el.value = String(list[0] ?? "");
    this.page.record(`select:${el.ref}:${el.value}`);
    this.page.bumpGeneration();
    return list.map(String);
  }
  async check(): Promise<void> {
    const el = unique(this.resolve(), "check");
    el.checked = true;
    this.page.record(`check:${el.ref}`);
    this.page.bumpGeneration();
  }
  async uncheck(): Promise<void> {
    const el = unique(this.resolve(), "uncheck");
    el.checked = false;
    this.page.record(`uncheck:${el.ref}`);
    this.page.bumpGeneration();
  }
  async scrollIntoViewIfNeeded(): Promise<void> {
    const el = unique(this.resolve(), "scroll");
    this.page.record(`scroll:${el.ref}`);
  }
  async setInputFiles(files: string | readonly string[]): Promise<void> {
    const el = unique(this.resolve(), "upload");
    const list = Array.isArray(files) ? [...files] : [files];
    el.files = list.map(String);
    this.page.record(`upload:${el.ref}:${el.files.join(",")}`);
    this.page.bumpGeneration();
  }
}

/** Minimal 1x1 PNG. */
export const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export class FakePage {
  private readonly emitter = new Emitter();
  private closedFlag = false;
  private currentUrl = "about:blank";
  private currentTitle = "";
  private generation = 1;
  readonly actions: string[] = [];
  screenshotBuffer: Buffer = ONE_PX_PNG;
  elements: FakeElement[] = [
    { ref: "e1", role: "banner", name: "" },
    { ref: "e2", role: "link", name: "Home" },
    { ref: "e3", role: "textbox", name: "Search", value: "" },
    { ref: "e4", role: "button", name: "Go" },
    { ref: "e5", role: "checkbox", name: "Subscribe", checked: false },
    { ref: "e6", role: "combobox", name: "Color", value: "red", options: ["red", "blue"] },
    { ref: "e7", role: "button", name: "Upload", value: "" },
  ];
  readonly mouse = {
    wheel: async (deltaX: number, deltaY: number) => {
      this.record(`wheel:${deltaX},${deltaY}`);
    },
  };

  url(): string {
    return this.currentUrl;
  }
  async title(): Promise<string> {
    return this.currentTitle;
  }
  async goto(url: string): Promise<unknown> {
    this.currentUrl = url;
    this.currentTitle = `Title for ${url}`;
    this.bumpGeneration();
    this.record(`goto:${url}`);
    return null;
  }
  async ariaSnapshot(options?: { mode?: "ai" | "default"; depth?: number }): Promise<string> {
    if (options?.mode !== "ai") {
      return "- generic: page";
    }
    const depth = options.depth ?? 30;
    const lines = [`- generic [active] [ref=e0]:`];
    let count = 0;
    for (const el of this.elements) {
      if (count >= depth) break;
      const name = el.name ? ` "${el.name}"` : "";
      lines.push(`  - ${el.role}${name} [ref=${el.ref}]`);
      count += 1;
    }
    return lines.join("\n");
  }
  async screenshot(): Promise<Buffer> {
    this.record("screenshot");
    return this.screenshotBuffer;
  }
  locator(selector: string): PlaywrightLocator {
    if (selector.startsWith("aria-ref=")) {
      const ref = selector.slice("aria-ref=".length);
      return new FakeLocator(this, () => this.elements.filter((el) => el.ref === ref));
    }
    throw new Error(`Unsupported selector in fake: ${selector}`);
  }
  getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean }): PlaywrightLocator {
    return new FakeLocator(this, () =>
      this.elements.filter((el) => {
        if (el.role !== role) return false;
        if (options?.name === undefined) return true;
        const name = String(options.name);
        return options.exact ? el.name === name : el.name.includes(name);
      }),
    );
  }
  getByLabel(text: string | RegExp): PlaywrightLocator {
    const needle = String(text);
    return new FakeLocator(this, () => this.elements.filter((el) => el.name.includes(needle)));
  }
  getByTestId(testId: string | RegExp): PlaywrightLocator {
    const needle = String(testId);
    return new FakeLocator(this, () => this.elements.filter((el) => el.ref === needle));
  }
  getByText(text: string | RegExp): PlaywrightLocator {
    const needle = String(text);
    return new FakeLocator(this, () => this.elements.filter((el) => el.name.includes(needle)));
  }
  async waitForTimeout(timeout: number): Promise<void> {
    await new Promise((r) => setTimeout(r, Math.min(timeout, 5)));
  }
  async waitForURL(url: string | RegExp): Promise<void> {
    const match = typeof url === "string" ? this.currentUrl === url : url.test(this.currentUrl);
    if (!match) throw new Error(`waitForURL mismatch: ${this.currentUrl}`);
  }
  async close(): Promise<void> {
    if (this.closedFlag) return;
    this.closedFlag = true;
    this.emitter.emit("close");
  }
  isClosed(): boolean {
    return this.closedFlag;
  }
  on(event: string, handler: Handler): void {
    this.emitter.on(event, handler);
  }
  off(event: string, handler: Handler): void {
    this.emitter.off(event, handler);
  }
  record(action: string): void {
    this.actions.push(action);
  }
  bumpGeneration(): void {
    this.generation += 1;
    void this.generation;
  }
  async emitDialog(dialog: FakeDialog): Promise<void> {
    this.emitter.emit("dialog", dialog as never);
  }
}

export class FakeDialog implements PlaywrightDialog {
  accepted = false;
  dismissed = false;
  prompt?: string;
  constructor(
    private readonly kind: string,
    private readonly text: string,
  ) {}
  type(): string {
    return this.kind;
  }
  message(): string {
    return this.text;
  }
  async accept(promptText?: string): Promise<void> {
    this.accepted = true;
    this.prompt = promptText;
  }
  async dismiss(): Promise<void> {
    this.dismissed = true;
  }
}

export class FakeDownload implements PlaywrightDownload {
  cancelled = false;
  constructor(
    private readonly href: string,
    private readonly filename: string,
    private readonly body: Buffer,
  ) {}
  url(): string {
    return this.href;
  }
  suggestedFilename(): string {
    return this.filename;
  }
  async createReadStream(): Promise<NodeJS.ReadableStream> {
    return Readable.from([this.body]);
  }
  async cancel(): Promise<void> {
    this.cancelled = true;
  }
}

type RouteHandler = (route: PlaywrightRoute) => unknown;

export class FakeContext {
  private readonly emitter = new Emitter();
  private readonly pageList: FakePage[] = [];
  private readonly routes: Array<{ pattern: string; handler: RouteHandler }> = [];
  closed = false;
  defaultTimeout = 0;
  defaultNavigationTimeout = 0;
  readonly createdWith: Record<string, unknown>;
  readonly abortedUrls: string[] = [];
  readonly continuedUrls: string[] = [];

  constructor(createdWith: Record<string, unknown> = {}) {
    this.createdWith = createdWith;
  }

  async newPage(): Promise<PlaywrightPage> {
    const page = new FakePage();
    this.pageList.push(page);
    return page as unknown as PlaywrightPage;
  }
  pages(): PlaywrightPage[] {
    return this.pageList as unknown as PlaywrightPage[];
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.pageList.map((p) => p.close()));
  }
  on(event: string, handler: Handler): void {
    this.emitter.on(event, handler);
  }
  off(event: string, handler: Handler): void {
    this.emitter.off(event, handler);
  }
  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }
  setDefaultNavigationTimeout(timeout: number): void {
    this.defaultNavigationTimeout = timeout;
  }
  async route(url: string, handler: RouteHandler): Promise<void> {
    this.routes.push({ pattern: url, handler });
  }
  async unroute(url: string, handler?: RouteHandler): Promise<void> {
    for (let i = this.routes.length - 1; i >= 0; i -= 1) {
      const entry = this.routes[i]!;
      if (entry.pattern === url && (!handler || entry.handler === handler)) {
        this.routes.splice(i, 1);
      }
    }
  }
  async openPopup(): Promise<FakePage> {
    const page = new FakePage();
    this.pageList.push(page);
    this.emitter.emit("page", page as never);
    return page;
  }
  async emitDownload(download: FakeDownload): Promise<void> {
    this.emitter.emit("download", download as never);
  }
  /** Simulate a network request through installed routes. */
  async simulateRequest(url: string, resourceType = "document"): Promise<"continued" | "aborted"> {
    const request: PlaywrightRequest = {
      url: () => url,
      resourceType: () => resourceType,
      redirectedFrom: () => null,
    };
    let settled: "continued" | "aborted" | undefined;
    const route: PlaywrightRoute = {
      request: () => request,
      continue: async () => {
        settled = "continued";
        this.continuedUrls.push(url);
      },
      abort: async () => {
        settled = "aborted";
        this.abortedUrls.push(url);
      },
    };
    for (const entry of this.routes) {
      await entry.handler(route);
      if (settled) return settled;
    }
    return settled ?? "continued";
  }
}

export class FakeBrowser implements PlaywrightBrowser {
  readonly contexts: FakeContext[] = [];
  connected = true;
  async newContext(options?: Record<string, unknown>): Promise<PlaywrightBrowserContext> {
    const ctx = new FakeContext({ ...(options ?? {}) });
    this.contexts.push(ctx);
    return ctx as unknown as PlaywrightBrowserContext;
  }
  isConnected(): boolean {
    return this.connected;
  }
  version(): string {
    return "1.61.0-fake";
  }
}

function unique(elements: FakeElement[], op: string): FakeElement {
  if (elements.length === 0) throw new Error(`No element for ${op}`);
  if (elements.length > 1) throw new Error(`Ambiguous ${op}: ${elements.length}`);
  return elements[0]!;
}
