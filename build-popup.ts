import { renderPopupHtml } from "./src/popup/popup"

// Written straight into `build/` so `targets:build` picks it up alongside the compiled scripts.
await Bun.write("build/popup.html", renderPopupHtml())
