# Compatibility

## What it does

This page is the stability promise of `@arnilo/prism` and its stable native packages and host libraries. It
says which surfaces stay stable across releases, which changes a minor release may make, and the rules
hosts, packages, and stores follow so that code written today keeps working against later minors.

**Versioning.** Every package on the 0.x line is versioned independently after 0.13.0 and declares the
kernel API level it was written against (`requires: { api: 1 }`, peer range `>=0.13.0 <1.0.0`). The kernel
exports that level as `KERNEL_API_LEVEL`. Within one API level, every minor release is **additive**: a package
or host that works on 0.13 works on 0.14. A change that breaks a stable surface needs a **new API level**
and a migration note. During a transition the kernel loads more than one level, and a package whose level the
kernel does not support fails to load with `kernel_api`.

**What is stable.** These surfaces are covered by the promise:

| Surface | Where it is defined |
| --- | --- |
| Every root export of `@arnilo/prism` | `src/index.ts`; frozen by the compat gate |
| Every subpath in the kernel's `exports`: `./provider-kit`, `./net`, `./artifacts`, `./driver-kit`, `./manifest`, `./manifest/schema.json`, `./testing` and its `./testing/*` conformance entries, `./node/contribution-discovery` | `package.json` `exports` |
| The hook catalog: hook names, kinds (observe, transform, decide, around), payloads, and result shapes | [hooks.md](hooks.md) |
| Slot contracts: loop, compaction, store, credentials | [slots.md](slots.md) |
| `PackageAPI` and `definePackage` | [packages.md](packages.md) |
| `HostPort`, `HostUi`, and its request and response shapes | [host.md](host.md) |
| `AgentEvent` payloads | [events.md](events.md) |
| The manifest format and its JSON schema | [manifest.md](manifest.md) |
| The session entry schema: `SessionEntry`, `SESSION_ENTRY_KINDS`, `SESSION_ENTRY_SCHEMA_VERSION`, and the meaning of each known kind | [agent.md](agent.md) "Sessions", [slots.md](slots.md) (store slot) |
| Error classes and their `code` values, including host-facing errors such as `SubscriberOverflowError`, `PackageLoadError`, and `SessionAppendConflictError` | the page that documents the API that throws |
| Every export of a stable native package or host library | that package's `README.md` |

Not covered: packages on the experimental line (`x.y.z-experimental.N`, npm dist-tag `experimental`; see
[release.md](release.md) "Experimental packages"), the private reference host `apps/prism-agent`, anything
reachable only through a deep import that `exports` does not list, and the text of error messages.

## When to use it

- Before writing a host: follow the host rules below, so a later minor's new events, request kinds, and
  reasons do not break your UI.
- Before writing a package: follow the package rules, and declare `requires.api`.
- Before writing a store adapter: follow the store rules, and run `storeConformance` from
  `@arnilo/prism/testing`.
- Before changing the kernel or a stable package: check whether the change is additive (ships in a minor)
  or breaking (needs a new API level).

## Inputs / request

**What a minor release may change.** The compat gate ([release.md](release.md) "The compat gate") freezes the
normalized declaration of every exported name, keyed by entry point, and classifies each difference. A minor
release may only make changes the gate classifies as additive:

| Additive (minor release) | Breaking (new API level) |
| --- | --- |
| A new export, a new subpath, a new package | Removing or renaming an export, or moving it between entry points |
| A new optional member on an interface or class | A new required member, or removing or retyping a member |
| A new function overload | Changing or removing a signature |
| A new member of a union only the kernel produces | Widening a union a host or package constructs, or narrowing any type |
| A new hook, event type, `HostUi` request kind, finish reason, or session entry kind | Changing the payload of an existing hook, event, request, or entry kind |
| A new error `code` | Changing what an existing `code` means |

The unions the kernel only produces are listed in `PRODUCER_ONLY_TYPES` in `scripts/compat-shape.mjs`:
`AgentEventPayload`, `AgentEvent`, `AgentEventType`, `AgentFinishReason`, `HostUiRequest`, and
`SessionEntryKind`. Code that consumes them must handle a value it does not know, as the rules below say.

**Host rules.**

- **Events.** Ignore an `AgentEvent` whose `type` you do not know, and ignore unknown fields on events you do
  know. Never `switch` exhaustively on `event.type` without a `default` branch. To keep only the types this
  kernel version emits, filter with `isKnownAgentEventType(type)`.
- **Host UI.** Answer a `HostUi` request whose `kind` you do not implement with `{ status: "unavailable" }`.
  The kernel then takes its fail-closed path (a tool approval suspends the run; a package fails closed).
- **Reasons.** Treat `stopReason`, `finishReason`, and error `code` values you do not recognise as opaque
  strings: show or log them, and never branch on them as if the set were closed.
- **Entries.** `session.entries()` and a store's `list()` may return entries of a kind you do not know.
  Skip them; never fail the session because of one.

**Package rules.**

