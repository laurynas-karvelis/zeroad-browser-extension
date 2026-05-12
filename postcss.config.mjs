import purgeCSSPlugin from "@fullhuman/postcss-purgecss"
import lightning from "postcss-lightningcss"

const config = {
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
