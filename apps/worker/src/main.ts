import { Queue, Worker } from "bullmq";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { applyReceipts, event } from "./events.js";
import { BaileysProvider } from "./baileys.js";
import {
  FakeProvider,
  PrismaClient,
  audit,
  env,
  fingerprint,
  log,
  nextWindow,
  phone,
  queueName,
  redis,
  transact,
  windowOpen,
} from "@hub/core";
import type { MessagingProvider } from "@hub/core";

const cfg = env();
const db = new PrismaClient({ datasourceUrl: cfg.DATABASE_URL });
const pub = redis(cfg),
  sub = redis(cfg, true);
const opts = { prefix: cfg.BULL_PREFIX };
const queue = new Queue<{ id: string }>(queueName, {
  ...opts,
  connection: pub,
});
const url = new URL(cfg.DATABASE_URL);
const schema = url.searchParams.get("schema")!;
const tls = url.searchParams.get("sslmode") === "require";
const certFile = url.searchParams.get("sslcert");
for (const name of [
  "schema",
  "sslmode",
  "sslaccept",
  "sslcert",
  "connection_limit",
  "connect_timeout",
  "pool_timeout",
])
  url.searchParams.delete(name);
const lease = new pg.Client({
  connectionString: url.href,
  ssl: tls
    ? {
        rejectUnauthorized: true,
        servername: url.hostname,
        ...(certFile
          ? { ca: (await import("node:fs")).readFileSync(certFile) }
          : {}),
      }
    : false,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
});
const active = new Map<
  string,
  { provider: MessagingProvider; generation: number }
>();
const cooldown = new Map<string, { until: number; failures: number }>();
let worker: Worker<{ id: string }>;
let stop = false;

