# @arnilo/prism-coding-security

Optional execution approval, path containment, and sandbox adapters for `@arnilo/prism-coding-agent`.

## Usage

```ts
import { createCodingTools } from "@arnilo/prism-coding-agent";
import { createCodingApprovalPolicy } from "@arnilo/prism-coding-security";

const policy = createCodingApprovalPolicy({
  roots: [workspaceRoot],
  approve: async ({ action }) => hostUi.confirm(action),
});

const tools = createCodingTools(workspaceRoot, { executionPolicy: policy });
```

Approval caching defaults to `none`. Explicit `run`/`session` caches use real `runId`/`sessionId` values supplied by coding-tool execution context; missing identity disables caching rather than sharing globally. Shared policy also applies through `createReadOnlyTools()`. Sandbox adapters receive the shell tool's `onData` callback and should stream ordered output while honoring abort/timeout.

See [Coding execution approval and sandboxing](../../docs/coding-security.md), [Coding agent tools](../../docs/coding-agent-tools.md), and [Host security](../../docs/host-security.md).
