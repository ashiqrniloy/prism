#!/usr/bin/env bun

if (!process.env.PRISM_TEST_POSTGRES_URL?.trim()) {
  console.error("PRISM_TEST_POSTGRES_URL is required for bun run test:postgres; default test gates stay network-free.");
  process.exitCode = 1;
}
