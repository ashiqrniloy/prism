# Host port

## What it does

`HostPort` is the only way a package reaches a person: approvals, `ask_user`, MCP trust, OAuth
URLs, secret entry, and pickers. `HostUi.request` sends one request and gets one answer.

The kernel stamps every request with `{ package, sessionId? }` before it reaches the host. A
package-supplied `package` or `sessionId` is overwritten, so one package cannot speak as another.

## When to use it

A package calls `host.ui.request` when it cannot proceed without a person's answer. Anything else —
config, logs, status notes — goes through its own surface. A host implements `HostUi` to be asked;
a package consumes it. A host with no `ui` answers every request `unavailable`, so a package must
fail closed on `unavailable` rather than assume an answer.

## Inputs / request

| `kind` | Fields | Answer value |
| --- | --- | --- |
| `confirm` | `title`, `detail?` | `boolean` |
| `select` | `title`, `options`, `multiple?`, `detail?` | `string`, or `readonly string[]` when `multiple` |
| `input` | `title`, `detail?`, `placeholder?`, `value?` | `string` |
| `secret` | `title`, `ref`, `detail?` | the value the host captured — see below |
| `open-url` | `title`, `url` | `undefined` |
| `notify` | `level` (`"info" \| "warn" \| "error"`), `message` | `undefined` |
| `terminal` | `title`, `command`, `env?`, `cwd?` | `{ exitCode: number }` — see below |

Every request also carries `package` and `sessionId?`, both set by the kernel.

### Terminal

A `terminal` request asks the host to run an interactive command (a vendor login) where the person can see it:

```ts
const answer = await prism.host.ui.request({ kind: "terminal", title: "Sign in", command: ["vendor-cli", "login"], env: { VENDOR_HOME: profileDir } });
if (answer.status !== "answered" || answer.value.exitCode !== 0) throw new Error("auth_required");
```

The terminal's input and output never reach the kernel or the package: the answer carries only `exitCode`, and
the kernel drops every other field a host returns (a non-integer `exitCode` becomes `unavailable`). `command`
is untrusted package text a host shows and never shell-interprets. `env` holds non-secret values such as
paths; a value starting `env:` or `keyring:` is refused with `terminal_env_secret` before the host is asked.
A package without `host-ui` is refused like any other kind. ACP, the MCP server, and the Prism Agent TUI answer
`unavailable` today.

### Responses

| Status | Meaning |
| --- | --- |
| `answered` | The host captured the kind's value. |
| `dismissed` | The host showed it and the person declined. Treat it as a deny. |
| `unavailable` | No UI is attached, the surface is not implemented, or the run is non-interactive. **Fail closed.** |

### Secrets

A `secret` request names where the value goes, not the value itself:

```ts
const res = await prism.host.ui.request({ kind: "secret", title: "Brave API key", ref: "keyring:brave" });
if (res.status !== "answered") {
  prism.status.note("warn", "web search needs a key");
  return; // fail closed
}
// Stored at "keyring:brave" through the credentials slot. res carries no value.
```

The kernel owns the value. It stores the answer at `ref` through the credentials slot, adds it to
the agent's secret set so every event, note, log, and error of that run masks it, and returns
`{ status: "answered", value: undefined }` to the package. A package cannot read back a secret it
asked for.

Three things fail closed before a host is asked:

- a `ref` that is not an `env:`/`keyring:` ref throws `PackageLoadError` with code
  `invalid_secret_ref`
- a credentials slot with no `store` answers `unavailable` — the default `env:`-only resolver is one
- no attached UI answers `unavailable`

### Interactivity

`RunOptions.interactive` (default `true`) decides whether a run may ask at all. On `false`, an
`ask` suspends the run without a `confirm` request, so an ACP or AG-UI host can hold a queued
decision it cannot show yet and answer it later with `resume(decisions)`.

### Untrusted text

`title`, `detail`, `options`, and `notify.message` are authored by the package, which may be
third-party. A host renders them as text: never as markup, never as a command, never as a path.
`ref` is not free text — it is validated against the ref grammar before any host sees it.

## Outputs / response / events

