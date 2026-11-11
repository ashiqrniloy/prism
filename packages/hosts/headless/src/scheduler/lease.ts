import type { LeaseAcquireInput, LeaseStore } from "@arnilo/prism-extensions/workflows";
import { systemClock } from "./clock.js";

export async function holdFiringLease(store: LeaseStore, input: LeaseAcquireInput) {
  const lease = await store.tryAcquireLease(input);
  if (!lease) return;
  const claim = { ...input, token: lease.token };
  const controller = new AbortController();
  let lost = false;
  const renewal = (async () => {
    while (!controller.signal.aborted) {
      await systemClock.sleep(input.ttlMs / 3, controller.signal);
      if (controller.signal.aborted) break;
      try {
        const renewed = await store.renewLease(claim);
        if (!renewed || renewed.fencingToken !== lease.fencingToken) lost = true;
      } catch {
        lost = true;
      }
      if (lost) break;
    }
  })();
  const stop = async () => {
    controller.abort();
    await renewal;
  };
  return {
    fencingToken: lease.fencingToken,
    get lost() {
      return lost;
    },
    stop,
    async release() {
      await stop();
      await store.releaseLease(claim);
    },
  };
}
