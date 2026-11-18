import { spawn } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";
import { resolve } from "node:path";

const configPath = resolve(".runtime/whatsapp-test.env");
process.loadEnvFile(configPath);
const origin = "https://localhost:3443";
if (
  process.env.PUBLIC_ORIGIN !== origin ||
  process.env.HUB_MODE !== "local" ||
  process.env.PROVIDER !== "baileys" ||
  process.env.API_HOST !== "127.0.0.1" ||
  process.env.API_PORT !== "4101" ||
  process.env.API_INTERNAL_URL !== "http://127.0.0.1:4101"
) {
  throw new Error(
    "A configuração do teste deve apontar para o ambiente local.",
  );
}
const children = [];
const server = createServer(
  {
    cert: readFileSync(".runtime/whatsapp-test.crt"),
    key: readFileSync(".runtime/whatsapp-test.key"),
  },
  (req, res) => {
    if (req.headers.host !== "localhost:3443") {
      res.writeHead(400).end();
      return;
    }
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: 3001,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, "x-forwarded-proto": "https" },
      },
      (result) => {
        res.writeHead(result.statusCode, result.headers);
        result.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(503);
      res.end("O painel local está iniciando.");
    });
    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
  },
);

function stop() {
  server.close();
  for (const child of children) child.kill();
}
server.on("error", () => {
  console.error("Não foi possível abrir o endereço HTTPS de teste.");
  stop();
  process.exitCode = 1;
});
server.listen(3443, "127.0.0.1", () => {
  const programs = {
    api: ["apps/api/dist/main.js"],
    worker: ["apps/worker/dist/main.js"],
    web: [
      "apps/web/node_modules/next/dist/bin/next",
      "start",
      "apps/web",
      "-H",
      "127.0.0.1",
      "-p",
      "3001",
    ],
  };
  for (const [name, args] of Object.entries(programs)) {
    const output = createWriteStream(
      resolve(".runtime/whatsapp-test-" + name + ".log"),
      { flags: "a" },
    );
    const child = spawn(
      process.execPath,
      ["--env-file=" + configPath, ...args],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.pipe(output, { end: false });
    child.stderr.pipe(output, { end: false });
    child.on("exit", () => output.end());
    children.push(child);
  }
  console.log("WhatsApp de teste em " + origin);
});
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
