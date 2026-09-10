import { purgeStylesheet } from "@styles/purge-stylesheet"

// Run at the end of `styles:build`, straight after sass writes build/css/main.css. main.scss pulls in
// the whole shared design system; this trims it to the classes the popup uses.
//
// The popup ships every section it might need, all conditional ones `hidden`, and un-hides the ones
// that apply at runtime (popup/state.ts) - so both the static markup and the DOM helpers that toggle
// classes are scanned for class names.
await purgeStylesheet({
  stylesheet: "build/css/main.css",
  content: ["src/popup/**/*.tsx", "src/popup/**/*.ts"],
})
