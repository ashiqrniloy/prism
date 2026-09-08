# Prism Wiki Requirements

Apply these requirements to every Prism plan task.

## Documentation decision per task

Every task must include `Documentation/Wiki Assessment` with:

- `Public API or behavior impacted`: yes/no and why.
- `Docs pages to create/edit`: concrete `/docs` paths, or `none` with reason.
- `docs/index.md update`: yes/no and the navigation entry to add/change. Answer `no` whenever `Public API or behavior impacted` is `no` — navigation edits require a behavior delta.
- `Documentation structure reference`: this file when docs are required.

Documentation is required when a task adds or changes any public API, extension point, configuration surface, provider/model/tool/session behavior, event name/payload, package export/subpath, CLI/RPC protocol, resource loader, settings/credential behavior, or default/replaceable implementation.

## Current-line vs history (plan 068)

- `/docs` documents the **current contract** of the latest released version. Release narrative is history.
- Index entry = **one sentence** describing what the page covers today. No plan numbers (`plan 041`), no version narrative ("0.2.6 adds"), no changed-package cuts, no god-module line counts.
- Historical content (migration cuts per era, publish handoffs, readiness records, primitive reviews) goes to `docs/history/` or `CHANGELOG.md` — never into an API page body and never into an index blurb.
- API pages must not carry release-recap sections; record release deltas in `CHANGELOG.md` under the version heading.

## `/docs` structure

- `/docs/index.md` is the navigation map for humans and AI agents.
- Group entries by the index's live headings, for example:
  - Public contracts
  - Identity and governance
  - Agent/session runtime
  - Compaction/session memory
  - Provider and model connection
  - Input, prompt, and context assembly
  - Tools
  - Documents, sheets, and diagrams
  - Extensions/plugins
  - Configuration/manifests
  - Server/API
  - Multi-agent and interoperability
  - CLI/RPC
  - Security and credentials
  - Testing and examples
  - Third-party integrations
- Each index entry must include a one-sentence functional description and a link to the detailed page.

## API page structure

Each API page must use this structure:

````markdown
# <API name>

## What it does
<Small description of what the API does — current contract, no release narrative.>

## When to use it
<When an app/package/extension should use this API.>

## Inputs / request
<Field table or typed shape.>

## Outputs / response / events
<Field table, return type, events, or side effects.>

## Request/response example
```json
<minimal example payload or config>
```

## Implementation example
```ts
<minimal working TypeScript example>
```

## Extension and configuration notes
<How extensions/plugins/config can replace or contribute behavior.>

## Security and performance notes
<Secrets, permissions, trust boundaries, resource use, latency, limits.>

## Related APIs
- `<API or page>`: <relationship>
````

If an API page covers multiple small APIs, repeat the sections per API or provide a table plus examples for each exported function/type.