`request` returns one `HostUiResponse`. It does not throw for an absent surface: `unavailable` and
`dismissed` are answers, not errors. A `secret` request can throw `PackageLoadError`
(`invalid_secret_ref`); everything else fails closed through the status.

A `HostPort` without `ui` answers `unavailable` for every kind. `HostPort.log` is optional too; a
package's log calls reach the host's logger redacted, or nowhere when there is none.

## Request/response example

```json
[
  {
    "kind": "confirm",
    "package": "@acme/web",
    "sessionId": "s-1",
    "title": "Approve tool \"web_search\""
  }
]
```

## Implementation example

```ts
// Host side.
const ui: HostUi = {
  async request(request) {
    switch (request.kind) {
      case "confirm":
        return (await prompt(request.title)) ? { status: "answered", value: true } : { status: "dismissed" };
      case "secret":
        // The value goes back to the kernel once; it is stored at `request.ref` and never
        // reaches the asking package.
        return { status: "answered", value: await readSecret(request.title) };
      default:
        return render(request);
    }
  },
};
const agent = await createAgent({ host: { ui } });
```

The same `HostUi` answers an `ask` from a `tool.call` hook inline. With no UI (or `unavailable`) the run
suspends instead, and `session.resume(decisions)` finishes it; `examples/approval.ts` runs both paths with
`createScriptedHostUi` and then resumes from a new agent over the same store:

```ts
const scripted = createScriptedHostUi({ confirm: true });
const agent = await createAgent({
  model,
  provider,
  host: { ui: scripted.ui },
  hooks: (hooks) => hooks.on("tool.call", (call) => (call.name === "delete_file" ? { ask: "Delete a file?" } : undefined)),
});
await (await agent.session()).run("Clean up tmp/scratch.txt"); // one confirm request, then the tool runs
```

## Extension and configuration notes

- The `host-ui` capability gates `host.ui.request`. A package without it gets
  `PackageLoadError` code `capability_missing`.
- `createScriptedHostUi(script)` from `@arnilo/prism/testing` builds a `HostUi` that answers per
  kind, records every request, and defaults to `unavailable` — the fail-closed answer. See
  [testing](testing.md).
- `packageConformance` runs `unavailable_fails_closed`: setup, one mock session, and every
  registered command run against a host that answers `unavailable` to everything, and an untyped
  throw fails the check.
- [Driver kit](drivers.md): the `terminal` request a profile's sign-in sends to the host, and the `unavailable` fallback
  that names the login command.

### Provider login

A provider that signs in with OAuth declares it as an `AuthMethod`; the host runs it, because nothing in the kernel
constructs an `AuthContext`. Build one from the host's UI and a writable credentials slot, then call `login`:

```ts
import type { Secret } from "@arnilo/prism";
import { createKeyringCredentialResolver } from "@arnilo/prism-credentials-keyring";

const resolver = createKeyringCredentialResolver({ store }); // the store the host opened
const credentials = {
  store: (ref: string, secret: Secret) => resolver.store!(ref, secret, {}),
  delete: (ref: string) => resolver.delete!(ref, {}),
};
const provider = agent.models.resolve("openai-codex/gpt-6.1-sol").provider;
for (const method of provider.auth ?? []) {
  if (method.kind !== "oauth") continue;
  // open-url sends the person to the provider; input takes a pasted callback URL back.
  await method.login({ host: { ui }, credentials });
}
```

The login reads the current record through the same slot on its own, so the host passes only what a login cannot
invent: `host.ui` and the store/delete handle. What a host shows is the provider's URL, never a token; a host that
answers `open-url` or `input` `unavailable` is refused, and the provider stays signed out rather than storing a
partial grant.

### Remote UI binding

`remoteHostUi()` from `@arnilo/prism-remote` returns a `HostUi`. Pass the same object to the served agent's `host.ui` and to `serveAgent(agent, { hostUi: ui, transport })`. A connected client's local `host.ui` answers requests. Without a client, or when it disconnects, the remote UI answers `unavailable`, driving the existing kernel ask and elicitation suspension paths. Other package requests fail closed under their own contracts; the transport does not add suspension to them. Durable recovery after a server restart requires a persistent store on the served agent. See the [remote host library](../packages/hosts/remote/README.md).
