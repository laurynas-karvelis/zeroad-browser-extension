import JSONe from "json-e"
import template from "../manifest.json"
import packageJson from "../package.json"

const target = process.argv[2] as keyof typeof template | undefined

if (!target) {
  console.error("Usage: bun build-manifest.ts <chrome|firefox>")
  process.exit(1)
}

// Only development builds let the local HTTPS frontend talk to the extension.
const isDevelopmentBuild = process.env.EXTENSION_DEV === "1"
const externalMatches = isDevelopmentBuild
  ? [...template.root.external_matches, "https://zeroad.local/*"]
  : template.root.external_matches

// Inject `package.json` into context.root
const context = { root: { ...template.root, version: packageJson.version, external_matches: externalMatches } }

const output = JSONe(template[target], context)
console.log(JSON.stringify(output, null, "  "))
