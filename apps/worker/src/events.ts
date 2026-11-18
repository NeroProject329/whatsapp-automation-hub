import {
  audit,
  confirmation,
  digest,
  encrypt,
  fingerprint,
  isOptOut,
  stateRank,
  suppress,
  transact,
} from "@hub/core";
import type {
  ChannelUpdate,
  Config,
  PrismaClient,
  Tx,
  Receipt,
} from "@hub/core";
import QRCode from "qrcode";

export async function applyReceipts(
  tx: Tx,
  connectionId: string,
  providerId: string,
) {
  const d = await tx.dispatch.findUnique({
    where: { connectionId_providerId: { connectionId, providerId } },
  });
  if (!d || ["PENDING", "SUPPRESSED", "CANCELLED"].includes(d.state)) return;
  const events = await tx.channelEvent.findMany({
    where: {
      connectionId,
      providerId,
      kind: { in: ["SENT", "DELIVERED", "READ"] },
    },
    orderBy: { occurredAt: "asc" },
  });
  if (!events.length) return;
  const facts: Record<Receipt, Date | null> = {
    SENT: d.sentAt,
    DELIVERED: d.deliveredAt,
    READ: d.readAt,
  };
  let state = d.state;
  for (const e of events) {
    const k = e.kind as Receipt;
    if (!facts[k] || +e.occurredAt < +facts[k]!) facts[k] = e.occurredAt;
    if ((stateRank[k] ?? 0) > (stateRank[state] ?? 0)) state = k;
  }
  await tx.dispatch.update({
    where: { id: d.id },
    data: {
      state,
      sentAt: facts.SENT,
      deliveredAt: facts.DELIVERED,
      readAt: facts.READ,
    },
  });
}

