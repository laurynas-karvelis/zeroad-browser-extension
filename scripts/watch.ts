import { spawn } from "bun"
import chokidar from "chokidar"

// Define file groups and corresponding scripts with labels
const watchers = [
  {
    dir: "src/images/",
    allowed: () => true,
    cmd: "assets:build",
    label: "ASSETS",
  },
  {
    dir: "src/styles/",
    allowed: (path: string) => /\.scss$/.test(path),
    cmd: "styles:build",
    label: "STYLES",
  },
  {
    dir: "src/",
    allowed: (path: string) => /\.tsx$/.test(path),
    cmd: "popup:build",
    label: "POPUP",
  },
  {
    dir: "src/",
    allowed: (path: string) => /\.ts$/.test(path),
    cmd: "scripts:build",
    label: "SCRIPTS",
  },
]

// Define what gets run and in what order
/* eslint-disable no-console */
function run(cmd: string, label: string, path: string, ms = 100) {
  clearTimeout(timers[cmd])
  timers[cmd] = setTimeout(async () => {
    console.log(`[${label}] change detected: ${path}`)

    if ((await runCommand("bun", ["run", cmd])) === 0) {
      await runCommand("bun", ["run", "targets:build"])
    }
  }, ms)
}

// Debounce helper
const timers: Record<string, ReturnType<typeof setTimeout>> = {}
async function runCommand(command: string, args: string[] = []) {
  const child = spawn({
    cmd: [command, ...args],
    stdout: "inherit",
    stderr: "inherit",
  })

  // Wait until the process exits
  return await child.exited
}

// Initialize watchers
for (const { dir, allowed, cmd, label } of watchers) {
  chokidar.watch(`${process.cwd()}/${dir}`, { persistent: true, ignoreInitial: true }).on("all", (_event, path) => {
    if (allowed(path)) {
      run(cmd, label, path)
    }
  })
}

console.log("Watching for changes...")