- Declare `requires: { api: 1 }`. Add `requires.prism` only when the package needs a fix from a specific release.
- Never `switch` exhaustively on a producer-only union (`AgentEvent["type"]`, `AgentFinishReason`,
  `HostUiRequest["kind"]`, `SessionEntryKind`) without a `default` branch.
- Treat a `HostUi` answer of `unavailable` as a deny and fail closed.

**Store rules.**

- Persist an entry of an unknown kind and return it unchanged from `list()`, `get()`, and
  `readBranchPath()`, with its envelope (`id`, `sessionId`, `parentId`, `timestamp`) and every other field intact.
- Never reject a session, or a read, because one of its entries has an unknown kind.
- Return an entry whose `schemaVersion` is greater than `SESSION_ENTRY_SCHEMA_VERSION` unchanged. A store may log
  that it holds newer data; it must not drop or rewrite the entry.
- A line or row without a valid envelope is still an error.

## Outputs / response / events

What the kernel and the first-party stores do with these rules:

- **Host UI answers.** Every `HostUi` answer passes through one validation before a package or the kernel's
  own approval path sees it. A `status` other than `answered`, `dismissed`, or `unavailable` becomes
  `unavailable`, and so does an `answered` value of the wrong shape for its kind: a non-boolean `confirm`, a
  non-string `input`, a `select` whose value does not match its `multiple` flag, or a `terminal` answer with
  no integer `exitCode`. A truthy string answer to a tool approval never allows the call.
- **Unknown entries never reach a model.** The session rebuilds its messages from `message` entries only, so
  an unknown-kind entry, even one that carries a `message` or `summary` field, never reaches
  `session.messages()` or a provider request.
- **JSONL store.** A line with an unknown `kind` and a valid envelope is kept and returned as is. A line with a
  `schemaVersion` above the current one is returned unchanged, and the store warns once through its logger
  (the package passes its own; `createJsonlSessionStore({ dir, logger })` takes one). A structurally invalid
  line is still reported in `readJsonlSessionEntries(...).errors`.
- **SQLite and Postgres stores.** The `kind` column is free text and `schema_version` is stored as given, so
  both round-trip unknown kinds and newer schema versions.
- **Conformance.** `storeConformance` runs the `unknown-entry-kind` leg: it appends an entry of an unknown kind,
  reads it back through `list`, `get`, and `readBranchPath`, and, with a `reopen` factory, checks that it survives a
  restart unchanged. The kernel memory store, the JSONL store, and the SQLite and Postgres adapters pass it.

## Request/response example

A host answering a request kind it does not implement:

```json
{ "request": { "kind": "pick-file", "title": "Choose a file", "package": "@acme/files" }, "response": { "status": "unavailable" } }
```

A stored entry from a later minor, returned unchanged by every store:

```json
{ "id": "e9", "parentId": "e8", "sessionId": "s1", "timestamp": "2027-01-01T00:00:00.000Z", "kind": "checkpoint_v2", "data": { "seq": 4 } }
```

## Implementation example

```ts
import { isKnownAgentEventType, type HostUi } from "@arnilo/prism";

for await (const event of session.stream(input)) {
  if (!isKnownAgentEventType(event.type)) continue; // a type from a later minor
  switch (event.type) {
    case "message.delta":
      render(event);
      break;
    default:
      break; // unknown or unhandled types are expected
  }
}

const ui: HostUi = {
  async request(request) {
    switch (request.kind) {
      case "confirm":
        return { status: "answered", value: await askYesNo(request.title) };
      default:
        return { status: "unavailable" }; // a kind this host does not implement
    }
  },
};
```

## Extension and configuration notes

- A store adapter proves the store rules by running `storeConformance(factory, { reopen })` from
  `@arnilo/prism/testing`; see [testing.md](testing.md).
- A capability declaration for `HostUi` request kinds is not part of the contract yet. If one is added, it is an
  optional member and ships in a minor release.
- An experimental package graduates by leaving the experimental list and taking a stable version; from then
  on it is covered by this page.

## Security and performance notes

- Unknown input fails closed where trust is involved: an unexpected host answer is `unavailable`, never an
  approval, and an unknown-kind entry never reaches a provider request.
- Keeping unknown entries does not widen what a model sees: only `message` and `summary` entries, and the latest
  `compaction`, feed the rebuilt context.
- The compat gate runs on every release (`bun scripts/release.mjs gate`). A breaking change fails it unless
  `--allow-break` is passed with a migration note that names the target version.

## Related APIs

- [Host port](host.md): `HostUi` request kinds and the response statuses.
- [Events](events.md): the `AgentEvent` catalog.
- [Packages](packages.md): `requires.api` and `requires.prism`.
- [Agent](agent.md): sessions, `session.entries()`, and the entry kinds.
- [Slots](slots.md): the store slot.
- [Release and provenance](release.md): the compat gate and the experimental line.
- [Testing](testing.md): `storeConformance` and its legs.
