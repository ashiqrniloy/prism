# Prism 0.5.4: `maxRequestBytes` / `maxResponseBytes` charged cumulatively

Clay host report for `@arnilo/prism@0.5.4`. Forward as-is.

## Symptom

A coding run dies in ~2 minutes with:

```
Run limit exceeded: maxRequestBytes
```

Clay already sets both byte axes to `HARD_RUN_LIMITS` (64 MiB). Hosts cannot raise further (`null` rejected). Hours-long autonomous jobs are impossible.

## Expected (0.5.4 changelog)

HARD exists so a bug cannot OOM the host through a **giant provider frame**. Check each request/event against 64 MiB.

A 2 MiB prompt sent 40 times is 2 MiB frames, not a 80 MiB parse.

## Actual

`RunLimitTracker.charge` **adds** every frame to a run-lifetime counter, then compares the **sum** to HARD.

```147:147:src/agent-session/session/provider-round.ts
  session.activeLimits!.charge("maxRequestBytes", jsonBytes(request));
```

```189:189:src/agent-session/session/provider-round.ts
      session.activeLimits!.charge("maxResponseBytes", jsonBytes(event));
```

```212:223:src/run-limits.ts
  charge(limit, delta = 1): void {
    const observed = this.counters[counter] + delta;
    this.counters[counter] = observed;
    const cap = this.limits[limit];
    if (cap !== null && observed > cap) this.exceed(limit, observed);
  }
```

Coding context of ~2–4 MiB × ~20 provider turns ≈ 64 MiB. Cap fires while every single frame is far under HARD.

## Fix (one place)

For `maxRequestBytes` / `maxResponseBytes` only: exceed when **`delta > cap`**, not when the running sum exceeds cap. Keep the counter for snapshots/telemetry.

```ts
charge(limit, delta = 1): void {
  // ...
  const observed = this.counters[counter] + delta;
  this.counters[counter] = observed;
  const cap = this.limits[limit];
  if (cap === null) return;
  const against = limit === "maxRequestBytes" || limit === "maxResponseBytes" ? delta : observed;
  if (against > cap) this.exceed(limit, against);
}
```

Tokens, turns, tools, wall, cost stay cumulative.

## Test

```ts
const tracker = new RunLimitTracker(resolveRunLimits(undefined, {
  maxRequestBytes: 8 * 1024 * 1024,
}));
for (let i = 0; i < 20; i++) tracker.charge("maxRequestBytes", 2 * 1024 * 1024);
assert.equal(tracker.breach, undefined);
assert.throws(() => tracker.charge("maxRequestBytes", 9 * 1024 * 1024), RunLimitError);
```

Today the loop throws on the 5th 2 MiB charge.

## Clay

No host workaround. Clay already passes `HARD_RUN_LIMITS.maxRequestBytes` / `maxResponseBytes` at `createAgent`. Need a Prism patch + pin bump.
