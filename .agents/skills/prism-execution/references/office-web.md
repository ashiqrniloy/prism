# Office, web tools, browser, obscura, devices

Office document family, web research tools, browser automation, host-binary
browser engine, device adapters.

## Docs (current contracts)

- [documents.md](../../../../docs/documents.md): OOXML generate/parse/patch/preview for docx/xlsx/pptx.
- [sheets.md](../../../../docs/sheets.md): fail-closed XLSX/CSV ingestion, decimal safety.
- [diagrams.md](../../../../docs/diagrams.md): draw.io embed client, XXE-safe XML validation.
- [web-tools.md](../../../../docs/web-tools.md): Brave/Exa/Firecrawl tools, obscura search/fetch.
- [browser-automation.md](../../../../docs/browser-automation.md): Playwright browser tools, policy, checkpoints.
- [obscura.md](../../../../docs/obscura.md): host-binary headless engine adapter, CDP composition.
- [device-adapters.md](../../../../docs/device-adapters.md): deny-by-default voice/desktop contract.
- [computer-use-linux.md](../../../../docs/computer-use-linux.md): Linux desktop control over host MCP binary.

## Graft queries

- `graft ask "xlsx csv ingestion caps decimal" --source`
- `graft ask "device adapter admission consent sandbox" --source`
- `graft callers createDrawioEmbed`

## Tests

- `packages/office/src/**/__tests__/`
- `packages/web-tools/src/**/__tests__/`
- `src/__tests__/devices.test.ts`

## Don't do

- Don't allow floating-point conversion in sheets money paths — exact decimal strings only.
- Don't fetch or execute embedded document content (document reader is literal-text extraction).
- Device admission stays deny-by-default: consent + sandbox + approval + bounds, or it fails closed.

Adjacent: `openapi-tools.md` (host OpenAPI → tools), `data-classification.md` (field policy on extracted content).
