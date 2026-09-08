// Trims the compiled Bootstrap 6 stylesheet down to only the classes the popup actually uses, then
// prunes and compresses what's left - the same pipeline the frontend app runs (apps/frontend/scripts/
// purge-css.ts). main.scss pulls in the whole framework; without this the popup would ship the lot.
//
// Run automatically at the end of `styles:build`, straight after sass writes build/css/main.css.

import purgeCSS from "@fullhuman/postcss-purgecss"
import cssnano from "cssnano"
import postcss from "postcss"
import pruneVar from "postcss-prune-var"
import compressVar from "postcss-variable-compress"

const stylesheet = "build/css/main.css"

// The popup ships every section it might need, all conditional ones `hidden`, and un-hides the ones
// that apply at runtime (popup/state.ts) - so both the static markup and the DOM helpers that toggle
// classes are scanned for class names.
const content = ["src/popup/**/*.tsx", "src/popup/**/*.ts"]

// Bootstrap 6 names responsive utilities `lg:col-4`; the stock extractor would split at the colon and
// mark every breakpoint utility unused. Trailing colons are dropped so a `class:` in source is not a
// candidate of its own. (Matches the frontend extractor.)
const extractClassNames = (source: string) => source.match(/[\w-/:]+(?<!:)/g) ?? []

const css = await Bun.file(stylesheet).text()
const before = css.length

const result = await postcss([
  purgeCSS({
    content,
    defaultExtractor: extractClassNames,
  }),
  pruneVar(),
  compressVar(),
  cssnano({ preset: ["default", { discardComments: { removeAll: true } }] }),
]).process(css, { from: stylesheet, to: stylesheet })

await Bun.write(stylesheet, result.css)

const percentage = Math.round((1 - result.css.length / before) * 100)
console.log(
  `${stylesheet}: ${Math.round(before / 1024)}kB -> ${Math.round(result.css.length / 1024)}kB (-${percentage}%)`
)
