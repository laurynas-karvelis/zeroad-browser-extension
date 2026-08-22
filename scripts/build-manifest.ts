import JSONe from "json-e"
import template from "../manifest.json"
import packageJson from "../package.json"

const target = process.argv[2] as keyof typeof template | undefined

if (!target) {
  console.error("Usage: node build-manifest.js <chrome|firefox>")
  process.exit(1)
}

// Inject `package.json` into context.root
const context = { root: { version: packageJson.version, ...template.root } }

const output = JSONe(template[target], context)
console.log(JSON.stringify(output, null, "  "))
