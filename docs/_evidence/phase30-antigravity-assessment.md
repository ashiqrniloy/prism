# Phase 30 Antigravity CLI + Prism MCP assessment

Recorded: 2026-08-20  
Plan: 031  
Decision: **conditional GO**

## Product decision

0.3.0 scope is reopened for one opt-in delegated-agent package: `@arnilo/prism-antigravity-agent`.

Accepted control boundary:

- official Antigravity `agy` owns model calls, planning, subagents, checkpoints, and its internal loop;
- Prism exposes selected capabilities through authorized MCP tools and owns their authorization, guardrails, limits, effects, identity, and redaction;
- Prism owns outer cancellation/limits, delegated-event persistence, and UI projection;
- UI displays only documented `stream-json` fields. It may display response deltas, steps, tools, subagents, checkpoints, durations, status, usage, and `thinking_tokens` counts. It does not claim or scrape raw chain-of-thought.

This satisfies the product objective: use the Antigravity quota attached to the host's Google AI Pro account while making compatible Prism capabilities available to the delegated agent.

## Authentication decision

Authentication is owned by official `agy`:

1. Host authenticates in an interactive `agy` session.
2. Headless runs use `agy` cached credentials.
3. Prism never reads credential files, receives tokens, starts OAuth, refreshes credentials, or contacts private Antigravity endpoints.
4. Missing authentication is reported as setup guidance; there is no automatic login fallback.
5. Gemini API key and Vertex modes are separate billing paths and do not satisfy the Google AI Pro objective.

## Terms interpretation

This record is architecture evidence, not legal advice.

Implementation may proceed on documented integration boundaries because:

- official headless documentation says `agy -p` is for scripting agent tasks, integrating with CI, and capturing machine-readable output in programs;
- official MCP documentation defines MCP as Antigravity's bridge to local tools and APIs;
- Prism invokes the official binary and serves a documented MCP extension rather than implementing an Antigravity service client.

Public publication remains conditional on recorded owner/counsel acceptance or Google confirmation that programmatically launching documented headless CLI with cached login is permitted. The package must never implement Antigravity OAuth reuse, cookie/session-token reuse, credential-file access, OAuth plugins/proxies, private protocols, or safety bypass.

Sources:

- <https://antigravity.google/docs/cli/headless/>
- <https://antigravity.google/docs/cli/mcp/>
- <https://antigravity.google/docs/cli/commands/agents>
- <https://antigravity.google/docs/plans>
- <https://antigravity.google/docs/faq/>
- <https://antigravity.google/terms>

## Scope amendment

| Surface | Before amendment | Target |
| --- | ---: | ---: |
| Publishable manifests | 56 | 57 |
| Workspace manifests | 55 | 56 |
| Provider packages | 17 | 17 |
| Family packages | 10 | 10 |
| New package | — | `@arnilo/prism-antigravity-agent` |
| Provider/umbrella membership | — | omitted |
| New runtime dependencies | 0 | 0 |
| Host prerequisite | — | official `agy` binary |

All other plan-030 deferrals remain frozen. Cursor delegation remains out of 0.3.0.

## Protocol proof status

Deterministic executable proof now passes:

```text
node scripts/phase30-antigravity-probe.mjs --fixture
status: passed
init: 1, step_update: 2, result: 1
Prism MCP authorization/tool calls: 1/1
workspace cleanup: passed
```

The fixture uses the real `createPrismMcpServer` over official SDK stdio transport; only the outer CLI is simulated. It proves workspace config discovery, bounded `init`/`step_update`/`result` parsing, exactly-once Prism authorization/tool execution, safe delegated metadata, temporary-workspace cleanup, and unauthenticated setup guidance without OAuth/callback/token automation.

Live `agy` protocol proof also ran with host binary version `1.1.16`: bounded `init`/`step_update`/`result` output was observed, and Antigravity targeted `prism/prism_echo`. The call was auto-denied because no global `mcp(prism/prism_echo)` allow rule exists. The probe did not edit global settings or use `--dangerously-skip-permissions`; the authorized live MCP leg remains a host-owned release gate. No credential files were inspected.
