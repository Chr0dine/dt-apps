#!/usr/bin/env node
// Runs a command while holding a lock shared by every worktree of this repo, so parallel Claude Code sessions never
// build or deploy at the same time. A second caller waits for the first to finish.
//
//   node ../../scripts/build-lock.mjs dt-app build
//
// The lock file lives in the git common dir (the main checkout's .git), which all worktrees share. A lock whose
// process is gone is treated as stale and taken over. BUILD_LOCK_TIMEOUT_MS overrides the 30 minute wait limit.
import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: build-lock.mjs <command> [args...]");
  process.exit(64);
}

const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
const lockPath = join(gitDir, "dt-app-build.lock");
const commandLine = [cmd, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
const maxWaitMs = Number(process.env.BUILD_LOCK_TIMEOUT_MS ?? 30 * 60_000);

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

const readHolder = () => {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
};

/** Takes the lock and returns null, or returns the current holder. */
function tryAcquire() {
  try {
    const fd = openSync(lockPath, "wx");
    writeSync(fd, JSON.stringify({ pid: process.pid, cwd: process.cwd(), command: commandLine, since: new Date().toISOString() }));
    closeSync(fd);
    return null;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const holder = readHolder();
  // Unreadable: either being written right now or left empty by a crash; only the latter is old.
  let stale = holder ? !alive(holder.pid) : false;
  if (!holder) {
    try {
      stale = Date.now() - statSync(lockPath).mtimeMs > 10_000;
    } catch {
      return tryAcquire(); // released in between
    }
  }
  if (stale) {
    const again = readHolder();
    if (again?.pid === holder?.pid) {
      try {
        unlinkSync(lockPath);
      } catch {}
    }
    return tryAcquire();
  }
  return holder ?? { command: "(starting)", cwd: "?", pid: "?", since: "?" };
}

const release = () => {
  if (readHolder()?.pid === process.pid) {
    try {
      unlinkSync(lockPath);
    } catch {}
  }
};

const start = Date.now();
let announced = false;
for (let holder = tryAcquire(); holder; holder = tryAcquire()) {
  if (Date.now() - start > maxWaitMs) {
    console.error(`build-lock: gave up after ${Math.round(maxWaitMs / 60_000)} min; still held by "${holder.command}" in ${holder.cwd} (pid ${holder.pid}).`);
    console.error(`build-lock: if nothing is building, delete ${lockPath}`);
    process.exit(75);
  }
  if (!announced) {
    console.log(`build-lock: waiting for "${holder.command}" in ${holder.cwd} (pid ${holder.pid}, since ${holder.since})...`);
    announced = true;
  }
  await sleep(2000);
}
if (announced) console.log(`build-lock: acquired after ${Math.round((Date.now() - start) / 1000)} s`);

process.on("exit", release);
// shell: true so Windows finds .cmd shims such as node_modules/.bin/dt-app.cmd.
const child = spawn(commandLine, { stdio: "inherit", shell: true });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
