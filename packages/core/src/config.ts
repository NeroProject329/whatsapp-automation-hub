import { config as load } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";
import { Redis } from "ioredis";

export function env() {
  if (process.env.HUB_ENV_FILE)
    load({ path: resolve(process.env.HUB_ENV_FILE), quiet: true });
  const result = z
    .object({
      DATABASE_URL: z.url(),
      REDIS_URL: z.url(),
      APP_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i),
      JWT_SECRET: z.string().min(32),
      ADMIN_EMAIL: z.email().optional(),
      ADMIN_PASSWORD: z.string().min(14).max(200).optional(),
      PUBLIC_ORIGIN: z.url().default("http://localhost:3000"),
      API_HOST: z.string().default("127.0.0.1"),
      API_PORT: z.coerce.number().int().min(1024).max(65535).default(4100),
      HUB_MODE: z.enum(["local", "production"]).default("local"),
      PROVIDER: z.enum(["fake", "baileys"]).default("fake"),
      REAL_SEND_ENABLED: z.enum(["true", "false"]).default("false"),
      TEST_NUMBERS: z.string().default(""),
      BULL_PREFIX: z
        .string()
        .regex(/^[a-z0-9-]{3,48}$/)
        .default("whatsapp-hub-local"),
      SEND_INTERVAL_MS: z.coerce
        .number()
        .int()
        .min(1000)
        .max(300000)
        .default(5000),
    })
    .safeParse(process.env);
  if (!result.success)
    throw new Error(
      "Configuração inválida: " +
        result.error.issues.map((i) => i.path.join(".")).join(", "),
    );
  const c = result.data;
  const db = new URL(c.DATABASE_URL),
    redis = new URL(c.REDIS_URL),
    origin = new URL(c.PUBLIC_ORIGIN);
  const trusted = (host: string, internal: string) =>
    (c.HUB_MODE === "local" &&
      ["localhost", "127.0.0.1", "[::1]", internal].includes(host)) ||
    host.endsWith(".railway.internal");
  if (
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    !/^hub_[a-z0-9_]+$/.test(db.searchParams.get("schema") ?? "")
  )
    throw new Error("DATABASE_URL exige schema exclusivo com prefixo hub_.");
  if (
    !trusted(db.hostname, "postgres") &&
    (db.searchParams.get("sslmode") !== "require" ||
      db.searchParams.get("sslaccept") !== "strict")
  )
    throw new Error(
      "PostgreSQL externo exige sslmode=require e sslaccept=strict.",
    );
  if (
    !["redis:", "rediss:"].includes(redis.protocol) ||
    (!trusted(redis.hostname, "redis") && redis.protocol !== "rediss:")
  )
    throw new Error("Redis externo exige TLS (rediss).");
  if (
    origin.origin !== c.PUBLIC_ORIGIN ||
    !["http:", "https:"].includes(origin.protocol) ||
    (c.HUB_MODE === "production" && origin.protocol !== "https:")
  )
    throw new Error(
      "PUBLIC_ORIGIN deve ser uma origem válida; produção exige HTTPS.",
    );
  if (c.PROVIDER === "baileys" && c.HUB_MODE !== "production")
    throw new Error("Baileys exige ambiente HTTPS de produção ou homologação.");
  return c;
}
export type Config = ReturnType<typeof env>;
export const queueName = "dispatch";
export function redis(c: Config, worker = false) {
  const url = new URL(c.REDIS_URL);
  const security =
    url.protocol === "rediss:"
      ? { tls: { servername: url.hostname, rejectUnauthorized: true } }
      : {};
  const client = new Redis(c.REDIS_URL, {
    ...security,
    maxRetriesPerRequest: worker ? null : 1,
    connectTimeout: 5000,
    enableOfflineQueue: worker,
    retryStrategy: (n) => Math.min(250 * n, 5000),
  });
  client.on("error", () => {});
  return client;
}
export function log(kind: string, code?: string) {
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      kind,
      ...(code ? { code } : {}),
    }),
  );
}
