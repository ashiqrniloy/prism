# Changelog

## [Unreleased]

- Route `reflection/beam:free` through Chat with `reasoning_content` replay so tool follow-ups preserve the upstream's required reasoning.

- Restore Command Code as a lockstep Prism provider on the Provider API: three wires (Chat Completions, Responses, Anthropic Messages) selected by catalog `supported_endpoints` and `claude-*`, per-request secret refs, provider-owned `x-cmd-zdr`, discovery, `reasoning_details` replay on Chat, the 64-char `prompt_cache_key` and `x-client-request-id` affinity on Responses, and explicit `cache_control` markers on Messages with adaptive thinking for Claude 5.x. Wire fixtures replay all three routes offline; live tests default to the three exemplars.
