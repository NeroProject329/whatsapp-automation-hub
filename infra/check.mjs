import { connect } from "node:net";
import { connect as tls } from "node:tls";
import { readFileSync } from "node:fs";
import pg from "pg";
import redisPackage from "../packages/core/node_modules/ioredis/built/index.js";

if (process.env.HUB_ENV_FILE) process.loadEnvFile(process.env.HUB_ENV_FILE);
const db = new URL(process.env.DATABASE_URL);
const redis = new URL(process.env.REDIS_URL);
const pgCa = db.searchParams.get("sslcert") ?? process.env.PGSSLROOTCERT;
const tlsOpts = (url, caPath) => ({
  servername: url.hostname,
  rejectUnauthorized: true,
  ...(caPath && caPath !== "system" ? { ca: readFileSync(caPath) } : {}),
});

function transport(url, sslRequest, options) {
  const host = url.hostname;
  const port = Number(url.port || (sslRequest ? 5432 : 6379));
  return new Promise((resolve) => {
    const raw = connect({ host, port });
    let connected = false;
    const timeout = setTimeout(
      () => finish(connected ? "TLS_TIMEOUT" : "TCP_TIMEOUT"),
      5000,
    );
    let secure;
    let done = false;
    const finish = (status) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      resolve(status);
      secure?.destroy();
      raw.destroy();
    };
    const handshake = () => {
      secure = tls(
        { socket: raw, ...options },
        () => finish("TLS_VALIDADO"),
      );
      secure.on("error", (e) => finish(e.code || "TLS_ERROR"));
    };
    raw.on("error", (e) => finish(e.code || "TCP_ERROR"));
    raw.on("end", () => finish("ENCERRADO"));
    raw.once("connect", () => {
      connected = true;
      if (!sslRequest) {
        handshake();
        return;
      }
      raw.once("data", (data) =>
        data[0] === 83 ? handshake() : finish("TLS_NAO_SUPORTADO"),
      );
      raw.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]));
    });
  });
}
const [dbStatus, redisStatus] = await Promise.all([
  transport(db, true, tlsOpts(db, pgCa)),
  transport(redis, false, tlsOpts(redis)),
]);
console.log(JSON.stringify({ postgres: dbStatus, redis: redisStatus }));
if (dbStatus === "TLS_VALIDADO") {
  db.searchParams.delete("sslmode");
  db.searchParams.delete("sslaccept");
  db.searchParams.delete("sslcert");
  db.searchParams.delete("schema");
  const client = new pg.Client({
    connectionString: db.href,
    ssl: tlsOpts(db, pgCa),
    connectionTimeoutMillis: 4000,
    statement_timeout: 4000,
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const { rows } = await client.query(
      "SELECT schemaname AS schema, count(*)::int AS tables FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') GROUP BY 1 ORDER BY 1",
    );
    console.log(JSON.stringify({ authenticated: true, schemas: rows }));
    await client.query("ROLLBACK");
  } catch (e) {
    console.log(
      JSON.stringify({ authenticated: false, code: e.code || "PG_ERROR" }),
    );
  } finally {
    await client.end();
  }
}
if (redisStatus === "TLS_VALIDADO") {
  const { Redis } = redisPackage;
  redis.protocol = "rediss:";
  const client = new Redis(redis.href, {
    tls: tlsOpts(redis),
    lazyConnect: true,
    connectTimeout: 4000,
    commandTimeout: 4000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  client.on("error", () => {});
  try {
    await client.connect();
    console.log(JSON.stringify({ redisPing: (await client.ping()) === "PONG" }));
  } catch {
    console.log(JSON.stringify({ redisPing: false }));
  } finally {
    client.disconnect();
  }
}
