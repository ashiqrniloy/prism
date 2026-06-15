#!/usr/bin/env node
import { description } from "./index.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`prism - ${description}`);
  process.exit(0);
}

console.log("prism - agent harness. Use --help for usage.");
