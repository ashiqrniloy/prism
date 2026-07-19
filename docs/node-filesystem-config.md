# Node filesystem config loader

## What it does

The optional `@arnilo/prism/node/config` subpath reads JSON config files that a Node host explicitly names. It also computes the conventional user config path, such as `~/.config/prism/config.json`.

APIs:

- `defaultUserConfigPath()`
- `readConfigFile()`
- `loadConfigFiles()`
- `NodeConfigFile`

## When to use it

Use this subpath in Node CLI/host code that wants filesystem config layers for `mergeConfigLayers()`.

Do not use it from core root imports, browsers, package manifests, agent/session runtime startup, extension setup by default, or any path where filesystem access must stay unavailable.

## Inputs / request

```ts
import { defaultUserConfigPath, loadConfigFiles, readConfigFile } from "@arnilo/prism/node/config";
```

`NodeConfigFile`:

| Field | Type | Purpose |
| --- | --- | --- |
| `name` | `string` | Config layer name. |
| `path` | `string` | Explicit JSON file path to read. |
| `optional` | `boolean` | Skip missing files when true. |

## Outputs / response / events

- `defaultUserConfigPath(appName = "prism")` returns a path ending in `.config/<appName>/config.json` under the current user's home directory.
- `readConfigFile(path)` returns a JSON object or rejects for read errors, invalid JSON, or non-object JSON.
- `loadConfigFiles(files)` returns `ConfigLayer[]` in caller-provided order.
- No events are emitted and no config is merged automatically.

## Request/response example

```json
{
  "files": [
    { "name": "user", "path": "/home/demo/.config/prism/config.json", "optional": true }
  ]
}
```

## Implementation example

```ts
import { mergeConfigLayers } from "@arnilo/prism";
import { defaultUserConfigPath, loadConfigFiles } from "@arnilo/prism/node/config";

const layers = await loadConfigFiles([
  { name: "user", path: defaultUserConfigPath(), optional: true },
  { name: "runtime", path: "./prism.config.json" },
]);

const config = mergeConfigLayers(layers);
console.log(config);
```

## Extension and configuration notes

- This loader is an explicit Node subpath. Importing `@arnilo/prism` does not read files or compute config layers.
- Hosts choose which paths to read and which missing files are optional.
- Optional missing files are detected with typed Node `error.code === "ENOENT"` via `isNodeErrorCode()` — not by matching `"ENOENT"` in `error.message`.
- The loader returns `ConfigLayer[]`; use `mergeConfigLayers()` from the root package to combine layers.
- It does not discover packages, scan directories, watch files, import extension modules, load manifests, or start agent/session runtime behavior.

## Security and performance notes

- Only caller-provided files are read.
- Invalid JSON and non-object JSON fail closed.
- Errors include the path and reason, not file contents.
- Config files must not contain resolved credential values, tokens, headers, or executable code.
- The loader uses Node built-ins and has no polling, watchers, network calls, or dependencies.

## Related APIs

- [Configuration and manifests](configuration-and-manifests.md): in-memory config layers and merge behavior.
- [Credentials and redaction](credentials-and-redaction.md): keep credentials out of config files.
- [Extension kernel and event bus](extensions.md): extension loading remains separate from filesystem config loading.
