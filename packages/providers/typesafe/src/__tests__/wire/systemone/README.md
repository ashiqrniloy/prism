# TypeSafe Jev System One Wire Recordings

These fixtures record HTTP exchanges with TypeSafe Jev's `/v1/systemone` endpoint:

- `decision.json`: Happy path decision call on `jev-latest` returning choice and noul answers with input token usage.
- `error.json`: 422 `invalid_request` error response when criteria has fewer than 2 options.

Replayed offline by `systemOneConformance` in `@arnilo/prism/provider-kit`.
