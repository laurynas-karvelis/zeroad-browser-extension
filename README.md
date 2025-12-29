# Zero Ad Network - Browser extension

## Requirements:

- Any Unix-like operating system. Tested on MacOS and Ubuntu.
- Latest version of `Bun.js` runtime installed.

## Project setup

Under project's root directory install required dependencies:

```shell
bun install
```

## Build & package

To build all final browser extensions, run:

```shell
bun run build
```

To create final zip artifact files:

```
bun run package
```

## Artifact locations

Each targeted browser artifact can be found inside these directories:

- Google Chrome: `./targets/chrome/`
- Mozilla Firefox: `./targets/firefox/`
- Microsoft Edge: `./targets/edge/`
