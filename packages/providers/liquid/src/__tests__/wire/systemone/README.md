# Liquid System One Wire Recordings

These fixtures record the hosted `/decisions/v1/systemone` wire shape:

- `decision.json`: happy-path decision call on `d1.1` returning a choice answer with input-token usage.
- `error.json`: 422 `invalid_request` when a choice question carries fewer than two criteria.

They are **reconstructed from Liquid's published docs on 2026-10-23, not captured from a live call**
(no `LIQUID_API_KEY` was available when the package landed; plan 196 Task 1). The request bodies match
the shared kit compiler, so replay stays a genuine wire check. Replace them with captured exchanges
(scrubbed of `authorization`) once the gated live row has run.

Replayed offline by `systemOneConformance` in `@arnilo/prism/provider-kit`.
