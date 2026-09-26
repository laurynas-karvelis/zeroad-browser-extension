import { Resvg } from "@resvg/resvg-js"

// Chrome rejects SVG extension icons, so its manifest points at these rasterized copies. It scales
// the 128px image down for the toolbar and extensions page.
for (const icon of ["logo", "logo-gray"]) {
  const svg = await Bun.file(`src/images/${icon}.svg`).text()
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 128 } }).render().asPng()

  await Bun.write(`build/images/${icon}.png`, png)
}
