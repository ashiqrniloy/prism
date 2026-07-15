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

See [Coding execution approval and sandboxing](../../docs/coding-security.md), [Coding agent tools](../../docs/coding-agent-tools.md), and [Host security](../../docs/host-security.md).
