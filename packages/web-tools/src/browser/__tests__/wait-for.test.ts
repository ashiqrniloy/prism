import assert from "node:assert/strict";
import { it } from "node:test";
import { waitFor } from "./wait-for.js";

it("bounded poll returns the first satisfying value without waiting out the deadline", async () => {
  let reads = 0;
  const value = await waitFor(
    () => {
      reads += 1;
      return reads;
    },
    (n) => n >= 3,
    "third read",
    { intervalMs: 1 },
  );
  assert.equal(value, 3);
  assert.equal(reads, 3);
});

it("bounded poll fails with the label and the last observed value when the deadline passes", async () => {
  await assert.rejects(
    () =>
      waitFor(
        () => [] as readonly string[],
        (list) => list.length >= 1,
        "download quarantine",
        { timeoutMs: 0 },
      ),
    /timed out after 0ms waiting for download quarantine \(last observed \[\]\)/,
  );
});
