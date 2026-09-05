import type { BrowserActionName } from "../types.js";
import { blockUrls, emulate, throttle, unblockUrls } from "./cdp.js";
import { dialog } from "./dialog.js";
import { downloadRelease } from "./download_release.js";
import { check, click, fill, select, type as typeAction, uncheck } from "./locator.js";
import { navigate } from "./navigate.js";
import { screenshot } from "./screenshot.js";
import { scroll } from "./scroll.js";
import { selectPage } from "./select_page.js";
import type { ActionHandler } from "./types.js";
import { upload } from "./upload.js";
import { wait } from "./wait.js";

export const ACTION_HANDLERS: Record<BrowserActionName, ActionHandler> = {
  select_page: selectPage,
  dialog,
  download_release: downloadRelease,
  screenshot,
  upload,
  wait,
  navigate,
  scroll,
  block_urls: blockUrls,
  unblock_urls: unblockUrls,
  throttle,
  emulate,
  click,
  type: typeAction,
  fill,
  select,
  check,
  uncheck,
};

export function isActionName(value: string): value is BrowserActionName {
  return Object.hasOwn(ACTION_HANDLERS, value);
}
