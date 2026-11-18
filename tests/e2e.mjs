import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { PrismaClient, env } from "../packages/core/dist/index.js";
import { event } from "../apps/worker/dist/events.js";
import { createServer } from "node:net";
import ExcelJS from "../apps/api/node_modules/exceljs/excel.js";

if (process.env.HUB_ENV_FILE) process.loadEnvFile(process.env.HUB_ENV_FILE);
const dbUrl = new URL(process.env.DATABASE_URL);
const cache = new URL(process.env.REDIS_URL);
assert.ok(
  [dbUrl.hostname, cache.hostname].every((h) =>
    ["127.0.0.1", "localhost"].includes(h),
  ),
  "E2E exige Postgres e Redis locais.",
);
assert.ok(
  dbUrl.searchParams.get("schema")?.startsWith("hub_"),
  "E2E exige destino local autorizado.",
);
const rand = randomUUID().replaceAll("-", "").slice(0, 12);
dbUrl.searchParams.set("schema", "hub_e2e_" + rand);
process.env.DATABASE_URL = dbUrl.href;
process.env.BULL_PREFIX = "whatsapp-e2e-" + rand;
process.env.HUB_MODE = "local";
process.env.PROVIDER = "fake";
process.env.REAL_SEND_ENABLED = "false";
process.env.SEND_INTERVAL_MS = "1000";
process.env.TEST_NUMBERS = "+12025550123";
delete process.env.HUB_ENV_FILE;
const db = new PrismaClient({ datasourceUrl: dbUrl.href });
const temp = mkdtempSync(join(tmpdir(), "hub-e2e-"));
async function free() {
  return new Promise((res, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
}
const [apiPort, webPort] = await Promise.all([free(), free()]);
const origin = "http://127.0.0.1:" + webPort;
const apiOrigin = "http://127.0.0.1:" + apiPort;
Object.assign(process.env, {
  API_PORT: String(apiPort),
  API_HOST: "127.0.0.1",
  PUBLIC_ORIGIN: origin,
  API_INTERNAL_URL: apiOrigin,
});
const cfg = env(),
  children = new Set();
function run(filename, args = []) {
  const child = spawn(process.execPath, [filename, ...args], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}
async function wait(fn, label, limit = 25000) {
  const end = Date.now() + limit;
  let err;
  do {
    try {
      const result = await fn();
      if (result) return result;
    } catch (e) {
      err = e;
    }
    await new Promise((r) => setTimeout(r, 120));
  } while (Date.now() < end);
  throw new Error(
    "Tempo esgotado: " + label + (err ? " (" + err.message + ")" : ""),
  );
}
async function kill(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((res) => {
    child.once("exit", res);
    child.kill();
  });
}
function contents(resp) {
  return resp.json();
}
async function status(resp, wanted) {
  assert.equal(resp.status(), wanted, JSON.stringify(await contents(resp)));
  return resp.json();
}
const execPath = resolve("packages/core/node_modules/prisma/build/index.js");
const migrated = spawnSync(process.execPath, [execPath, "migrate", "deploy"], {
  cwd: resolve("packages/core"),
  stdio: "pipe",
  windowsHide: true,
});
assert.equal(
  migrated.status,
  0,
  "Migração em schema E2E falhou: " + migrated.stderr?.toString().slice(0, 350),
);
let browser;
try {
  run("apps/api/dist/main.js");
  let worker = run("apps/worker/dist/main.js");
  run("apps/web/node_modules/next/dist/bin/next", [
    "start",
    "apps/web",
    "-H",
    "127.0.0.1",
    "-p",
    String(webPort),
  ]);
  await wait(
    async () => (await fetch(apiOrigin + "/api/health/ready")).ok,
    "API pronta",
  );
  await wait(async () => (await fetch(origin + "/login")).ok, "web pronto");
  const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  browser = await chromium.launch(
    existsSync(edge) ? { executablePath: edge } : undefined,
  );
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const uiErrors = [];
  page.on("pageerror", (e) => uiErrors.push(e.message));
  await page.goto(origin + "/dashboard");
  await page.waitForURL("**/login");
  const req = page.request;
  await status(await req.get(origin + "/api/contacts"), 401);
  await status(
    await req.post(origin + "/api/auth/login", {
      data: { email: cfg.ADMIN_EMAIL, password: "incorrect password" },
      headers: { Origin: "http://other.invalid" },
    }),
    403,
  );
  await page.getByLabel("E-mail").fill(cfg.ADMIN_EMAIL);
  await page.getByLabel("Senha").fill(cfg.ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("**/dashboard");
  await page
    .getByRole("heading", { name: "Visão geral", exact: true })
    .waitFor();
  await page.getByText("Estado da operação").waitFor();
  const get = async (path) =>
    status(await req.get(origin + "/api/" + path), 200);
  const post = async (path, data, statusCode = 201) =>
    status(
      await req.post(origin + "/api/" + path, {
        data,
        headers: { Origin: origin },
      }),
      statusCode,
    );
  await status(
    await req.post(origin + "/api/contacts", {
      data: { phone: "+12025550134" },
      headers: { Origin: "http://other.invalid" },
    }),
    403,
  );
  assert.ok((await get("openapi.json")).paths["/api/campaigns"]);
  const conn = await post("connections", { label: "Remetente de teste" });
  await post("connections/" + conn.id + "/connect");
  await wait(
    async () => (await get("connections/" + conn.id)).state === "READY",
    "conexão fake",
  );
  await page.getByRole("link", { name: "Contatos", exact: true }).click();
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await page
    .getByLabel("Planilha de contatos")
    .setInputFiles({
      name: "contatos.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "PHONE;NOME\n+12025550133;Aline\n+1 202 555 0133;Duplicada\nabc;Inválida\n+12025550134;Bia",
      ),
    });
  await page.getByRole("button", { name: "Gerar prévia" }).click();
  await page.getByText("2 de 4 registros disponíveis para importar").waitFor();
  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await page.getByText("2 contatos incluídos. 2 linhas ignoradas.").waitFor();
  const contacts = (await get("contacts")).items;
  assert.equal(contacts.length, 2);
  assert.ok(contacts.every((c) => c.status === "no-consent"));
  const a = contacts.find((c) => c.name === "Aline");
  const b = contacts.find((c) => c.name === "Bia");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Contatos");
  sheet.addRows([
    ["NOME", "PHONE"],
    ["Caio", "+12025550135"],
    ["Duplicado", "+12025550133"],
    ["Fórmula", { formula: "1+1", result: 2 }],
  ]);
  const xlsx = await post("imports/contacts/preview", {
    filename: "contatos.xlsx",
    data: Buffer.from(await book.xlsx.writeBuffer()).toString("base64"),
    phoneColumn: 2,
    nameColumn: 1,
  });
  assert.deepEqual(
    xlsx.rows.map((r) => r.status),
    ["valid", "duplicate", "invalid"],
  );
  await post(
    "imports/contacts/preview",
    {
      filename: "arquivo.xlsx",
      data: Buffer.from("arquivo inválido").toString("base64"),
    },
    400,
  );
  for (const c of contacts)
    await post("contacts/" + c.id + "/consent", {
      source: "Formulário de teste",
      evidence: "fixture controlada",
      confirmed: true,
    });
  const create = async (name, contactIds, scheduledAt) =>
    post("campaigns", {
      name,
      connectionId: conn.id,
      contactIds,
      body: "Olá, {{nome}}!",
      scheduledAt: scheduledAt.toISOString(),
      windowStart: 0,
      windowEnd: 1440,
      timezone: "America/Sao_Paulo",
    });
  const approve = async (id) => {
    const p = await get("campaigns/" + id + "/preview");
    assert.equal(p.counts.invalid, 0);
    await post("campaigns/" + id + "/approve", {
      count: p.counts.eligible,
      token: p.token,
      confirmed: true,
    });
    return p;
  };
  const happy = await create(
    "Relacionamento de teste",
    [a.id, a.id],
    new Date(Date.now() + 5000),
  );
  const prev = await approve(happy.id);
  assert.equal(prev.counts.eligible, 1);
  assert.match(prev.sample[0], /Olá, Aline!/);
  await post(
    "campaigns/" + happy.id + "/test-send",
    { phone: "+12025550136", requestId: randomUUID() },
    400,
  );
  const t = await post("campaigns/" + happy.id + "/test-send", {
    phone: cfg.TEST_NUMBERS,
    requestId: randomUUID(),
  });
  await post("campaigns/" + happy.id + "/activate", { confirmed: true });
  await kill(worker);
  worker = run("apps/worker/dist/main.js");
  const dispatched = await wait(async () => {
    const rows = await get("campaigns/" + happy.id + "/messages");
    return rows[0]?.state === "SUBMITTED" && rows;
  }, "processamento após reinício");
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].deliveredAt, null);
  assert.equal(
    (await db.dispatch.findUnique({ where: { id: t.id } })).state,
    "SUBMITTED",
  );
  const main = await db.dispatch.findUnique({
    where: { id: dispatched[0].id },
  });
  const binding = await db.connection.findUnique({ where: { id: conn.id } });
  await event(db, cfg, conn.id, binding.generation, {
    kind: "receipt",
    id: main.providerId,
    receipt: "READ",
    at: new Date(),
  });
  await event(db, cfg, conn.id, binding.generation, {
    kind: "receipt",
    id: main.providerId,
    receipt: "SENT",
    at: new Date(),
  });
  assert.equal(
    (await db.dispatch.findUnique({ where: { id: main.id } })).state,
    "READ",
  );
  assert.equal(
    (await db.dispatch.findUnique({ where: { id: main.id } })).deliveredAt,
    null,
  );
  const pending = await create(
    "Futura",
    [a.id, b.id],
    new Date(Date.now() + 45_000),
  );
  await approve(pending.id);
  await post("campaigns/" + pending.id + "/activate", { confirmed: true });
  await post("campaigns/" + pending.id + "/pause");
  const evt = {
    kind: "inbound",
    id: "fixture-optout",
    address: "12025550133@s.whatsapp.net",
    phone: a.phone,
    text: "SAIR",
    at: new Date(),
  };
  await Promise.all([
    event(db, cfg, conn.id, binding.generation, evt),
    event(db, cfg, conn.id, binding.generation, evt),
  ]);
  await event(db, cfg, conn.id, binding.generation, {
    ...evt,
    id: "fixture-repeat",
  });
  assert.equal(await db.dispatch.count({ where: { kind: "OPT_OUT" } }), 1);
  assert.equal(await db.channelEvent.count({ where: { kind: "INBOUND" } }), 2);
  assert.equal(
    (await db.consent.findFirst({ where: { contactId: a.id } }))
      .revokedAt instanceof Date,
    true,
  );
  await post(
    "contacts/" + a.id + "/consent",
    { source: "Formulário", evidence: "novo cadastro", confirmed: true },
    409,
  );
  assert.equal(
    (
      await db.dispatch.findFirst({
        where: { campaignId: pending.id, contactId: a.id },
      })
    ).state,
    "SUPPRESSED",
  );
  await post("campaigns/" + pending.id + "/cancel");
  assert.equal(
    (
      await db.dispatch.findFirst({
        where: { campaignId: pending.id, contactId: b.id },
      })
    ).state,
    "CANCELLED",
  );
  assert.equal((await get("campaigns/" + pending.id)).state, "CANCELLED");
  const guarded = await create(
    "Contingência",
    [b.id],
    new Date(Date.now() + 60000),
  );
  const snapshot = await approve(guarded.id);
  const edited = await status(
    await req.patch(origin + "/api/campaigns/" + guarded.id, {
      headers: { Origin: origin },
      data: {
        name: "Contingência alterada",
        connectionId: conn.id,
        contactIds: [b.id],
        body: "Outro texto, {{nome}}.",
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
        windowStart: 0,
        windowEnd: 1440,
      },
    }),
    200,
  );
  assert.equal(edited.state, "DRAFT");
  await post(
    "campaigns/" + guarded.id + "/approve",
    { count: snapshot.counts.eligible, token: snapshot.token, confirmed: true },
    409,
  );
  await approve(guarded.id);
  const anonymous = {
    ...evt,
    id: "fixture-lid",
    address: "100000012345678@lid",
    phone: null,
  };
  await event(db, cfg, conn.id, binding.generation, anonymous);
  await post("campaigns/" + guarded.id + "/activate", { confirmed: true }, 409);
  await event(db, cfg, conn.id, binding.generation, {
    ...anonymous,
    phone: b.phone,
    text: "Obrigado",
    id: "fixture-lid-resolved",
  });
  assert.equal(
    await db.channelEvent.count({ where: { kind: "OPT_OUT_UNRESOLVED" } }),
    0,
  );
  assert.equal(
    (await get("campaigns/" + guarded.id + "/preview")).counts.suppressed,
    1,
  );
  const interrupted = await db.dispatch.create({
    data: {
      uniqueKey: "fixture-lost",
      connectionId: conn.id,
      kind: "TEST",
      phone: cfg.TEST_NUMBERS,
      body: "Mensagem de teste",
      state: "DISPATCHING",
      reservedAt: new Date(Date.now() - 95000),
    },
  });
  await wait(
    async () =>
      (await db.dispatch.findUnique({ where: { id: interrupted.id } }))
        .state === "UNKNOWN",
    "reserva interrompida não é reenviada",
  );
  await page.goto(origin + "/dashboard");
  await page.getByText("Atividade de envio").waitFor();
  await page.screenshot({ path: join(temp, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(temp, "mobile.png"), fullPage: true });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("link", { name: "Campanhas", exact: true }).click();
  await page.getByRole("heading", { name: "Campanhas", exact: true }).waitFor();
  await page.getByRole("link", { name: "Relacionamento de teste" }).click();
  await page.getByRole("heading", { name: "Destinatários" }).waitFor();
  assert.deepEqual(uiErrors, []);
  await status(
    await req.post(origin + "/api/auth/logout", {
      headers: { Origin: origin },
    }),
    200,
  );
  await status(await req.get(origin + "/api/contacts"), 401);
  console.log(
    "E2E aprovado: auth/CSRF, importação, preview, teste com allowlist, fila após reinício, status fora de ordem, opt-out concorrente, pausa/cancelamento, portal móvel. Capturas: " +
      temp,
  );
} finally {
  await browser?.close();
  await Promise.all([...children].map(kill));
  await db.$disconnect();
}
