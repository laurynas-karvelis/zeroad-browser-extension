import JSONe from "json-e"
import template from "../manifest.json"
import packageJson from "../package.json"

const target = process.argv[2] as keyof typeof template | undefined

if (!target) {
  console.error("Usage: bun build-manifest.ts <chrome|firefox>")
  process.exit(1)
}

// Only a development build lets the locally served site talk to the extension. A published build
// trusting localhost would hand that channel to any local dev server or app, on any port.
const isDevelopmentBuild = process.env.EXTENSION_DEV === "1"
const externalMatches = isDevelopmentBuild
  ? [...template.root.external_matches, "http://localhost/*"]
  : template.root.external_matches

// Inject `package.json` into context.root
const context = { root: { ...template.root, version: packageJson.version, external_matches: externalMatches } }

const output = JSONe(template[target], context)
console.log(JSON.stringify(output, null, "  "))
