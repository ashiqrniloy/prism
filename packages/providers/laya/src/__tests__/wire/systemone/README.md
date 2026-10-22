# Laya System One Wire Recordings

These fixtures record HTTP exchanges with a local `laya-serve` `/v1/systemone` endpoint:

- `decision.json`: Happy path decision call on `laya` returning choice answer with input token usage.
- `error.json`: 422 `invalid_request` error response when criteria has fewer than 2 options.

Replayed offline by `systemOneConformance` in `@arnilo/prism/provider-kit`.
