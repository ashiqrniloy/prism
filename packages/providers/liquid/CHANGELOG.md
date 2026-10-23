# Changelog

## [Unreleased]

### Added

- New provider package (plan 196 Task 2): `@arnilo/prism-provider-liquid` registers two System One
  decision providers from one vendor package — hosted `liquid` (`d1.1`, `d1-ultra` at
  `https://api.liquid.ai/decisions/v1/systemone`, key from `env:LIQUID_API_KEY`) and `liquid-local`
  (`d1-3B` served by llama.cpp `llama-server` at `http://127.0.0.1:8080`, optional `localApiKey`).
  `hosted: false` is a local-only setup that skips the hosted missing-key note. Built on
  `@arnilo/prism/provider-kit`'s `createSystemOneDecisionProvider`; the package avoids
  `systemOneProviderPackage` because that helper registers exactly one provider.

## [0.13.0]

- Release-graph anchor: introduced on the 0.13.0 lockstep line by plan 196 (Phase 18 Part B).
