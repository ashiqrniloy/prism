#!/usr/bin/env node

if (!process.env.PRISM_TEST_NATS_URL?.trim()) {
  console.error("PRISM_TEST_NATS_URL is required for npm run test:nats; default test gates stay network-free.");
  process.exitCode = 1;
}