export async function event(
  db: PrismaClient,
  cfg: Config,
  connectionId: string,
  generation: number,
  e: ChannelUpdate,
) {
  if (e.kind === "state") {
    const image = e.qr
      ? await QRCode.toDataURL(e.qr, {
          margin: 2,
          width: 280,
          errorCorrectionLevel: "M",
        })
      : null;
    return transact(db, async (tx) => {
      const current = await tx.connection.findFirst({
        where: { id: connectionId, generation, desired: "ON" },
      });
      if (!current) return;
      const duplicate = e.phone
        ? await tx.connection.findFirst({
            where: { accountPhone: e.phone, id: { not: connectionId } },
          })
        : null;
      const state = duplicate ? "ERROR" : e.state;
      const code = duplicate ? "DUPLICATE_ACCOUNT" : (e.code ?? null);
      const stop = ["EXPIRED", "ERROR"].includes(state);
      await tx.connection.update({
        where: { id: connectionId },
        data: {
          state,
          desired: stop ? "OFF" : undefined,
          lastError: code,
          lastSeen: new Date(),
          accountPhone:
            state === "EXPIRED" ? null : duplicate ? undefined : e.phone,
          qr: image
            ? encrypt(cfg.APP_ENCRYPTION_KEY, image, "qr:" + connectionId)
            : null,
          qrExpiresAt: image ? new Date(Date.now() + 45000) : null,
        },
      });
      if (state === "EXPIRED" || duplicate)
        await tx.authEntry.deleteMany({ where: { connectionId } });
      if ((current.state === "READY" && state !== "READY") || stop)
        await tx.campaign.updateMany({
          where: { connectionId, state: { in: ["RUNNING", "SCHEDULED"] } },
          data: { state: "PAUSED" },
        });
      if (current.state !== state || current.lastError !== code)
        await audit(
          tx,
          "worker",
          "CONNECTION_" + state,
          "connection",
          connectionId,
          code ?? undefined,
        );
    });
  }
  return transact(db, async (tx) => {
    const conn = await tx.connection.findFirst({
      where: { id: connectionId, generation, desired: "ON" },
    });
    if (!conn) return;
    if (e.kind === "receipt") {
      await tx.channelEvent.createMany({
        data: {
          connectionId,
          key: "receipt:" + digest(e.id + ":" + e.receipt),
          kind: e.receipt,
          providerId: e.id,
          occurredAt: e.at,
        },
        skipDuplicates: true,
      });
      await applyReceipts(tx, connectionId, e.id);
      return;
    }
    const contact = e.phone
      ? await tx.contact.findUnique({ where: { phone: e.phone } })
      : null;
    const key = digest(e.address + ":" + e.id);
    const created = await tx.channelEvent.createMany({
      data: {
        connectionId,
        key: "in:" + key,
        kind: "INBOUND",
        providerId: e.id,
        occurredAt: e.at,
        phone: e.phone,
        address: e.address,
        contactId: contact?.id,
        text: e.text,
        contentType: e.contentType ?? (e.text ? "TEXT" : undefined),
      },
      skipDuplicates: true,
    });
    if (!created.count) return;
    if (e.phone) {
      const mapped = await tx.channelEvent.updateMany({
        where: { connectionId, address: e.address, kind: "OPT_OUT_UNRESOLVED" },
        data: { kind: "OPT_OUT", phone: e.phone, contactId: contact?.id },
      });
      if (mapped.count) {
        await suppress(tx, cfg.APP_ENCRYPTION_KEY, e.phone, "INBOUND_OPT_OUT");
        await audit(
          tx,
          "worker",
          "OPT_OUT_IDENTITY_RESOLVED",
          "connection",
          connectionId,
        );
        if (
          !(await tx.channelEvent.count({
            where: { connectionId, kind: "OPT_OUT_UNRESOLVED" },
          }))
        )
          await tx.connection.updateMany({
            where: {
              id: connectionId,
              lastError: "OPT_OUT_IDENTITY_UNRESOLVED",
            },
            data: { lastError: null },
          });
      }
    }
    if (
      !e.text ||
      (e.contentType && e.contentType !== "TEXT") ||
      !isOptOut(e.text)
    )
      return;
    const suppressed = e.phone
      ? await suppress(tx, cfg.APP_ENCRYPTION_KEY, e.phone, "INBOUND_OPT_OUT")
      : null;
    const addressFp = fingerprint(cfg.APP_ENCRYPTION_KEY, "jid:" + e.address);
    const addressSupp = await tx.suppression.createMany({
      data: { fingerprint: addressFp, reason: "INBOUND_OPT_OUT" },
      skipDuplicates: true,
    });
    const first =
      (suppressed?.inserted ?? addressSupp.count === 1) &&
      addressSupp.count === 1;
    if (!e.phone && first) {
      await tx.connection.update({
        where: { id: connectionId },
        data: { lastError: "OPT_OUT_IDENTITY_UNRESOLVED" },
      });
      await tx.campaign.updateMany({
        where: { state: { in: ["SCHEDULED", "RUNNING"] } },
        data: { state: "PAUSED" },
      });
      await audit(
        tx,
        "worker",
        "OPT_OUT_REVIEW_REQUIRED",
        "connection",
        connectionId,
        "OPT_OUT_IDENTITY_UNRESOLVED",
      );
    }
    const kind = first
      ? e.phone
        ? "OPT_OUT"
        : "OPT_OUT_UNRESOLVED"
      : "OPT_OUT_REPEATED";
    await tx.channelEvent.create({
      data: {
        connectionId,
        key: "opt:" + key,
        kind,
        providerId: e.id,
        occurredAt: e.at,
        phone: e.phone,
        address: e.address,
        contactId: contact?.id,
      },
    });
    await audit(tx, "worker", kind, "contact", contact?.id ?? connectionId);
    if (first)
      await tx.dispatch.createMany({
        data: {
          uniqueKey: "optout:" + connectionId + ":" + key,
          connectionId,
          contactId: contact?.id,
          kind: "OPT_OUT",
          phone: e.phone,
          address: e.address,
          body: confirmation,
        },
        skipDuplicates: true,
      });
  });
}
