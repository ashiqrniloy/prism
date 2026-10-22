import { expect, test } from "bun:test";
import { remoteConformance } from "../testing.js";

const module = new URL("./fixture-agent.ts", import.meta.url).href;
for (const transport of ["stdio", "websocket", "http"] as const) {
  test(`remote_conformance_passes_on_${transport}`, async () => {
    const result = await remoteConformance({ module, prompts: { run: "hello", approve: "approve" } }, { transports: [transport] });
    expect(result.failures).toEqual([]);
    expect(result.legs).toHaveLength(8);
  }, 10000);
}

for (const [fixture, leg] of [
  ["fixture-broken-origin.ts", "stream"],
  ["fixture-lost-suspension.ts", "suspension on disconnect"],
]) {
  test(`remote_conformance_detects_${fixture}`, async () => {
    const result = await remoteConformance(
      { module: new URL(`./${fixture}`, import.meta.url).href, prompts: { run: "hello", approve: "approve" } },
      { transports: ["websocket"], timeoutMs: 300 },
    );
    expect(result.failures.some((failure) => failure.leg === leg)).toBe(true);
  });
}

test("remote_conformance_defaults_to_every_transport_under_ten_seconds", async () => {
  const started = performance.now();
  const result = await remoteConformance({ module, prompts: { run: "hello", approve: "approve" } });
  expect(result.failures).toEqual([]);
  expect(result.legs).toHaveLength(24);
  expect(performance.now() - started).toBeLessThan(10000);
}, 10000);
