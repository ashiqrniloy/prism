/**
 * Bounded screenshot capture returning Prism ImageContent.
 */
import type { ImageContent } from "@arnilo/prism";
import { BrowserError } from "./errors.js";
import type { ResolvedBrowserLimits } from "./limits.js";
import type { PlaywrightPage } from "./types.js";

export interface ScreenshotBudget {
  count: number;
}

export function createScreenshotBudget(): ScreenshotBudget {
  return { count: 0 };
}

export interface CaptureScreenshotOptions {
  readonly page: PlaywrightPage;
  readonly limits: ResolvedBrowserLimits;
  readonly budget: ScreenshotBudget;
  readonly fullPage?: boolean;
  readonly clip?: { x: number; y: number; width: number; height: number };
  readonly signal?: AbortSignal;
}

export interface ScreenshotResult {
  readonly image: ImageContent;
  readonly bytes: number;
  readonly width?: number;
  readonly height?: number;
  readonly megapixels?: number;
}

function assertFinitePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", `${name} must be a positive finite number`);
  }
}

export async function captureBoundedScreenshot(
  options: CaptureScreenshotOptions,
): Promise<ScreenshotResult> {
  const { page, limits, budget } = options;
  if (budget.count >= limits.maxScreenshots) {
    throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `maxScreenshots ${limits.maxScreenshots} exceeded`);
  }
  if (typeof page.screenshot !== "function") {
    throw new BrowserError("ERR_PRISM_BROWSER", "Page.screenshot is unavailable");
  }
  if (options.signal?.aborted) {
    throw new BrowserError("ERR_PRISM_BROWSER", "screenshot aborted");
  }

  if (options.clip) {
    assertFinitePositive("clip.width", options.clip.width);
    assertFinitePositive("clip.height", options.clip.height);
    const megapixels = (options.clip.width * options.clip.height) / 1_000_000;
    if (megapixels > limits.maxScreenshotMegapixels) {
      throw new BrowserError(
        "ERR_PRISM_BROWSER_LIMIT",
        `screenshot clip exceeds maxScreenshotMegapixels ${limits.maxScreenshotMegapixels}`,
      );
    }
  }

  let buffer: Buffer;
  try {
    const raw = await page.screenshot({
      type: "png",
      fullPage: options.fullPage === true,
      ...(options.clip ? { clip: options.clip } : {}),
      timeout: limits.actionTimeoutMs,
    });
    buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  } catch (error) {
    if (error instanceof BrowserError) throw error;
    throw new BrowserError(
      "ERR_PRISM_BROWSER_ARTIFACT",
      `screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (buffer.byteLength > limits.maxScreenshotBytes) {
    throw new BrowserError(
      "ERR_PRISM_BROWSER_LIMIT",
      `screenshot exceeds maxScreenshotBytes ${limits.maxScreenshotBytes}`,
    );
  }
  // PNG IHDR width/height at bytes 16..24
  let width: number | undefined;
  let height: number | undefined;
  let megapixels: number | undefined;
  if (
    buffer.byteLength >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
    megapixels = (width * height) / 1_000_000;
    if (megapixels > limits.maxScreenshotMegapixels) {
      throw new BrowserError(
        "ERR_PRISM_BROWSER_LIMIT",
        `screenshot exceeds maxScreenshotMegapixels ${limits.maxScreenshotMegapixels}`,
      );
    }
  }

  budget.count += 1;
  const image: ImageContent = {
    type: "image",
    mimeType: "image/png",
    data: buffer.toString("base64"),
    metadata: {
      bytes: buffer.byteLength,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      source: "browser_screenshot",
    },
  };
  return { image, bytes: buffer.byteLength, width, height, megapixels };
}
