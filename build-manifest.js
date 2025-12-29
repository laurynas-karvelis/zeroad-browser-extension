/* eslint-disable no-console */
import JSONe from "json-e";
import template from "./manifest.json";
import packageJson from "./package.json";

const target = process.argv[2];

if (!target) {
  console.error("Usage: node hydrate.js <chrome|firefox>");
  process.exit(1);
}

// Inject `package.json` into context.root
const context = { root: template.root };
context.root = { version: packageJson.version, ...context.root };

const output = JSONe(template[target], context);
console.log(JSON.stringify(output, null, "  "));
