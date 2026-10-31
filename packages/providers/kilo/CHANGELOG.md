# Changelog

## [Unreleased]

- Add Kilo AI Gateway as a Prism provider: three wires (Chat Completions, Responses, Anthropic Messages) selected by the catalog's `opencode.ai_sdk_provider`, `env:`/`keyring:` key resolution with a device-login fallback, `X-KILOCODE-TASKID` affinity, optional organization and mode headers, `provider.data_collection`, USD cost and cache usage mapping, catalog discovery with `isFree`/`mayTrainOnYourPrompts`/alias metadata, and recorded wire fixtures for all three routes.
- Add the `kilo` device login as an `oauth` `AuthMethod`: initiate, allowlisted verification URL, 3-second polling with approval/denial/expiry/busy mapping, profile organization choice, a v1 bearer credential with JWT expiry (one-year fallback), request-time key-first resolution, and local logout. The package now declares `credentials:write`.
- Match the Kilo CLI's cache levers per wire: the Responses route sends no `prompt_cache_key` (the CLI sends none and the gateway places its own breakpoints), Messages keeps the CLI's first-two-system/last-two-message `cache_control` placement, and the offline `cache_levers_match_kilo_cli` test pins the task-id header, marker placement, and a byte-stable prefix across the plan-203 turns against recorded CLI 7.8.18 requests.
