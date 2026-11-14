# Phase 19 Part L — interop: an A2A host library, and Slack and Discord channels

## Objectives

- Restore agent-to-agent interoperability. 0.12 shipped A2A 1.0 over JSON-RPC/HTTPS (`docs/history/a2a-0.12.md`); 0.13.0 has no A2A surface, so a Prism agent can neither be called by, nor call, an agent built on another framework. `@arnilo/prism-hosts/remote` covers Prism-to-Prism only (`prism.remote/1`).
- Reach people where they work. `@arnilo/prism-hosts/channels` connects Telegram and Signal only (`packages/hosts/channels/src/telegram.ts`, `signal.ts`).

## Expected Outcome

- `@arnilo/prism-hosts/a2a` is a new host-library subpath:
  - `serveA2A(agent, options)` serves one `Agent` to A2A peers: an Agent Card, message send (blocking and streaming), task get, cancel and resubscribe, with every call run through `session.run` / `session.stream` so approvals, hooks, and limits apply.
  - `connectA2A(endpoint, options)` returns an `Agent` proxy for a remote A2A agent, usable wherever an `Agent` goes (for example `agentNode({ agent })`), with forwarded events marked `origin.executedBy: "external"`.
- `connectSlack(agent, options)` and `connectDiscord(agent, options)` join `connectTelegram` and `connectSignal` on the same channel runtime: bindings, the durable journal, admission and deduplication, approvals bound to the sender, ref-only credentials, deny by default.

This plan implements roadmap **Phase 19 Part L**. It creates a package subpath (`a2a`) and extends a host library, so **Task 1 is the phase review**. It adds no kernel contract; host libraries use the public `@arnilo/prism` API only. It runs after plan 235. No version bump or publish. `@arnilo/prism-hosts` versions with the kernel, so the new subpath ships with the next kernel release.

Cost knobs: none in the kernel. A channel connection holds one long-lived socket or webhook route per bot. Streaming previews in Slack and Discord edit one message at a bounded rate (default once per second) and are off by default, as for Telegram drafts.

Live tests for all three surfaces are opt-in (`bun run test:live`) and never part of `bun run test`; every task's proof runs on scripted transports.

## Tasks

