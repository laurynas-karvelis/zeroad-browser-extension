# Zero Ad Network - Browser extension

## Requirements:

- Any Unix-like operating system. Tested on MacOS and Ubuntu.
- Latest version of `Bun.js` runtime installed.

## Project setup

Source builds require a Bun workspace with the `@styles` dependency available.
Install dependencies from the workspace root:

```sh
bun install
```

Prebuilt Chrome and Firefox ZIPs are available from successful GitHub Actions runs
in the `browser-extensions` artifact.

## Build & package

From the extension directory, build all browser targets:

```sh
bun run build
```

To create final zip artifact files:

```sh
bun run package
```

## Release

Pushing a tag builds, tests and submits the extension to both stores. The tag must
equal the `package.json` version (for example `1.0.2`), or the build fails before
anything is submitted:

```sh
git tag 1.0.2
git push origin 1.0.2
```

Both stores review each version before it goes live. A version number can be
submitted only once per store, so bump `package.json` before retrying a rejected
release.

The workflow reads credentials from two GitHub environments:

- `chrome-web-store`
  - Variables: `CHROME_PUBLISHER_ID` and `CHROME_EXTENSION_ID`.
  - Secrets: `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET` and `CHROME_REFRESH_TOKEN`,
    from an OAuth client with the `https://www.googleapis.com/auth/chromewebstore`
    scope. Set its consent screen to **In production**: refresh tokens for apps in
    testing expire after 7 days.
- `firefox-add-ons`
  - Secrets: `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`, from the
    [AMO API keys page](https://addons.mozilla.org/developers/addon/api/key/).

Firefox submissions include a source archive (this extension, `packages/styles` and
the generated lockfile) plus build instructions, because Mozilla reviewers must be
able to rebuild bundled code. Only Mozilla's reviewers can access it.

## Local development

Build an extension that accepts sync messages from `https://local.zeroad.network`:

```sh
bun run build:dev
```

Or run `bun run watch` to build immediately and rebuild when source files change.
Load the browser's artifact directory below as an unpacked or temporary extension.
After rebuilding, reload the extension and refresh the frontend tab.

Build mode controls messaging permissions, server URLs, developer tools, logging,
and HTTP token injection for local sites:

- `bun run build`: production servers, production site messaging, no developer
  toolbar, warning/error logs, HTTPS token injection only.
- `bun run build:dev` or `bun run watch`: local HTTPS servers and messaging,
  developer toolbar, debug logs, HTTP and HTTPS token injection.

Loading a production build unpacked does not enable development behavior.
Runtime development behavior also requires a development installation (unpacked
or temporary). A normally installed development build uses production servers and
disables developer tools, debug logs, and HTTP token injection; its manifest still
permits messaging from `https://local.zeroad.network`.

## Artifact locations

Each targeted browser artifact can be found inside these directories:

- Google Chrome: `./targets/chrome/`
- Mozilla Firefox: `./targets/firefox/`
