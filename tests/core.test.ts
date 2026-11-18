import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  FakeProvider,
  decrypt,
  encrypt,
  fingerprint,
  isOptOut,
  nextWindow,
  phone,
  render,
  windowOpen,
} from "../packages/core/dist/index.js";
import type { ChannelUpdate } from "../packages/core/dist/index.js";

test("telefone canônico e entradas inválidas", () => {
  assert.equal(phone("11 91234-5678"), "+5511912345678");
  assert.equal(phone("5511912345678"), "+5511912345678");
  assert.equal(phone("123456789"), null);
  assert.equal(phone("foo +5511912345678"), null);
});
test("variáveis são estritas e não interpretam chaves herdadas", () => {
  const c = {
    name: "Luís",
    phone: "+5511912345678",
    attributes: { cidade: "Belém" },
  };
  assert.deepEqual(render("Olá {{nome}}, {{cidade}}!", c), {
    text: "Olá Luís, Belém!",
    missing: [],
  });
  assert.deepEqual(render("{{constructor}} e {{ausente}}", c).missing, [
    "constructor",
    "ausente",
  ]);
  assert.ok(render("{{ nome }", c).missing.includes("sintaxe inválida"));
});
test("opt-out não reage a frases ou ambiguidades", () => {
  assert.equal(isOptOut(" Sair! "), true);
  assert.equal(isOptOut("ＰＡＲＡＲ"), true);
  assert.equal(isOptOut("Eu vou sair de casa."), false);
  assert.equal(isOptOut("não sair"), false);
});
test("janela usa fuso explícito e exclui o limite final", () => {
  const c = {
    timezone: "America/Sao_Paulo",
    windowStart: 540,
    windowEnd: 1080,
  };
  assert.ok(windowOpen(new Date("2026-11-18T12:00:00Z"), c));
  assert.ok(!windowOpen(new Date("2026-11-18T21:00:00Z"), c));
  assert.equal(
    nextWindow(new Date("2026-11-18T21:00:05Z"), c).toISOString(),
    "2026-11-19T12:00:00.000Z",
  );
});
test("auth cifrada com contexto e supressão com chave", () => {
  const k = randomBytes(32).toString("hex");
  const cipher = encrypt(k, "sessão", "auth:uma");
  assert.equal(decrypt(k, cipher, "auth:uma"), "sessão");
  assert.throws(() => decrypt(k, cipher, "auth:outra"));
  assert.notEqual(
    fingerprint(k, "+5511912345678"),
    fingerprint(randomBytes(32).toString("hex"), "+5511912345678"),
  );
});
test("contrato fake emite estados e não fabrica entrega", async () => {
  const provider = new FakeProvider(),
    events: ChannelUpdate[] = [];
  await assert.rejects(
    provider.submit({ id: "m", phone: "+12025550123", text: "Teste" }),
  );
  await provider.attach(async (event) => {
    events.push(event);
  });
  assert.deepEqual(
    await provider.submit({ id: "m", phone: "+12025550123", text: "Teste" }),
    { id: "m" },
  );
  assert.deepEqual(events, [{ kind: "state", state: "READY" }]);
  await provider.close();
  assert.deepEqual(events, [
    { kind: "state", state: "READY" },
    { kind: "state", state: "OFFLINE" },
  ]);
  await assert.rejects(
    provider.submit({ id: "m", phone: "+12025550123", text: "Teste" }),
  );
});
