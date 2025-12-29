/* eslint-disable @typescript-eslint/no-require-imports */
const { purgeCSSPlugin } = require("@fullhuman/postcss-purgecss");
const postCsso = require("postcss-csso");

module.exports = {
  plugins: [
    postCsso({ restructure: true }),
    purgeCSSPlugin({
      content: ["./build/**/*.html", "./src/**/*.ts"],
      safelist: {
        standard: ["dark"],
        greedy: [/\[data-bs-theme=.*\]/, /\[data-theme=.*\]/, /data-bs-theme/],
        deep: [/^dark-/, /^theme-dark-/],
      },
    }),
  ],
};
