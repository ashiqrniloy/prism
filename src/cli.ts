#!/usr/bin/env bun
import process from "node:process";

const argv = process.argv.slice(2);
const io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr };
// `relay` stays a separate import so a vendor hook loads the relay module alone.
const code =
  argv[0] === "relay"
    ? await (await import("./cli-relay.js")).runRelay(argv.slice(1), io)
    : await (await import("./cli-manifest.js")).runManifestCommand(argv, io);
process.exitCode = code;
