# Prism Wiki Requirements

Apply these requirements to every Prism plan task.

## Documentation decision per task

Every task must include `Documentation/Wiki Assessment` with:

- `Public API or behavior impacted`: yes/no and why.
- `Docs pages to create/edit`: concrete `/docs` paths, or `none` with reason.
- `docs/index.md update`: yes/no and the navigation entry to add/change.
- `Documentation structure reference`: this file when docs are required.

Documentation is required when a task adds or changes any public API, extension point, configuration surface, provider/model/tool/session behavior, event name/payload, package export/subpath, CLI/RPC protocol, resource loader, settings/credential behavior, or default/replaceable implementation.

## `/docs` structure

- `/docs/index.md` is the navigation map for humans and AI agents.
- Group entries by functionality, for example:
  - Provider and model connection
  - Agent/session runtime
  - Input and prompt assembly
  - Tools
  - Context and skills
  - Extensions/plugins
  - Configuration/manifests
  - Compaction/session memory
  - CLI/RPC
  - Security/auth/trust
- Each index entry must include a short functional description and a link to the detailed page.

## API page structure

Each API page must use this structure:

````markdown
# <API name>

## What it does
<Small description of what the API does.>

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
