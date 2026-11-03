// PreToolUse hook (Bash and PowerShell): blocks direct `dt-app build` / `dt-app deploy` calls. Builds and deploys
// must go through `npm run build` / `npm run deploy`, which hold the lock in scripts/build-lock.mjs so parallel
// sessions in different worktrees never build at the same time. Exit code 2 blocks the call and shows stderr to Claude.
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let command = "";
  try {
    command = JSON.parse(input).tool_input?.command ?? "";
  } catch {
    process.exit(0);
  }
  // `dt-app build|deploy` at the start of a command segment, or after npx / npm exec.
  const direct = /(^|[;&|(]\s*|\b(npx|exec)\s+(--\s+)?)dt-app(\.cmd)?\s+(build|deploy)\b/m;
  if (direct.test(command)) {
    process.stderr.write(
      "Blocked: run builds and deploys from the app folder as `npm run build` or `npm run deploy` " +
        "(dt-app flags go after `--`, e.g. `npm run deploy -- --skip-build`). Those scripts hold a lock shared by " +
        "all worktrees so two Claude sessions never build at once; if another session is building, they wait.",
    );
    process.exit(2);
  }
  process.exit(0);
});
