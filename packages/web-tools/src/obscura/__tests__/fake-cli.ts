import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FAKE_SCRIPT = `#!/usr/bin/env node
// Fake Obscura CLI for the default network-free suite.
// Behaviors via OBSCURA_FAKE: ok (default) | hang | exit | garbage | oversize.
const mode = process.env.OBSCURA_FAKE ?? "ok";
const delay = Number(process.env.OBSCURA_FAKE_DELAY ?? 0);
const args = process.argv.slice(2);

if (mode === "hang") {
  setInterval(() => {}, 1000);
} else if (mode === "exit") {
  console.error("simulated failure");
  process.exit(3);
} else if (delay > 0) {
  setTimeout(run, delay);
} else {
  run();
}

function run() {
  if (mode === "garbage") {
    process.stdout.write("this is not json");
    process.exit(0);
  }
  if (mode === "oversize") {
    process.stdout.write("x".repeat(200 * 1024));
    process.exit(0);
  }
  const command = args[0];
  if (command === "fetch") {
    const url = args[1];
    const dumpIndex = args.indexOf("--dump");
    const dump = dumpIndex === -1 ? "text" : args[dumpIndex + 1];
    if (args.includes("--eval")) {
      const searchUrl = new URL(url);
      const query = searchUrl.searchParams.get("q") ?? "";
      process.stdout.write(
        JSON.stringify([
          { url: \`https://example.com/a?q=\${encodeURIComponent(query)}\`, title: "A", snippet: "first" },
          { url: "https://example.com/b", title: "B", snippet: "second" },
          { url: "https://example.com/b", title: "dup", snippet: "duplicate url" },
          { title: "no url field", snippet: "skipped" },
          { url: "javascript:alert(1)", title: "unsafe", snippet: "skipped" },
          { url: "https://example.com/c", title: "C", snippet: "third" },
        ]),
      );
      process.exit(0);
    }
    if (dump === "markdown") {
      process.stdout.write(\`# Example\\n\\nFetched \${url}\`);
      process.exit(0);
    }
    if (dump === "html" || dump === "text" || dump === "links" || dump === "original") {
      process.stdout.write(\`<p>dump=\${dump} url=\${url}</p>\`);
      process.exit(0);
    }
    process.exit(2);
  }
  if (command === "scrape") {
    const urls = args.filter((a) => a.startsWith("http"));
    const concurrency = args[args.indexOf("--concurrency") + 1];
    process.stdout.write(JSON.stringify(urls.map((url, i) => ({ url, index: i, title: \`T\${i}\`, concurrency }))));
    process.exit(0);
  }
  process.exit(2);
}
`;

/** Materialize the fake Obscura CLI once per process; returns its absolute path. */
export function fakeObscuraCliPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "obscura-fake-"));
  const path = join(dir, "obscura-fake-cli.mjs");
  writeFileSync(path, FAKE_SCRIPT);
  return path;
}