- [ ] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line` or a spec section:
      - (a) **A2A today.** The current A2A specification version and its required operations, Agent Card fields, task states, streaming transport, and authentication schemes, read through the find-docs skill; and what the 0.12 implementation covered (`docs/history/a2a-0.12.md`, and its source at the last 0.12 tag through `git show`). The note pins the spec version this plan targets.
      - (b) **Mapping to the public API.** For each A2A operation, the `Agent` / `Session` call that serves it: task ↔ session and run, message parts ↔ `ContentBlock`s, `input-required` ↔ a suspended run's pending decisions, cancel ↔ `session.abort`, resubscribe ↔ `subscribe({ acrossRuns })` plus stored messages. Anything with no mapping is listed as unsupported with the error it returns.
      - (c) **What `remote` already solves** that A2A reuses or must not duplicate: `serveAgent` auth, ownership, limits (`packages/hosts/remote/src/serve.ts`), the `Agent` proxy (`connectAgent`), and `remoteHostUi`.
      - (d) **The channel runtime's adapter seam.** What an adapter implements (`packages/hosts/channels/src/types.ts`, `runtime-types.ts`), how Telegram renders approvals and drafts (`telegram.ts`, `approvals.ts`, `delivery.ts`), and how inbound updates are verified, deduplicated, and admitted (`admission.ts`, `identity.ts`, `runtime-admit.ts`).
      - (e) **Slack and Discord transports.** Slack: Events API over HTTP with request signing, Socket Mode, `chat.postMessage` / `chat.update`, interactive block actions, the 3-second acknowledgement rule, rate tiers. Discord: Gateway (identify, heartbeat, resume, intents for message content), the Interactions endpoint with Ed25519 verification, message create and edit, components, the 3-second interaction deadline. Read through the find-docs skill; the note records which transport each adapter uses and why.
      - (f) **Enforcement rows for a new subpath.** `scripts/bundles.json`, `packages/hosts/package.json` (`exports`, `files`), `src/__tests__/packaging.test.ts`, `scripts/host-surface-allowlist.json`, `docs/index.md`, `scripts/host-builder-index.mjs`.
    - Performance: n/a — read-only.
    - Code Quality: Findings are written against the task they change. Operations with no mapping are dropped from scope in the note, not improvised.
    - Security: Records the auth model per surface: what authenticates a caller, how a principal and an ownership scope are derived, and that each default is deny.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.8 (surfaces are host libraries), Phase 10, Phase 17; `docs/host.md`, `docs/host-security.md`
      - `packages/hosts/{remote,channels,ag-ui,acp}/README.md`
    - Options Considered:
      - Skip — rejected: the plan creates a subpath and depends on three external protocols.
    - Chosen Approach:
      - Read the specifications and the seams, pin versions, then confirm or re-cut.
    - API Notes and Examples:
      ```bash
      npx ctx7@latest library "A2A Protocol" "agent card, message send, task lifecycle, streaming"
      git log --oneline -- docs/history/a2a-0.12.md
      ```
    - Files to Create/Edit:
      - `plans/236-…md`: the task note
    - References:
      - Evaluation findings H1, H2
  - Test Cases to Write:
    - none — read-only
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: `@arnilo/prism-hosts/a2a` — serve an agent to A2A peers
  - Acceptance Criteria:
    - Functional:
      - `serveA2A(agent, { card, authorize, ownershipFor?, limits? })` returns a web handler `(request) => Promise<Response>` and serves the Agent Card at its well-known path. It constructs no agent.
      - `authorize` is required; without it every call is refused. It returns the principal and ownership scope for the call, or `false`.
      - Supported operations, per Task 1(b): message send (blocking), message stream (server-sent events), task get, task cancel, task resubscribe. A context id maps to one session (`agent.session({ id, create: true, ownership })`); a task maps to one run.
      - A run that suspends reports the A2A `input-required` state with one item per pending decision (approval id, tool name, redacted reason); a follow-up message carrying decisions becomes `session.resume(decisions)`.
      - Text, file, and data parts map to content blocks within the model's declared input kinds; an unsupported part fails the call with the protocol's content-type error.
      - Unsupported operations (push notification config, anything Task 1 dropped) return the protocol's unsupported-operation error.
      - A task or context outside the caller's ownership scope answers "not found", never "forbidden".
      - Request size, concurrent tasks per principal, and stream duration are bounded (`limits`, with hard caps).
    - Performance: No work at import. One session read per call; streaming forwards events as they arrive.
    - Code Quality: Uses only the public `@arnilo/prism` surface (`scripts/host-surface-allowlist.json`). The protocol codec (types, validation, error mapping) is separate from the handler.
    - Security: Deny by default. Card signing keys and any outbound credentials are refs (`env:` / `keyring:`); a literal fails at construction. Reasons and errors pass the agent redactor. The handler never dispatches a bare tool.
  - Approach:
    - Documentation Reviewed:
      - Task 1(a)–(c); `packages/hosts/ag-ui/src/handler.ts` (a web handler over `session.stream` with authorize, resume, and bounded SSE, as the shape to follow)
      - `packages/hosts/remote/src/serve.ts` (ownership and principal handling)
      - `docs/history/a2a-0.12.md` (operation list and error codes of the earlier implementation)
    - Options Considered:
      - Restore the 0.12 module as it was — rejected: it sat on `prism-core` internals that no longer exist and required host-supplied task adapters; the public `Agent` API now provides sessions, resume, and stores.
      - Serve A2A from `remote` — rejected: different protocol, different trust model, and `remote` stays Prism-to-Prism.
    - Chosen Approach:
      - A new host-library subpath over the public API, shaped like the AG-UI handler.
    - API Notes and Examples:
      ```ts
      import { serveA2A } from "@arnilo/prism-hosts/a2a";
      const handle = serveA2A(agent, { card, authorize: (request) => verifyBearer(request) });
      Bun.serve({ port: 8790, fetch: handle });
      ```
    - Files to Create/Edit:
      - `packages/hosts/a2a/{src/index.ts,src/serve.ts,src/codec.ts,src/card.ts,src/limits.ts,src/errors.ts,src/__tests__/,README.md}`: new
      - `packages/hosts/package.json`: `exports["./a2a"]`, `files`
      - `scripts/bundles.json`: the subpath row (`kind: "library"`)
      - `src/__tests__/packaging.test.ts`: the package list
      - `scripts/host-surface-allowlist.json`: the subpath's allowed imports
      - `docs/index.md`: one link to the README
      - `examples/a2a-server.ts`: new, offline; `examples/README.md`, `scripts/e2e-coverage.json`
      - `scripts/compat-baseline/arnilo__prism-hosts.txt` (name per the baseline directory): regenerated with `bun scripts/release.mjs gate --update-baseline`, additive diff in the task note
      - `bun scripts/host-builder-index.mjs`: regenerated indexes
    - References:
      - `docs/history/a2a-0.12.md`
  - Test Cases to Write:
    - `agent_card_is_served_and_valid`.
    - `message_send_runs_the_agent_and_returns_a_completed_task`.
    - `message_stream_forwards_events_as_sse`.
    - `no_authorize_refuses_every_call`.
    - `suspended_run_reports_input_required_and_resumes_on_decisions`.
    - `cancel_aborts_the_run`.
    - `task_outside_scope_is_not_found`.
    - `unsupported_operation_returns_the_protocol_error`.
    - `oversized_request_and_too_many_tasks_fail_closed`.
    - `literal_signing_key_fails_at_construction`.
    - `import_is_inert`: importing the subpath opens no socket and starts no timer.
    - `examples_demos_run_to_completion_and_emit_no_secret` covers the example.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new host-library subpath
    - Docs pages to create/edit:
      - `packages/hosts/a2a/README.md`: new, package page structure (host library variant: what it serves, inputs, security, limits, example)
      - `docs/index.md`: one sentence and link
      - `README.md`, `PRODUCT.md`: the host-library list
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: yes — the new README
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: `connectA2A` — a remote A2A agent as an `Agent`
  - Acceptance Criteria:
    - Functional:
      - `connectA2A({ url, token?, card? }, { host?, limits? })` fetches and validates the peer's Agent Card and returns an `Agent` proxy. `session()`, `run`, `stream`, `abort`, and `resume` map to A2A calls; members with no A2A equivalent (`commands`, `reload`, `models`) fail with a typed unsupported error.
      - Streamed updates become catalog events with `origin: { kind: "external", … , executedBy: "external" }`; remote tool activity is reported, never gated locally.
      - The peer's `input-required` becomes a suspended `RunResult` with pending decisions; `session.resume` sends them back.
      - `token` is a ref; the URL passes the kernel's SSRF checks (`@arnilo/prism/net`), with loopback allowed only when asked.
      - The proxy works as an `agentNode` agent in `@arnilo/prism-extensions/workflows`.
    - Performance: One card fetch per connection; no polling when the peer streams.
    - Code Quality: The proxy implements the public `Agent` and `Session` interfaces; it shares the codec with Task 2.
    - Security: The card's declared endpoints are held to the card URL's origin unless the host lists more. Response size and stream duration are bounded.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/remote/src/` (`connectAgent` and its `Agent` proxy), `packages/extensions/workflows/src/nodes/agent-node.ts`
      - `src/pinned-fetch.ts`, `src/net/index.ts`
      - Task 1(a), (b)
    - Options Considered:
      - Expose a remote A2A agent as a tool — rejected: workflows and hosts take an `Agent`; a tool wrapper is one line on top of the proxy.
    - Chosen Approach:
      - An `Agent` proxy, as `connectAgent` already does for `prism.remote/1`.
    - API Notes and Examples:
      ```ts
      const reviewer = await connectA2A({ url: "https://agents.example.com/reviewer", token: "env:REVIEWER_TOKEN" });
      agentNode({ agent: reviewer, input: (ctx) => ctx.upstream.diff });
      ```
    - Files to Create/Edit:
      - `packages/hosts/a2a/src/{connect.ts,proxy.ts}`, `packages/hosts/a2a/src/__tests__/connect.test.ts`, `packages/hosts/a2a/README.md`
      - `examples/a2a-client.ts`: new (an in-process `serveA2A` peer); `examples/README.md`, `scripts/e2e-coverage.json`
      - `scripts/compat-baseline/…`: regenerated, additive diff in the task note
    - References:
      - `packages/hosts/remote/README.md` (`connectAgent`)
  - Test Cases to Write:
    - `proxy_runs_against_an_in_process_a2a_server`: Task 2's handler as the peer.
    - `streamed_updates_become_external_origin_events`.
    - `input_required_becomes_a_suspended_result_and_resumes`.
    - `unsupported_members_fail_typed`.
    - `card_endpoint_on_another_origin_is_refused`.
    - `private_address_is_refused_unless_allowed`.
    - `proxy_works_as_a_workflow_agent_node`.
    - `token_never_appears_in_events_or_errors`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new export
    - Docs pages to create/edit:
      - `packages/hosts/a2a/README.md`: "Connecting to an A2A agent"
      - `packages/extensions/workflows/README.md`: one line under `agentNode`
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Slack channel
  - Acceptance Criteria:
    - Functional:
      - `connectSlack(agent, { token, signingSecret | appToken, authorize, … })` binds one agent to a Slack app on the existing channel runtime. Credentials are refs; a literal fails with `ChannelTokenLiteralError`.
      - Inbound: direct messages and mentions in the transport Task 1(e) chose. Each request is verified (signature and timestamp window, or the Socket Mode envelope), acknowledged within Slack's deadline, deduplicated by event id, and admitted through `authorize` before any session work.
      - A conversation binds to a session by workspace, channel, and thread; `/new` (or the configured command) starts a new generation, as on Telegram.
      - Replies post in the thread, split at Slack's length limit. With `sendDrafts: true`, one message is edited at most once per second.
      - A suspended run renders one approve and one deny button per pending decision; a click is honored only from the bound sender, before expiry, once, and maps to `session.resume`.
      - Rate-limit responses are honored with their `Retry-After`; delivery is journaled and reconciled like Telegram's.
      - `channelHostUi` works with a Slack connection.
    - Performance: One socket or one webhook route per app; no polling.
    - Code Quality: The adapter implements the runtime's existing adapter seam; the journal, admission, and approval code are not copied.
    - Security: Deny by default; unverified requests are dropped before parsing the body beyond what verification needs. Attachments carry identifiers only. No token appears in events, errors, or the journal.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/channels/src/{telegram,approvals,delivery,admission,runtime-core,runtime-turn,secret-ref,types}.ts`, `README.md`
      - Task 1(d), (e)
    - Options Considered:
      - A separate `slack` subpath — rejected: the runtime, journal, and approvals are shared; a new subpath would re-export them.
      - Bundle Slack's SDK — rejected: the Telegram and Signal adapters are plain `fetch`; the host libraries carry no vendor SDK.
    - Chosen Approach:
      - One more adapter on the shared runtime, over `fetch` and the platform socket.
    - API Notes and Examples:
      ```ts
      const slack = await connectSlack(agent, {
        token: "env:SLACK_BOT_TOKEN", signingSecret: "env:SLACK_SIGNING_SECRET",
        checkpoints, leases, authorize: ({ sender }) => allowList.has(sender.id) && { ownership: scopeFor(sender) },
      });
      Bun.serve({ port: 8791, fetch: slack.webhook });
      ```
    - Files to Create/Edit:
      - `packages/hosts/channels/src/{slack.ts,index.ts,types.ts}`, `packages/hosts/channels/src/__tests__/slack.test.ts`, `packages/hosts/channels/README.md`
      - `examples/channel-slack.ts`: new, on a scripted transport; `examples/README.md`, `scripts/e2e-coverage.json`
      - `scripts/compat-baseline/…`: regenerated, additive diff in the task note
    - References:
      - `packages/hosts/channels/src/telegram.ts`
  - Test Cases to Write:
    - `unsigned_or_stale_request_is_dropped`.
    - `duplicate_event_is_admitted_once`.
    - `unauthorized_sender_starts_no_session_work`.
    - `thread_binds_to_one_session_and_new_starts_a_generation`.
    - `long_reply_is_split_at_the_platform_limit`.
    - `approval_button_from_another_user_is_refused`.
    - `approval_is_one_use_and_expires`.
    - `rate_limited_delivery_waits_and_is_reconciled`.
    - `literal_token_fails_with_channel_token_literal_error`.
    - `no_token_in_events_errors_or_journal`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new connection in an existing host library
    - Docs pages to create/edit:
      - `packages/hosts/channels/README.md`: Slack setup, scopes, events, approvals
      - `docs/index.md`: the channels entry's sentence (Telegram, Signal, Slack, Discord)
      - `roadmap.md` §2.9's channels row is updated by plan 225 Task 2's Phase 19 entry; no further roadmap edit here
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: yes — the scope sentence of the channels entry
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: Discord channel
  - Acceptance Criteria:
    - Functional:
      - `connectDiscord(agent, { token, publicKey, applicationId, authorize, … })` binds one agent to a Discord application on the same runtime, with ref-only credentials.
      - Inbound messages arrive over the Gateway (identify, heartbeat, resume, reconnect with backoff, the intents Task 1(e) lists). Component interactions arrive over the Gateway or the Interactions endpoint, verified with Ed25519, and are acknowledged within Discord's deadline.
      - A conversation binds by guild, channel, and thread (or DM channel). Replies are split at Discord's length limit. Drafts edit one message at a bounded rate when enabled.
      - A suspended run renders approve and deny components bound to the sender, one use, with expiry, mapped to `session.resume`.
      - Rate-limit buckets and `retry_after` are honored; delivery is journaled and reconciled.
      - The bot ignores its own messages and other bots unless the host allows them.
    - Performance: One Gateway socket per connection; heartbeat is the only periodic work.
    - Code Quality: The Gateway client is a small state machine with its own tests; it shares nothing vendor-specific with the runtime.
    - Security: Deny by default; an interaction with a bad signature is rejected before parsing. No token in events, errors, or the journal.
  - Approach:
    - Documentation Reviewed:
      - Task 1(d), (e); `packages/hosts/channels/src/signal.ts` (a socket-style adapter already in the tree)
    - Options Considered:
      - Slash commands only, over the Interactions endpoint — rejected: an agent that cannot read a plain message is not a chat channel.
      - A Discord client library — rejected: same reason as Slack.
    - Chosen Approach:
      - A minimal Gateway client plus signed interactions, on the shared runtime.
    - API Notes and Examples:
      ```ts
      const discord = await connectDiscord(agent, {
        token: "env:DISCORD_BOT_TOKEN", publicKey: "env:DISCORD_PUBLIC_KEY", applicationId: "1234567890",
        checkpoints, leases, authorize: ({ sender }) => allowed(sender) && { ownership: scopeFor(sender) },
      });
      ```
    - Files to Create/Edit:
      - `packages/hosts/channels/src/{discord.ts,discord-gateway.ts,index.ts,types.ts}`, `packages/hosts/channels/src/__tests__/discord.test.ts`, `packages/hosts/channels/README.md`
      - `examples/channel-discord.ts`: new, on a scripted gateway; `examples/README.md`, `scripts/e2e-coverage.json`
      - `scripts/compat-baseline/…`: regenerated, additive diff in the task note
      - `bun scripts/host-builder-index.mjs`: regenerated indexes
    - References:
      - `packages/hosts/channels/src/signal.ts`
  - Test Cases to Write:
    - `gateway_identifies_heartbeats_and_resumes_after_a_drop`.
    - `bad_interaction_signature_is_rejected`.
    - `own_and_bot_messages_are_ignored`.
    - `unauthorized_sender_starts_no_session_work`.
    - `thread_binds_to_one_session`.
    - `long_reply_is_split_at_the_platform_limit`.
    - `approval_component_is_sender_bound_one_use_and_expires`.
    - `rate_limit_bucket_is_honored`.
    - `literal_token_fails_with_channel_token_literal_error`.
    - `no_token_in_events_errors_or_journal`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new connection in an existing host library
    - Docs pages to create/edit:
      - `packages/hosts/channels/README.md`: Discord setup, intents, approvals
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no (Task 4 changed the sentence)
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run --filter @arnilo/prism-hosts test`
- `bun run --filter @arnilo/prism-extensions test`
- `bun scripts/host-builder-index.mjs --check`
- `bun scripts/check-client-neutrality.mjs`
- `bun test --timeout=0 src/__tests__/docs.test.ts src/__tests__/packaging.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
