import purgeCSSPlugin from "@fullhuman/postcss-purgecss"
import lightning from "postcss-lightningcss"
import type { Config } from "postcss-load-config"

const config: Config = {
  plugins: [
    purgeCSSPlugin({
      content: ["./build/**/*.html", "./src/**/*.ts"],
      safelist: {
        standard: ["dark"],
        greedy: [/\[data-bs-theme=.*\]/, /\[data-theme=.*\]/, /data-bs-theme/],
        deep: [/^dark-/, /^theme-dark-/],
      },
    }),
    lightning({ browsers: ">= 0.5%, last 2 versions" }),
  ],
}

export default config
