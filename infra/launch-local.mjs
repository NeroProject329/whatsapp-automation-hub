import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
const config = resolve(".runtime/local.env");
const entries = {
  api: ["apps/api/dist/main.js"],
  worker: ["apps/worker/dist/main.js"],
  web: [
    "apps/web/node_modules/next/dist/bin/next",
    "start",
    "apps/web",
    "--hostname",
    "127.0.0.1",
  ],
};
const kids = [];
for (const [name, args] of Object.entries(entries)) {
  const output = createWriteStream(resolve(".runtime/" + name + ".log"), {
    flags: "a",
  });
  const child = spawn(process.execPath, ["--env-file=" + config, ...args], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  child.once("exit", (code) => {
    output.end();
    if (code) console.error(name + " encerrou com código " + code);
  });
  kids.push(child);
}
const close = () => kids.forEach((p) => p.kill());
process.on("SIGINT", close);
process.on("SIGTERM", close);
console.log("Painel local: http://localhost:3000");
