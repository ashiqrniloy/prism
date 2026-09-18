# @arnilo/prism-work

Prism work connectors, Office document capabilities, and bounded document-reader adapters. Import only a subpath; this package has no activating root barrel.

| Subpath | Contents |
| --- | --- |
| `@arnilo/prism-work/connectors` | Microsoft 365 and Google Workspace adapters, work tools, drafts, approvals, idempotency, and limits. |
| `@arnilo/prism-work/connectors/microsoft365` | Microsoft 365 CLI adapter. |
| `@arnilo/prism-work/connectors/google-workspace` | Google Workspace CLI adapter. |
| `@arnilo/prism-work/connectors/drafts` | Draft stores and approval helpers. |
| `@arnilo/prism-work/documents` | Prism Document Model, OOXML generate/parse/patch/preview, and bounded fidelity reporting. |
| `@arnilo/prism-work/sheets` | CSV/XLSX ingest, exact-decimal safety, and bounded schema inference. |
| `@arnilo/prism-work/diagrams` | draw.io embed model, canonical XML, origin validation, and bounded postMessage protocol. |
| `@arnilo/prism-work/document-reader` | Bounded PDF/DOCX literal-text extraction; optional parser peers fail closed. |
| `@arnilo/prism-work/sandbox` | Host-pinned work sandbox image digest and `createWorkComposition`. |
| `@arnilo/prism-work/skills` | `loadWorkSkills()` — vendored Hermes MIT `docx`/`xlsx`/`powerpoint`/`pdf`. |
| `@arnilo/prism-work/tools` | `createOfficeTools` filesystem/artifact office tools. |

## Install

```bash
npm i @arnilo/prism @arnilo/prism-work
```

```ts
import { createWorkTools } from "@arnilo/prism-work/connectors";
import { generateDocument } from "@arnilo/prism-work/documents";
```

## Dependencies and trust boundaries

- Office APIs are in-memory only: no filesystem, network, or `process.env` access.
- `mammoth` and `pdf-parse` are optional peers of `/document-reader`; it refuses creation if selected defaults are unavailable.
- Caps fail closed before output; embedded document content is not fetched or executed.