async function manageConnections() {
  const list = await db.connection.findMany();
  for (const row of list) {
    const live = active.get(row.id);
    if (row.desired !== "ON" || (live && live.generation !== row.generation)) {
      if (live) {
        try {
          await live.provider.close(row.desired === "REVOKE");
        } catch {
          await db.audit.create({
            data: {
              actor: "worker",
              action: "REVOKE_REMOTE_UNCONFIRMED",
              entity: "connection",
              entityId: row.id,
            },
          });
        }
        active.delete(row.id);
      }
      if (row.desired === "REVOKE")
        await transact(db, async (tx) => {
          const changed = await tx.connection.updateMany({
            where: { id: row.id, generation: row.generation },
            data: {
              desired: "OFF",
              state: "EXPIRED",
              accountPhone: null,
              qr: null,
              qrExpiresAt: null,
              lastError: live ? null : "REVOKE_REMOTE_UNCONFIRMED",
            },
          });
          if (changed.count)
            await tx.authEntry.deleteMany({ where: { connectionId: row.id } });
        });
      if (row.desired !== "ON") continue;
      cooldown.delete(row.id);
    }
    if (row.provider !== cfg.PROVIDER) continue;
    const current = active.get(row.id);
    if (
      current &&
      row.state !== "OFFLINE" &&
      row.lastError !== "PROVIDER_RESTART_REQUIRED"
    )
      continue;
    if (current) {
      active.delete(row.id);
      await current.provider.close(false);
      const failures = (cooldown.get(row.id)?.failures ?? 0) + 1;
      cooldown.set(row.id, {
        failures,
        until: Date.now() + Math.min(60000, 1000 * 2 ** Math.min(failures, 6)),
      });
      continue;
    }
    if ((cooldown.get(row.id)?.until ?? 0) > Date.now()) continue;
    const provider =
      row.provider === "baileys"
        ? new BaileysProvider(
            db,
            cfg.APP_ENCRYPTION_KEY,
            row.id,
            row.generation,
          )
        : new FakeProvider();
    active.set(row.id, { provider, generation: row.generation });
    try {
      await provider.attach(async (e) => {
        if (e.kind === "state" && e.state === "READY") cooldown.delete(row.id);
        await event(db, cfg, row.id, row.generation, e);
      });
    } catch {
      active.delete(row.id);
      await provider.close(false);
      await event(db, cfg, row.id, row.generation, {
        kind: "state",
        state: "ERROR",
        code: "AUTH_LOAD_FAILED",
      });
    }
  }
}
async function runJob(id: string) {
  const snapshot = await db.dispatch.findUnique({
    where: { id },
    select: { connectionId: true },
  });
  const live = snapshot ? active.get(snapshot.connectionId) : null;
  if (!live || stop) return;
  // Check the singleton session before opening a new dispatch boundary.
  await lease.query("SELECT 1");
  const reserved = await transact(db, async (tx) => {
    const d = await tx.dispatch.findUnique({
      where: { id },
      include: {
        connection: true,
        campaign: true,
        contact: {
          include: {
            consents: {
              where: { purpose: "MARKETING", revokedAt: null },
              take: 1,
            },
          },
        },
      },
    });
    if (!d || d.state !== "PENDING" || +d.dueAt > Date.now()) return;
    if (
      d.connection.generation !== live.generation ||
      d.connection.state !== "READY" ||
      d.connection.desired !== "ON" ||
      d.connection.provider !== cfg.PROVIDER
    )
      return;
    if (d.connection.provider === "baileys" && cfg.REAL_SEND_ENABLED !== "true")
      return;
    const c = d.campaign;
    if (
      c &&
      (await tx.channelEvent.count({ where: { kind: "OPT_OUT_UNRESOLVED" } }))
    ) {
      await tx.campaign.updateMany({
        where: { id: c.id, state: { in: ["RUNNING", "SCHEDULED"] } },
        data: { state: "PAUSED" },
      });
      return;
    }
    if (
      c &&
      ((c.state !== "RUNNING" && c.state !== "SCHEDULED") ||
        c.scheduledAt > new Date())
    )
      return;
    if (c && !windowOpen(new Date(), c)) {
      await tx.dispatch.update({
        where: { id },
        data: { dueAt: nextWindow(new Date(), c), publishedAt: null },
      });
      return;
    }
    const sup = d.phone
      ? await tx.suppression.findUnique({
          where: { fingerprint: fingerprint(cfg.APP_ENCRYPTION_KEY, d.phone) },
        })
      : null;
    if (
      d.kind === "MARKETING" &&
      (!c ||
        !d.contact?.phone ||
        d.phone !== d.contact.phone ||
        !d.contact.consents.length ||
        sup)
    ) {
      await tx.dispatch.update({
        where: { id },
        data: {
          state: "SUPPRESSED",
          code: sup ? "CONTACT_SUPPRESSED" : "CONSENT_MISSING",
        },
      });
      return;
    }
    if (
      d.kind === "TEST" &&
      (sup ||
        !d.phone ||
        !cfg.TEST_NUMBERS.split(",").map(phone).includes(d.phone))
    ) {
      await tx.dispatch.update({
        where: { id },
        data: { state: "SUPPRESSED", code: "TEST_NUMBER_DENIED" },
      });
      return;
    }
    if (!d.body || (!d.phone && !d.address)) {
      await tx.dispatch.update({
        where: { id },
        data: { state: "SUPPRESSED", code: "CONTACT_ADDRESS_MISSING" },
      });
      return;
    }
    if (c?.state === "SCHEDULED")
      await tx.campaign.update({
        where: { id: c.id },
        data: { state: "RUNNING" },
      });
    const providerId = "3EB0" + randomBytes(16).toString("hex").toUpperCase();
    const result = await tx.dispatch.update({
      where: { id },
      data: { state: "DISPATCHING", reservedAt: new Date(), providerId },
    });
    await audit(tx, "worker", "DISPATCH_RESERVED", "message", id);
    return result;
  });
  if (!reserved) return;
  // The reservation commits before the provider call. Start the call while still
  // serialized with pause/opt-out, then release the lock without awaiting I/O.
  const started = await transact(db, async (tx) => {
    const row = await tx.dispatch.findUnique({
      where: { id },
      include: { connection: true, campaign: true },
    });
    if (!row || row.state !== "DISPATCHING") return;
    const sup =
      row.phone && row.kind !== "OPT_OUT"
        ? await tx.suppression.findUnique({
            where: {
              fingerprint: fingerprint(cfg.APP_ENCRYPTION_KEY, row.phone),
            },
          })
        : null;
    const c = row.campaign;
    const hold =
      c &&
      (await tx.channelEvent.count({ where: { kind: "OPT_OUT_UNRESOLVED" } }));
    const stopped =
      stop ||
      active.get(row.connectionId) !== live ||
      row.connection.generation !== live.generation ||
      row.connection.desired !== "ON" ||
      row.connection.state !== "READY" ||
      (c && (c.state !== "RUNNING" || !windowOpen(new Date(), c))) ||
      hold;
    if (sup || !row.body || c?.state === "CANCELLED" || stopped) {
      const state =
        sup || !row.body
          ? "SUPPRESSED"
          : c?.state === "CANCELLED"
            ? "CANCELLED"
            : "PENDING";
      await tx.dispatch.update({
        where: { id },
        data: {
          state,
          providerId: null,
          reservedAt: null,
          publishedAt: null,
          code: sup ? "CONTACT_SUPPRESSED" : null,
        },
      });
      return;
    }
    const pending = live.provider
      .submit({
        id: row.providerId!,
        phone: row.phone,
        address: row.address,
        text: row.body,
      })
      .then((r) => r.id)
      .catch(() => null);
    return { pending };
  });
  if (!started) return;
  let external: string | null = null;
  let timer: NodeJS.Timeout | undefined;
  try {
    external = await Promise.race([
      started.pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 20000);
      }),
    ]);
    if (!external) log("dispatch_uncertain", "PROVIDER_TIMEOUT_UNKNOWN");
  } finally {
    clearTimeout(timer);
  }
  await transact(db, async (tx) => {
    const row = await tx.dispatch.findUnique({ where: { id } });
    if (!row) return;
    const providerId = external ?? reserved.providerId!;
    await tx.dispatch.update({
      where: { id },
      data: {
        providerId,
        state:
          external && row.state === "DISPATCHING"
            ? "SUBMITTED"
            : !external && row.state === "DISPATCHING"
              ? "UNKNOWN"
              : row.state,
        submittedAt: external ? new Date() : undefined,
        code: external ? null : "PROVIDER_TIMEOUT_UNKNOWN",
      },
    });
    await applyReceipts(tx, row.connectionId, providerId);
    if (!external && row.campaignId) {
      const errors = await tx.dispatch.count({
        where: {
          campaignId: row.campaignId,
          state: { in: ["UNKNOWN", "FAILED"] },
        },
      });
      if (errors >= 5) {
        const paused = await tx.campaign.updateMany({
          where: { id: row.campaignId, state: "RUNNING" },
          data: { state: "PAUSED" },
        });
        if (paused.count)
          await audit(
            tx,
            "worker",
            "CAMPAIGN_FAILURE_LIMIT",
            "campaign",
            row.campaignId,
          );
      }
    }
  });
}
async function sweep() {
  await lease.query("SELECT 1").catch(() => {
    log("worker_lock_lost");
    process.exit(3);
  });
  await manageConnections();
  await db.runtime.upsert({
    where: { id: "worker" },
    create: { id: "worker", beat: new Date() },
    update: { beat: new Date() },
  });
  await db.dispatch.updateMany({
    where: {
      state: "DISPATCHING",
      reservedAt: { lt: new Date(Date.now() - 90000) },
    },
    data: { state: "UNKNOWN", code: "WORKER_INTERRUPTED" },
  });
  await db.campaign.updateMany({
    where: {
      state: { in: ["RUNNING", "SCHEDULED"] },
      scheduledAt: { lte: new Date() },
      jobs: { none: { state: { in: ["PENDING", "DISPATCHING"] } } },
    },
    data: { state: "COMPLETED" },
  });
  const jobs = await db.dispatch.findMany({
    where: {
      state: "PENDING",
      dueAt: { lte: new Date() },
      connection: { desired: "ON", state: "READY", provider: cfg.PROVIDER },
      OR: [
        { publishedAt: null },
        { publishedAt: { lt: new Date(Date.now() - 30000) } },
      ],
      AND: [
        {
          OR: [
            { campaignId: null },
            { campaign: { state: { in: ["SCHEDULED", "RUNNING"] } } },
          ],
        },
      ],
    },
    orderBy: [{ kind: "asc" }, { dueAt: "asc" }],
    take: 25,
    select: { id: true },
  });
  if (cfg.PROVIDER === "baileys" && cfg.REAL_SEND_ENABLED !== "true") return;
  for (const job of jobs) {
    await queue.add(
      "text",
      { id: job.id },
      { jobId: job.id, removeOnComplete: true, removeOnFail: true },
    );
    await db.dispatch.updateMany({
      where: { id: job.id, state: "PENDING" },
      data: { publishedAt: new Date() },
    });
  }
}
async function main() {
  lease.on("error", () => {
    log("worker_lock_lost");
    process.exit(3);
  });
  await lease.connect();
  const r = await lease.query(
    "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok",
    [schema + ":hub-worker"],
  );
  if (!r.rows[0]?.ok) throw new Error("WORKER_ALREADY_ACTIVE");
  await db.$connect();
  await db.connection.updateMany({
    where: { desired: "ON" },
    data: { state: "CONNECTING", qr: null, qrExpiresAt: null },
  });
  worker = new Worker<{ id: string }>(queueName, (j) => runJob(j.data.id), {
    ...opts,
    connection: sub,
    concurrency: 1,
    limiter: { max: 1, duration: cfg.SEND_INTERVAL_MS },
  });
  worker.on("error", () => log("queue_error"));
  worker.on("failed", () => log("job_failed"));
  log("worker_started");
  const shutdown = async () => {
    if (stop) return;
    stop = true;
    await worker.close();
    for (const c of active.values()) await c.provider.close(false);
    await db.runtime.deleteMany({ where: { id: "worker" } });
    await queue.close();
    pub.disconnect();
    sub.disconnect();
    await db.$disconnect();
    await lease.end();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  let lastRetention = 0;
  while (!stop) {
    try {
      await sweep();
      if (Date.now() - lastRetention > 3600000) {
        await db.importBatch.deleteMany({
          where: { expiresAt: { lte: new Date() } },
        });
        await db.session.deleteMany({
          where: { expiresAt: { lte: new Date() } },
        });
        lastRetention = Date.now();
      }
    } catch {
      log("worker_cycle_error");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
main().catch(() => {
  log("worker_start_failed");
  process.exit(1);
});
