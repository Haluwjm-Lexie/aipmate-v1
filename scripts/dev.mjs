import { spawn } from "node:child_process";
const args = process.argv.slice(2);
let host = "127.0.0.1",
  port = "3020";
for (let i = 0; i < args.length; i++) {
  if (["--host", "--hostname"].includes(args[i])) host = args[++i];
  else if (args[i] === "--port") port = args[++i];
}
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
    "--hostname",
    host,
    "--port",
    port,
  ],
  { stdio: "inherit", env: process.env },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code || 0));
