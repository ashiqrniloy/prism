#!/usr/bin/env node
import process from "node:process";
import { runCli } from "./cli-runner.js";

const code = await runCli(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
});
process.exitCode = code;
