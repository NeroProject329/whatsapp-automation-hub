import { z } from "zod";
import {
  allowed,
  audit,
  canSend,
  digest,
  fingerprint,
  marketingFooter,
  nextWindow,
  phone,
  render,
  transact,
} from "@hub/core";
import type { Tx } from "@hub/core";
import { cfg, db, fail, conflict, missing, read, id } from "./runtime.js";

const body = z.string().trim().min(1).max(4000);
const timeZone = z
  .string()
  .max(80)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  });
export const campaignInput = z
  .object({
    name: z.string().trim().min(2).max(100),
    connectionId: id,
    contactIds: z.array(id).min(1).max(500),
    body: body.optional(),
    templateId: id.optional(),
    scheduledAt: z.iso.datetime({ offset: true }),
    timezone: timeZone.default("America/Sao_Paulo"),
    windowStart: z.number().int().min(0).max(1439),
    windowEnd: z.number().int().min(1).max(1440),
  })
  .refine((v) => v.windowEnd > v.windowStart && !!(v.body || v.templateId));
const action = z.enum(["approve", "activate", "pause", "resume", "cancel"]);
export const approvalInput = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  count: z.number().int().min(1),
  confirmed: z.literal(true),
});
export const activateInput = z.object({ confirmed: z.literal(true) });
export const templateInput = z.object({
  name: z.string().trim().min(2).max(80),
  body,
});
export const testInput = z.object({
  phone: z.string().min(8).max(30),
  contactId: id.optional(),
  requestId: id,
});
async function preview(
  tx: Tx,
  c: { id: string; audience: string[]; body: string },
) {
  const contacts = await tx.contact.findMany({
    where: { id: { in: c.audience } },
    orderBy: { id: "asc" },
    include: {
      consents: { where: { revokedAt: null, purpose: "MARKETING" }, take: 1 },
    },
  });
  const subs = await tx.suppression.findMany({
    where: {
      fingerprint: {
        in: contacts.flatMap((x) =>
          x.phone ? [fingerprint(cfg.APP_ENCRYPTION_KEY, x.phone)] : [],
        ),
      },
    },
  });
  const blocked = new Set(subs.map((s) => s.fingerprint));
  const counts = {
    eligible: 0,
    missing: c.audience.length - contacts.length,
    noConsent: 0,
    suppressed: 0,
    invalid: 0,
  };
  const eligible: { id: string; phone: string; text: string }[] = [],
    errors: { id: string; variables: string[] }[] = [];
  for (const contact of contacts) {
    if (!contact.phone) {
      counts.missing++;
      continue;
    }
    if (blocked.has(fingerprint(cfg.APP_ENCRYPTION_KEY, contact.phone))) {
      counts.suppressed++;
      continue;
    }
    if (!contact.consents.length) {
      counts.noConsent++;
      continue;
    }
    const r = render(c.body + marketingFooter, contact);
    if (r.missing.length) {
      counts.invalid++;
      errors.push({ id: contact.id, variables: r.missing });
      continue;
    }
    counts.eligible++;
    eligible.push({ id: contact.id, phone: contact.phone, text: r.text });
  }
  const token = digest(JSON.stringify({ id: c.id, counts, eligible, errors }));
  return { counts, eligible, errors, token };
}
function realGate(provider: string, kind = "MARKETING") {
  if (!canSend(cfg, provider, kind))
    conflict(
      "REAL_SEND_DISABLED",
      cfg.HUB_MODE === "local" && kind === "MARKETING"
        ? "Este ambiente libera apenas envios individuais de teste."
        : "Envios reais estão desabilitados neste ambiente.",
    );
}
export async function saveTemplate(value: unknown, actor: string) {
  const data = read(templateInput, value);
  const syntax = render(data.body, {
    name: "exemplo",
    phone: "+5511912345678",
    attributes: {},
  });
  if (syntax.missing.includes("sintaxe inválida"))
    fail("TEMPLATE_INVALID", "Use variáveis no formato {{nome}}.");
  return transact(db, async (tx) => {
    const last = await tx.template.findFirst({
      where: { name: data.name },
      orderBy: { version: "desc" },
    });
    const t = await tx.template.create({
      data: { ...data, version: (last?.version ?? 0) + 1 },
    });
    await audit(tx, actor, "TEMPLATE_CREATED", "template", t.id);
    return t;
  });
}
export async function createCampaign(
  value: unknown,
  actor: string,
  campaignId?: string,
) {
  const data = read(campaignInput, value);
  return transact(db, async (tx) => {
    if (!(await tx.connection.findUnique({ where: { id: data.connectionId } })))
      missing();
    if (campaignId) {
      const current = await tx.campaign.findUnique({
        where: { id: campaignId },
      });
      if (!current) missing();
      if (current.state !== "DRAFT" && current.state !== "READY")
        conflict(
          "INVALID_STATE_TRANSITION",
          "A edição só está disponível antes da ativação.",
        );
    }
    const template = data.templateId
      ? await tx.template.findUnique({ where: { id: data.templateId } })
      : null;
    if (data.templateId && !template) missing();
    const message = template?.body ?? data.body!;
    if (
      render(message, {
        name: "exemplo",
        phone: "+5511912345678",
        attributes: {},
      }).missing.includes("sintaxe inválida")
    )
      fail("TEMPLATE_INVALID", "Use variáveis no formato {{nome}}.");
    const fields = {
      name: data.name,
      body: message,
      connectionId: data.connectionId,
      audience: [...new Set(data.contactIds)],
      scheduledAt: new Date(data.scheduledAt),
      timezone: data.timezone,
      windowStart: data.windowStart,
      windowEnd: data.windowEnd,
    };
    const c = campaignId
      ? await tx.campaign.update({
          where: { id: campaignId },
          data: {
            ...fields,
            state: "DRAFT",
            approval: null,
            approvedAt: null,
            approvedBy: null,
          },
        })
      : await tx.campaign.create({ data: fields });
    await audit(
      tx,
      actor,
      campaignId ? "CAMPAIGN_EDITED" : "CAMPAIGN_CREATED",
      "campaign",
      c.id,
    );
    return c;
  });
}
export async function previewCampaign(cid: string) {
  return transact(db, async (tx) => {
    const c = await tx.campaign.findUnique({ where: { id: cid } });
    if (!c) missing();
    const { counts, eligible, errors, token } = await preview(tx, c);
    return {
      counts,
      sample: eligible.slice(0, 5).map((x) => x.text),
      errors,
      token,
    };
  });
}
export async function changeCampaign(
  cid: string,
  rawAction: string,
  value: unknown,
  actor: string,
) {
  const a = read(action, rawAction);
  return transact(db, async (tx) => {
    const c = await tx.campaign.findUnique({
      where: { id: cid },
      include: { connection: true },
    });
    if (!c) missing();
    if (!(allowed[a] as readonly string[]).includes(c.state))
      conflict(
        "INVALID_STATE_TRANSITION",
        "Esta ação não está disponível no estado atual.",
      );
    if (
      (a === "activate" || a === "resume") &&
      (await tx.channelEvent.count({ where: { kind: "OPT_OUT_UNRESOLVED" } }))
    )
      conflict(
        "OPT_OUT_IDENTITY_UNRESOLVED",
        "Há um pedido de descadastro sem telefone confirmado. A campanha permanece parada até o canal identificar o número.",
      );
    let state = "",
      approval = c.approval,
      approvedAt = c.approvedAt,
      approvedBy = c.approvedBy;
    if (a === "approve") {
      const p = await preview(tx, c),
        confirmation = read(approvalInput, value);
      if (
        p.token !== confirmation.token ||
        p.counts.eligible !== confirmation.count
      )
        conflict(
          "PREVIEW_CHANGED",
          "A prévia mudou. Atualize e confira novamente.",
        );
      if (p.counts.invalid || !p.counts.eligible)
        fail(
          "TEMPLATE_INVALID",
          "Verifique os campos dos destinatários elegíveis.",
        );
      approval = p.token;
      approvedAt = new Date();
      approvedBy = actor;
      state = "READY";
    }
    if (a === "activate") {
      read(activateInput, value);
      realGate(c.connection.provider);
      if (c.connection.state !== "READY")
        conflict(
          "CONNECTION_UNAVAILABLE",
          "Vincule o remetente antes de iniciar.",
        );
      const p = await preview(tx, c);
      if (p.token !== approval || !p.eligible.length)
        conflict(
          "PREVIEW_CHANGED",
          "A prévia mudou. Cancele e crie um novo rascunho.",
        );
      const due = nextWindow(
        new Date(Math.max(Date.now(), c.scheduledAt.getTime())),
        c,
      );
      state = due.getTime() > Date.now() ? "SCHEDULED" : "RUNNING";
      await tx.dispatch.createMany({
        data: p.eligible.map((x) => ({
          uniqueKey: "campaign:" + cid + ":" + x.id,
          kind: "MARKETING",
          campaignId: cid,
          connectionId: c.connectionId,
          contactId: x.id,
          phone: x.phone,
          body: x.text,
          dueAt: due,
        })),
      });
    }
    if (a === "pause") state = "PAUSED";
    if (a === "resume") {
      realGate(c.connection.provider);
      if (c.connection.state !== "READY")
        conflict(
          "CONNECTION_UNAVAILABLE",
          "Reconecte o remetente antes de retomar.",
        );
      state = c.scheduledAt.getTime() > Date.now() ? "SCHEDULED" : "RUNNING";
    }
    if (a === "cancel") {
      state = "CANCELLED";
      await tx.dispatch.updateMany({
        where: { campaignId: cid, state: "PENDING" },
        data: { state: "CANCELLED" },
      });
    }
    const updated = await tx.campaign.update({
      where: { id: cid },
      data: { state, approval, approvedAt, approvedBy },
    });
    await audit(tx, actor, "CAMPAIGN_" + a.toUpperCase(), "campaign", cid);
    return updated;
  });
}
export async function testSend(cid: string, value: unknown, actor: string) {
  const data = read(testInput, value);
  const n = phone(data.phone);
  if (!n || !cfg.TEST_NUMBERS.split(",").map(phone).includes(n))
    fail(
      "TEST_NUMBER_DENIED",
      "Use um número de teste autorizado na configuração.",
    );
  return transact(db, async (tx) => {
    const c = await tx.campaign.findUnique({
      where: { id: cid },
      include: { connection: true },
    });
    if (!c) missing();
    realGate(c.connection.provider, "TEST");
    if (c.connection.state !== "READY")
      conflict("CONNECTION_UNAVAILABLE", "O remetente não está pronto.");
    if (
      await tx.suppression.findUnique({
        where: { fingerprint: fingerprint(cfg.APP_ENCRYPTION_KEY, n) },
      })
    )
      conflict("CONTACT_SUPPRESSED", "O número está na lista de supressão.");
    if (data.contactId && !c.audience.includes(data.contactId))
      fail("TEST_CONTACT_INVALID", "Selecione um contato da campanha.");
    const contact = data.contactId
      ? await tx.contact.findUnique({ where: { id: data.contactId } })
      : null;
    const text = render(
      c.body + marketingFooter,
      contact ?? { name: "Contato de teste", phone: n, attributes: {} },
    );
    if (text.missing.length)
      fail(
        "TEMPLATE_INVALID",
        "O destinatário de exemplo não tem todos os campos.",
        text.missing,
      );
    const key = "test:" + cid + ":" + data.requestId;
    const existing = await tx.dispatch.findUnique({
      where: { uniqueKey: key },
    });
    if (existing) return existing;
    const job = await tx.dispatch.create({
      data: {
        uniqueKey: key,
        kind: "TEST",
        connectionId: c.connectionId,
        phone: n,
        body: text.text,
      },
    });
    await audit(tx, actor, "TEST_QUEUED", "campaign", cid);
    return job;
  });
}
