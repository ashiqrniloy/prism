# Work sandbox (`@arnilo/prism-work/sandbox`)

## What it does

Host-built Docker image and in-process composition for document work. `WORK_SANDBOX_IMAGE` is a digest-pinned fixture (`name@sha256:<64-hex>`); hosts replace the zero digest after `docker build`. `createWorkComposition({ sandbox })` takes an injected `DisposableSandbox` (from `createDockerSandbox`, never forked here), copies its capability attestation, wires `createOfficeTools` filesystem mode plus `work_exec`, and optionally host-side `createWorkTools`. Connectors stay on the host. Default env has no `M365_*` / `GOOGLE_*` keys.

## When to use it

Use when Office parse/generate and Python/LibreOffice/poppler scripts must run inside a network-none container. Do **not** put Graph/Gmail tokens in the sandbox. Do not import `@arnilo/prism-coding-tools` from this package — the host constructs `createDockerSandbox({ image: WORK_SANDBOX_IMAGE, user: "65532:65532", network: { mode: "none" } })` and injects the session.

## Inputs / request

`createWorkComposition(options)`:

| Field | Meaning |
| --- | --- |
| `sandbox` | Injected adapter with `execFile` and optional `readFile`/`writeFile`/`root`. Required. |
| `connectors?` | `WorkToolsOptions` for host-side M365/GWS tools. |
| `office?` | Extra `createOfficeTools` options (caps, artifacts, redactor). |
| `reader?` | Host-built `DocumentReader`; exposed on the composition, not turned into tools. |
| `filesystem?` | `WorkSandboxFilesystem` when the sandbox has no `readFile`/`writeFile`. |
| `env?` | Extra container env. `M365_*` and `GOOGLE_*` names throw. |

Image build context: `packages/prism-work` (`sandbox/Dockerfile` + `sandbox/soffice.sh` + `vendor/hermes-agent`). Vendored Hermes scripts land at `/opt/prism-work/skills`.

## Outputs / response / events

`{ tools, composition }`. `tools` always include `office_*` and `work_exec`. `composition.capabilities` is a frozen copy of the sandbox attestation (malformed metadata → every field `false`). `networkIsolated` is true only when the sandbox attests it — Docker reports that solely for `network: { mode: "none" }`. `composition.execFile` strips token env names and forces LibreOffice `-env:UserInstallation=file:///tmp/lo-profile` without `--accept` / macro flags.

## Request/response example

```ts
import { createDockerSandbox } from "@arnilo/prism-coding-tools/security";
import { createWorkComposition, WORK_SANDBOX_IMAGE } from "@arnilo/prism-work/sandbox";

const sandbox = await createDockerSandbox({
  docker: "/usr/bin/docker",
  image: WORK_SANDBOX_IMAGE, // replace zeros with the host-built digest
  sourceRoot: workdir,
  user: "65532:65532",
  network: { mode: "none" },
});
const { tools, composition } = createWorkComposition({ sandbox, connectors });
```

## Implementation example

```ts
import { createWorkComposition, WORK_SANDBOX_IMAGE } from "@arnilo/prism-work/sandbox";

const { tools, composition } = createWorkComposition({
  sandbox: fakeDisposableSandbox, // tests inject this; no Docker
});
composition.capabilities.networkIsolated; // copied, never invented
```

Build:

```bash
docker build -f packages/prism-work/sandbox/Dockerfile -t prism-work-sandbox packages/prism-work
docker image inspect --format '{{index .RepoDigests 0}}' prism-work-sandbox
```

## Extension and configuration notes

- Do not fork `createDockerSandbox`. Image pull/build stays outside Prism (`--pull=never`).
- Connectors optional and host-side. Bytes move via sandbox import/export and office filesystem tools.
- `work_exec` is argv-only (`file` + `args`); no model-supplied shell string.
- Protected image check: `PRISM_TEST_WORK_SANDBOX=1` runs `scripts/work-sandbox-image.test.mjs` and sandbox recalc/render/legacy-convert tests. Default `npm test` does not spawn `soffice`.

## Recalc and visual QA

In-process `SheetModel` does not evaluate formulas. Cached values are filled only by LibreOffice in this image (`network: none`, isolated `/tmp/lo-profile`, deleted with the container). Vendored scripts:

```bash
python3 /opt/prism-work/skills/skills/productivity/xlsx/scripts/xlsx_recalc.py /workspace/out.xlsx --timeout 60
python3 /opt/prism-work/skills/skills/productivity/powerpoint/scripts/pptx_render.py /workspace/deck.pptx --outdir /workspace/render
```

Equivalent argv (wrapper already injects `-env:UserInstallation=file:///tmp/lo-profile --headless`):

```bash
soffice --headless -env:UserInstallation=file:///tmp/lo-profile --convert-to pdf --outdir /tmp/out /workspace/out.xlsx
pdftoppm -png -r 100 /tmp/out/out.pdf /tmp/out/page
```

External workbook links cannot be fetched. Recalc then fails closed: formula stays, cached value missing or error — Prism does not invent a number. `soffice` timeout ≤ 60 s.

## Legacy convert

Prism AST still refuses non-ZIP packages. Convert OLE `.doc` / `.xls` / `.ppt` inside this image (`network: none`, isolated `/tmp/lo-profile`, macros refused), then `office_parse`:

```bash
soffice --headless -env:UserInstallation=file:///tmp/lo-profile --convert-to docx --outdir /workspace /workspace/legacy.doc
soffice --headless -env:UserInstallation=file:///tmp/lo-profile --convert-to xlsx --outdir /workspace /workspace/legacy.xls
soffice --headless -env:UserInstallation=file:///tmp/lo-profile --convert-to pptx --outdir /workspace /workspace/legacy.ppt
```

Do not enable macros. Encrypted OOXML stays dropped. No in-process OLE parser.

## Security and performance notes

- Default network none. Composition does not claim isolation the sandbox did not attest.
- Token env keys denied by name (`M365_*`, `GOOGLE_*`) at composition construct and `execFile`.
- LibreOffice wrapper: private `/tmp/lo-profile`, `--headless`, no macro enable, `--accept` refused. No listening socket. Legacy convert uses the same wrapper.
- Zip bombs: existing office parse caps; sandbox export uses existing export caps.
- Image build is CI/protected, not default unit tests. Composition construct is in-process with a fake sandbox.

## Related APIs

- [Coding security](coding-security.md) — `createDockerSandbox` digest pin, user, network none
- [Work tools](work-tools.md) — host-side connectors
- [Documents](documents.md) — `createOfficeTools`
- [Document reader](document-reader.md) — optional `reader` injection
- [Context and skills](context-and-skills.md) — `loadWorkSkills()` (`docx`, `xlsx`, `powerpoint`, `pdf`)
