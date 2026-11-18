import { spawnSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { connect } from "node:net";

const dir = resolve(".runtime");
const pg = join(
  dir,
  "node_modules",
  "@embedded-postgres",
  "windows-x64",
  "native",
  "bin",
);
const redisRoot = join(dir, "redis");
const redisExe = readdirSync(redisRoot, { recursive: true })
  .map((p) => join(redisRoot, p))
  .find((p) => p.endsWith("redis-server.exe"));
const pgData = join(dir, "postgres");
const rnd = () => randomBytes(32).toString("hex");
const env = join(dir, "local.env");
if (!existsSync(env)) {
  writeFileSync(
    env,
    [
      "HUB_MODE=local",
      "PROVIDER=fake",
      "REAL_SEND_ENABLED=false",
      "PUBLIC_ORIGIN=http://localhost:3000",
      "API_INTERNAL_URL=http://127.0.0.1:4100",
      "API_HOST=127.0.0.1",
      "API_PORT=4100",
      "REDIS_URL=redis://127.0.0.1:56379",
      "BULL_PREFIX=whatsapp-hub-local",
      "TEST_NUMBERS=+12025550123",
      "SEND_INTERVAL_MS=1000",
      "ADMIN_EMAIL=admin@hub.local",
      "ADMIN_PASSWORD=" + rnd().slice(0, 22),
      "APP_ENCRYPTION_KEY=" + rnd(),
      "JWT_SECRET=" + rnd(),
      "DATABASE_URL=postgresql://hub:" +
        rnd() +
        "@127.0.0.1:55432/postgres?schema=hub_local&sslmode=disable",
    ].join("\n") + "\n",
    { flag: "wx", mode: 0o600 },
  );
}
process.loadEnvFile(env);
function run(file, args) {
  const a = spawnSync(file, args, {
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
  });
  if (a.status !== 0) throw Error("Falha ao executar " + file);
}
async function ready(port) {
  return new Promise((res) => {
    const s = connect(port, "127.0.0.1");
    s.once("connect", () => {
      s.destroy();
      res(true);
    });
    s.once("error", () => res(false));
  });
}
if (!existsSync(join(pgData, "PG_VERSION"))) {
  const secret = join(dir, "pg-init.pw");
  writeFileSync(secret, new URL(process.env.DATABASE_URL).password + "\n", {
    mode: 0o600,
  });
  try {
    run(join(pg, "initdb.exe"), [
      "-D",
      pgData,
      "-U",
      "hub",
      "-A",
      "scram-sha-256",
      "--locale=C",
      "-E",
      "UTF8",
      "--pwfile",
      secret,
    ]);
  } finally {
    (await import("node:fs")).unlinkSync(secret);
  }
}
if (!(await ready(55432))) {
  if (existsSync(join(pgData, "postmaster.pid")))
    throw Error("Verifique o estado do PostgreSQL local.");
  run(join(pg, "pg_ctl.exe"), [
    "-D",
    pgData,
    "-l",
    join(dir, "postgres.log"),
    "-o",
    "-p 55432 -h 127.0.0.1",
    "-w",
    "start",
  ]);
}
if (!(await ready(56379))) {
  const redisData = join(dir, "redis-data");
  mkdirSync(redisData, { recursive: true });
  const child = spawn(
    redisExe,
    [
      "--bind",
      "127.0.0.1",
      "--port",
      "56379",
      "--dir",
      redisData,
      "--appendonly",
      "yes",
      "--logfile",
      join(dir, "redis.log"),
    ],
    {
      cwd: dirname(redisExe),
      windowsHide: true,
      stdio: "ignore",
      detached: true,
    },
  );
  child.unref();
  let attempts = 40;
  while (!(await ready(56379)) && --attempts > 0)
    await new Promise((r) => setTimeout(r, 250));
  if (!attempts) throw Error("Redis local indisponível.");
}
console.log("Infraestrutura de teste disponível no loopback.");
