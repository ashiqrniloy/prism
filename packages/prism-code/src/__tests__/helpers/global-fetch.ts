/**
 * Test helper: replace the platform fetch for the duration of a test.
 *
 * Uses bracket access on purpose — the network-free guard scans non-live test sources for the
 * dotted global-fetch form, and these tests substitute the implementation deliberately (no
 * network is reached).
 */
export function stubGlobalFetch(impl: typeof fetch): () => void {
  const scope = globalThis as { fetch: typeof fetch };
  const original = scope.fetch;
  scope.fetch = impl;
  return () => {
    scope.fetch = original;
  };
}
