# Changelog
## [0.0.10] - 2026-07-21

### Changed

- Released with exact 0.0.10 graph.

## [0.0.96] - 2026-07-21

### Changed

- Released with exact 0.0.96 graph.

## [0.0.9] - 2026-07-21

- Released with the exact 0.0.9 first-party package graph.

## [0.0.8] - 2026-07-20

- Added host-owned durable A2A task start/get/list/cancel/subscribe with bounded cursor replay, interrupted states, ordered rich task events, and non-disclosing task errors.
- Added opt-in bounded text/raw/URL/data parts; URL policy validates without dereferencing.
- Added capability-gated push config CRUD/client APIs and explicit bounded `deliverA2APushEvent()` retry/timeout/idempotency-key wrapper; webhook transport/credentials remain host-owned and secrets are omitted from responses.

## [0.0.7] - 2026-07-19

- Released with the exact 0.0.7 first-party package graph.

## [0.0.6] - 2026-07-19

- Fixed A2A streaming UTF-8 corruption across chunk boundaries with one fatal streaming decoder and incremental LF/CRLF/multiline SSE parsing; truncated or post-terminal streams fail without changing existing limits.

## [0.0.5] - 2026-07-16

- Added optional bounded child delegation and A2A 1.0 card/server/client interoperability.

## [0.0.4] - 2026-07-14

- Bounded explicit local child delegation with narrowing-only policy composition, derived memory scope IDs, hooks, nested delegation, cancellation, and event subscription.
- A2A protocol 1.0 cards, ES256 JWS signing/verification, authorized web-standard JSON-RPC/SSE handler, and explicit allow-listed remote client.
