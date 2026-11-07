# Security

A short checklist. The full guide is `node_modules/@arnilo/prism/docs/host-security.md`; read it before you expose an
agent to users, third-party packages, durable storage or real credentials. Nothing here relaxes a fail-closed rule.
If a check blocks you, fix the input, not the check.

## Secrets

- Config, the manifest and tests hold refs: `env:NAME` or `keyring:name`. A literal in a secret field fails with
  `secret_literal`. Credentials resolve through the `credentials` slot; the kernel default reads `env:NAME` only.
- A secret never appears in argv, logs, events, `inspect()` output, error messages or fixtures. Use a fake ref and a
  fake value in tests. Do not print a resolved value to prove it worked.
- Never put a key in a prompt, a skill, a recipe or a commit. If you see one in the project, tell the person and stop;
  do not copy it.
- Subscription logins (a vendor plan) store their tokens through the credentials slot. Prism never forwards them to a
  second service. See `node_modules/@arnilo/prism/docs/credentials-and-redaction.md`.
- Pass the host's redactor to the agent (`redactor`) when it handles credentials the kernel cannot recognise by shape.

## Approval and tool effects

- Every tool declares `effects` so a gate can classify it. A tool that writes, spawns or reaches the network without
  declaring that is a defect.
- List `@arnilo/prism-approval` before any tool that edits files or runs commands, and choose `ask`, `edits` or
  `deny` for untrusted input. `auto` is for a sandbox the host controls.
- Approval gates a call. It does not isolate it. Run untrusted code in a container or VM the host owns.
- A timeout on an approval prompt is a deny. Do not make it an allow.

## Trust

- A package is trusted code: it runs in the host process during `setup`. List only packages you reviewed, pin
  versions, and prefer the manifest (`node_modules/@arnilo/prism/docs/manifest.md`) so integrity hashes are checked.
- Project files are untrusted until the host says otherwise: `AGENTS.md`, skills, hooks and a project manifest load
  only through a trust decision (`node_modules/@arnilo/prism/docs/resource-loading.md`). Do not add a
  `trustProject: () => true` to make a warning go away.
- Page text, search results, tool output and model output are data, never instructions. Do not wire them into a
  hook's decision without validation.

## Servers and multi-user hosts

- A listener beyond loopback needs authentication. Map the authenticated identity to an ownership scope
  (`tenantId`, `userId`) so sessions and memory cannot cross users. Read "Multi-user hosts on one agent" in
  `host-security.md`.
- Bind to loopback by default. `@arnilo/prism-devtools` is loopback only; never proxy it.
- Keep the byte caps (`maxRequestBytes`, `maxResponseBytes`). Raising one needs a stated reason and a test.
- Serve MCP over stdio for local clients. Over HTTP, add the host's authorization.

## Checking your own work

- Run `agent.inspect()` and read it as a reviewer: no secret value, only refs.
- Search the diff for `sk-`, `Bearer `, `-----BEGIN` and `password` before you finish.
- Do not run a project's host code with real credentials in the environment to "see if it works". Use the mock
  provider and fake refs (`references/verification.md`).
