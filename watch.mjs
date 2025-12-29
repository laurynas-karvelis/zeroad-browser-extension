import { spawn } from "bun";
import chokidar from "chokidar";

// Define file groups and corresponding scripts with labels
const watchers = [
  { dir: "src/images/", allowed: () => true, cmd: "assets:build", label: "ASSETS" },
  { dir: "src/styles/", allowed: (path) => /\.scss$/.test(path), cmd: "styles:build", label: "STYLES" },
  { dir: "src/", allowed: (path) => /\.pug$/.test(path), cmd: "pug:build", label: "PUG" },
  { dir: "src/", allowed: (path) => /\.ts$/.test(path), cmd: "scripts:build", label: "SCRIPTS" },
];

// Define what gets run and in what order
/* eslint-disable no-console */
function run(cmd, label, path, ms = 100) {
  clearTimeout(timers[cmd]);
  timers[cmd] = setTimeout(async () => {
    console.log(`[${label}] change detected: ${path}`);

    if ((await runCommand("bun", ["run", cmd])) === 0) {
      await runCommand("bun", ["run", "targets:build"]);
    }
  }, ms);
}

// Debounce helper
const timers = {};
async function runCommand(command, args = []) {
  const child = spawn({
    cmd: [command, ...args],
    stdout: "inherit",
    stderr: "inherit",
  });

  // Wait until the process exits
  return await child.exited;
}

// Initialize watchers
for (const { dir, allowed, cmd, label } of watchers) {
  chokidar.watch(process.cwd() + "/" + dir, { persistent: true, ignoreInitial: true }).on("all", (event, path) => {
    if (allowed(path)) {
      run(cmd, label, path);
    }
  });
}

console.log("Watching for changes...");
