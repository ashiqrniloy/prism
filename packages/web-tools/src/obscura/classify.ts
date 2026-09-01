/**
 * Obscura tool classification. Reads are proven side-effect-free against the live
 * session; every other tool (including unknown future upstream tools) falls back to
 * the bridge's conservative external-mutation default. `browser_search` is in-page
 * text search — it reads the current page and mutates nothing.
 */
const READ_TOOLS: ReadonlySet<string> = new Set([
  // Read the page
  "browser_snapshot",
  "browser_markdown",
  "browser_links",
  "browser_extract",
  "browser_interactive_elements",
  "browser_detect_forms",
  "browser_get_attribute",
  "browser_count",
  "browser_search",
  // Diagnostics
  "browser_console_messages",
  "browser_network_requests",
  // Tabs/cookies/storage reads
  "browser_tab_list",
  "browser_get_cookies",
  "browser_storage_state",
  // Waiters (observe only)
  "browser_wait_for",
  "browser_wait_for_text",
  // Render captures (render-enabled builds)
  "browser_screenshot",
  "browser_pdf",
]);

export function isObscuraReadTool(name: string): boolean {
  return READ_TOOLS.has(name);
}
