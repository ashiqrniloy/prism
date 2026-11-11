# @arnilo/prism-hosts

Prism host libraries and the process driver. Versions stay in lockstep with `@arnilo/prism` because the host-builder indexes describe that exact kernel version.

```sh
bun add @arnilo/prism @arnilo/prism-hosts
bunx --package @arnilo/prism-hosts prism-host-builder install --target agents
bunx --package @arnilo/prism-hosts prism-devtools --model provider/model
```

Import only the subpath your host uses; there is no root barrel.

| Subpath | Purpose |
| --- | --- |
| [acp](acp/README.md) | Agent Client Protocol |
| [ag-ui](ag-ui/README.md), `ag-ui/renderer` | AG-UI serving and reference renderer |
| [channels](channels/README.md), `channels/telegram`, `channels/signal` | Messaging channels |
| [devtools](devtools/README.md) | Local developer inspector |
| [evals](evals/README.md) | Datasets, scorers and experiments |
| [headless](headless/README.md) | HostUi routing and durable scheduling |
| [host-builder](host-builder/README.md) | Version-exact indexes, skill and MCP server |
| [mcp-server](mcp-server/README.md) | MCP stdio and HTTP serving |
| [remote](remote/README.md), `remote/testing` | Remote agent serving and clients |
| [driver-process](driver-process/README.md), `driver-process/testing` | External-agent process driver and conformance |

Protocol SDKs are optional peers. Install them for the entrypoint your host uses:

| Entry | Peers | Installed size |
| --- | --- | --- |
| `acp` | `@agentclientprotocol/sdk@1.4.0` | 5.8 M |
| `ag-ui` | `@ag-ui/core@1.0.4`, `zod@^4.6.6` | 1.1 M + 6.1 M |
| `ag-ui/renderer` | `@ag-ui/core@1.0.4` | 1.1 M |
| `mcp-server`, host-builder MCP command | `@modelcontextprotocol/server@^2.3.0`, `zod@^4.6.6` | 7.0 M + 6.1 M |

Protocol entrypoints require their peers and fail at import if they are absent. The host-builder `info`, `install` and `help` commands and devtools work without those peers. Importing `headless` loads no protocol SDK. The required extensions bundle supplies workflows, codecs and observability. The bundle has no install script.
