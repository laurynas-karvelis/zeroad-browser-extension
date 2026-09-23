# Zero Ad Network - Browser extension

## Requirements:

- Any Unix-like operating system. Tested on MacOS and Ubuntu.
- Latest version of `Bun.js` runtime installed.

## Project setup

Under project's root directory install required dependencies:

```sh
bun install
```

## Build & package

To build all final browser extensions, run:

```sh
bun run build
```

To create final zip artifact files:

```sh
bun run package
```

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
