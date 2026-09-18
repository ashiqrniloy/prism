import { ok, strictEqual } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const drawioUrl = process.env.PRISM_LIVE_DRAWIO_URL ?? process.env.PRISM_TEST_DRAWIO_URL;

/**
 * Self-hosted draw.io live browser acceptance test leg.
 *
 * Requirements:
 * - Gated behind PRISM_LIVE_DRAWIO_URL or PRISM_TEST_DRAWIO_URL (e.g. http://localhost:8080).
 * - When unset, test is skipped so default `npm test` stays 100% network-free.
 * - When set, uses Playwright Chromium to verify the embed handshake, load, edit/merge,
 *   save, and export ("xmlsvg") workflows against the Apache-2.0 jgraph/drawio instance.
 * - Verifies that foreign origin/source postMessages are dropped inside a real browser.
 */
test("live: self-hosted draw.io webapp embed lifecycle (init -> load -> merge -> export xmlsvg)", {
  skip: !drawioUrl ? "set PRISM_LIVE_DRAWIO_URL (e.g. http://localhost:8080) to run live draw.io acceptance tests" : false,
}, async (t) => {
  // Dynamic import to allow running without playwright-core in pure Node test runs
  let playwright: typeof import("playwright-core");
  try {
    playwright = await import("playwright-core");
  } catch {
    t.diagnostic("playwright-core not installed; skipping live test");
    return;
  }

  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  const distFixturePath = join(__dirname, "drawio.fixture.html");
  const srcFixturePath = join(__dirname, "../../../src/diagrams/__tests__/drawio.fixture.html");

  let fixtureHtml = "";
  if (existsSync(distFixturePath)) {
    fixtureHtml = readFileSync(distFixturePath, "utf8");
  } else if (existsSync(srcFixturePath)) {
    fixtureHtml = readFileSync(srcFixturePath, "utf8");
  } else {
    throw new Error("Could not find drawio.fixture.html in dist or src directories");
  }

  // Start local server to host the fixture page
  let server: Server;
  let fixtureUrl: string;

  await new Promise<void>((resolve, reject) => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fixtureHtml);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        fixtureUrl = `http://127.0.0.1:${addr.port}?origin=${encodeURIComponent(drawioUrl!)}`;
        resolve();
      } else {
        reject(new Error("Failed to obtain server address"));
      }
    });
  });

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    t.diagnostic(`Navigating to fixture: ${fixtureUrl!}`);
    await page.goto(fixtureUrl!, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // 1. Wait for handshake init event
    t.diagnostic("Waiting for draw.io embed 'init' event...");
    await page.waitForFunction(() => (window as unknown as { __IS_INITIALIZED: boolean }).__IS_INITIALIZED === true, { timeout: 45_000 });

    // 2. Load initial diagram model
    const initialXml = `<mxfile host="drawio.internal"><diagram id="d1" name="Page-1"><mxGraphModel dx="800" dy="600"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Initial" vertex="1" parent="1"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;

    await page.evaluate((xml) => {
      const win = window as unknown as {
        __embed: { load: (opts: { xml: string; autosave: number }) => void };
      };
      win.__embed.load({ xml, autosave: 1 });
    }, initialXml);

    // 3. Drive edit via merge action
    const mergeXml = `<mxfile host="drawio.internal"><diagram id="d1" name="Page-1"><mxGraphModel dx="800" dy="600"><root><mxCell id="3" value="Merged Node" vertex="1" parent="1"><mxGeometry x="150" y="10" width="100" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;

    await page.evaluate((xml) => {
      const win = window as unknown as {
        __embed: { merge: (xml: string) => void };
      };
      win.__embed.merge(xml);
    }, mergeXml);

    // 4. Request export with format 'xmlsvg'
    t.diagnostic("Requesting export format xmlsvg...");
    await page.evaluate(() => {
      const win = window as unknown as {
        __embed: { exportDiagram: (fmt: string) => void };
      };
      win.__embed.exportDiagram("xmlsvg");
    });

    // Wait for export result
    await page.waitForFunction(
      () =>
        (
          window as unknown as {
            __DRAWIO_EXPORTED: { format: string; data: string } | null;
          }
        ).__DRAWIO_EXPORTED !== null,
      { timeout: 30_000 },
    );

    const exportedResult = await page.evaluate(
      () =>
        (
          window as unknown as {
            __DRAWIO_EXPORTED: { format: string; data: string };
          }
        ).__DRAWIO_EXPORTED,
    );

    ok(exportedResult, "Export result must be returned");
    strictEqual(exportedResult.format, "xmlsvg");
    ok(
      exportedResult.data.startsWith("data:image/svg+xml") || exportedResult.data.includes("<svg"),
      "Exported data must be valid SVG data URI or SVG string",
    );

    // 5. Cross-origin security probe: post a foreign message from page window
    await page.evaluate(() => {
      window.postMessage(JSON.stringify({ event: "save", xml: "<hacked/>" }), "*");
    });

    // Short delay for message processing
    await page.waitForTimeout(500);

    const savedState = await page.evaluate(() => (window as unknown as { __DRAWIO_SAVED: unknown }).__DRAWIO_SAVED);
    strictEqual(savedState, null, "Foreign message must not alter saved state");

    const droppedEvents = await page.evaluate(() =>
      (window as unknown as { __DRAWIO_EVENTS: Array<{ type: string }> }).__DRAWIO_EVENTS.filter((e) => e.type.startsWith("dropped_")),
    );
    ok(droppedEvents.length > 0, "Security handler must have recorded dropped foreign message");

    t.diagnostic("Live draw.io acceptance run completed successfully");
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
