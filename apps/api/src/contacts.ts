import { z } from "zod";
import {
  attrSchema,
  audit,
  fingerprint,
  phone,
  suppress,
  transact,
} from "@hub/core";
import { cfg, db, fail, missing, read, conflict } from "./runtime.js";
const string = z.string().trim();
export const contactInput = z.object({
  phone: string.min(8).max(30),
  name: string.max(160).default(""),
  attributes: attrSchema.default({}),
  tags: z.array(string.min(1).max(40)).max(20).default([]),
});
export const consentInput = z.object({
  source: string.min(3).max(150),
  evidence: string.min(5).max(1500),
  confirmed: z.literal(true),
});
export async function listContacts(query: unknown) {
  const q = read(
    z.object({
      q: string.max(80).default(""),
      page: z.coerce.number().int().min(1).max(10000).default(1),
      status: z
        .enum(["all", "eligible", "blocked", "no-consent"])
        .default("all"),
      tag: string.max(40).optional(),
    }),
    query,
  );
  const candidates = await db.contact.findMany({
    where: {
      phone: { not: null },
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: "insensitive" } },
              { phone: { contains: q.q } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 5001,
    include: {
      consents: { where: { revokedAt: null, purpose: "MARKETING" }, take: 1 },
    },
  });
  const fps = candidates.map((c) =>
    fingerprint(cfg.APP_ENCRYPTION_KEY, c.phone!),
  );
  const suppressed = new Set(
    (
      await db.suppression.findMany({
        where: { fingerprint: { in: fps } },
        select: { fingerprint: true },
      })
    ).map((s) => s.fingerprint),
  );
  const items = candidates
    .map((c, i) => ({
      ...c,
      consents: undefined,
      status: suppressed.has(fps[i])
        ? "blocked"
        : c.consents.length
          ? "eligible"
          : "no-consent",
    }))
    .filter((c) => q.status === "all" || q.status === c.status);
  return {
    items: items.slice((q.page - 1) * 50, q.page * 50),
    total: items.length,
    limited: candidates.length > 5000,
  };
}
export async function contactDetail(contactId: string, actor: string) {
  return transact(db, async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: contactId },
      include: { consents: { orderBy: { grantedAt: "desc" } } },
    });
    if (!contact?.phone) missing();
    const suppression = await tx.suppression.findUnique({
      where: {
        fingerprint: fingerprint(cfg.APP_ENCRYPTION_KEY, contact.phone),
      },
    });
    await audit(tx, actor, "CONTACT_VIEWED", "contact", contact.id);
    return {
      ...contact,
      suppression: suppression
        ? { reason: suppression.reason, at: suppression.createdAt }
        : null,
    };
  });
}
export async function saveContact(
  value: unknown,
  actor: string,
  contactId?: string,
) {
  const input = read(contactInput, value);
  const number = phone(input.phone);
  if (!number)
    fail("CONTACT_PHONE_INVALID", "Informe um telefone válido, com DDD.");
  const data = { ...input, phone: number, tags: [...new Set(input.tags)] };
  return transact(db, async (tx) => {
    if (contactId) {
      const existing = await tx.contact.findUnique({
        where: { id: contactId },
      });
      if (!existing?.phone) missing();
      if (existing.phone !== number)
        conflict(
          "PHONE_IMMUTABLE",
          "Cadastre o novo telefone separadamente para preservar o histórico de consentimento.",
        );
    } else if (await tx.contact.findUnique({ where: { phone: number } }))
      conflict("CONTACT_DUPLICATE", "Este telefone já está cadastrado.");
    const contact = contactId
      ? await tx.contact.update({ where: { id: contactId }, data })
      : await tx.contact.create({ data });
    await audit(
      tx,
      actor,
      contactId ? "CONTACT_UPDATED" : "CONTACT_CREATED",
      "contact",
      contact.id,
    );
    return contact;
  });
}
export async function grant(contactId: string, value: unknown, actor: string) {
  const { source, evidence } = read(consentInput, value);
  return transact(db, async (tx) => {
    const contact = await tx.contact.findUnique({ where: { id: contactId } });
    if (!contact?.phone) missing();
    if (
      await tx.suppression.findUnique({
        where: {
          fingerprint: fingerprint(cfg.APP_ENCRYPTION_KEY, contact.phone),
        },
      })
    )
      conflict("CONTACT_SUPPRESSED", "O número está na lista de supressão.");
    const c = await tx.consent.create({
      data: { contactId, source, evidence },
    });
    await audit(tx, actor, "CONSENT_GRANTED", "contact", contactId);
    return c;
  });
}
export async function optOut(contactId: string, actor: string, erase = false) {
  return transact(db, async (tx) => {
    const contact = await tx.contact.findUnique({ where: { id: contactId } });
    if (!contact?.phone) missing();
    await suppress(
      tx,
      cfg.APP_ENCRYPTION_KEY,
      contact.phone,
      erase ? "PRIVACY_ERASURE" : "MANUAL_OPT_OUT",
    );
    if (erase) {
      await tx.contact.update({
        where: { id: contactId },
        data: { phone: null, name: "", attributes: {}, tags: [] },
      });
      await tx.consent.updateMany({
        where: { contactId },
        data: { evidence: "[removido]", source: "[removido]" },
      });
      await tx.dispatch.updateMany({
        where: { OR: [{ contactId }, { phone: contact.phone }] },
        data: { phone: null, address: null, body: "" },
      });
      await tx.channelEvent.updateMany({
        where: { OR: [{ contactId }, { phone: contact.phone }] },
        data: { phone: null, address: null, text: null },
      });
    }
    await audit(
      tx,
      actor,
      erase ? "CONTACT_ERASED" : "CONSENT_REVOKED",
      "contact",
      contactId,
    );
    return { ok: true };
  });
}
