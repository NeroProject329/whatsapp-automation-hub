import { z } from "zod";
import { audit, decrypt, transact } from "@hub/core";
import { cfg, db, read, missing, conflict } from "./runtime.js";
const safe = {
  id: true,
  label: true,
  provider: true,
  state: true,
  lastError: true,
  lastSeen: true,
  desired: true,
  accountPhone: true,
  qrExpiresAt: true,
} as const;
export const connectionInput = z.object({
  label: z.string().trim().min(2).max(80),
});
export const listConnections = () =>
  db.connection.findMany({ select: safe, orderBy: { createdAt: "desc" } });
export async function detailConnection(id: string) {
  const c = await db.connection.findUnique({
    where: { id },
    select: { ...safe, qr: true },
  });
  if (!c) missing();
  return {
    ...c,
    qr:
      c.state === "QR" && c.qr && c.qrExpiresAt && c.qrExpiresAt > new Date()
        ? decrypt(cfg.APP_ENCRYPTION_KEY, c.qr, "qr:" + id)
        : null,
  };
}
export async function createConnection(value: unknown, actor: string) {
  const { label } = read(connectionInput, value);
  return transact(db, async (tx) => {
    if ((await tx.connection.count()) >= 10)
      conflict("CONNECTION_LIMIT", "Limite local de dez conexões.");
    const c = await tx.connection.create({
      data: { label, provider: cfg.PROVIDER },
      select: safe,
    });
    await audit(tx, actor, "CONNECTION_CREATED", "connection", c.id);
    return c;
  });
}
export async function command(id: string, command: string, actor: string) {
  const action = read(z.enum(["connect", "disconnect", "revoke"]), command);
  return transact(db, async (tx) => {
    const c = await tx.connection.findUnique({ where: { id } });
    if (!c) missing();
    if (c.desired === "REVOKE")
      conflict("CONNECTION_BUSY", "A desvinculação está em andamento.");
    if (action === "connect" && c.provider !== cfg.PROVIDER)
      conflict("PROVIDER_CHANGED", "A conexão pertence a outro modo.");
    if (action !== "connect")
      await tx.campaign.updateMany({
        where: { connectionId: id, state: { in: ["SCHEDULED", "RUNNING"] } },
        data: { state: "PAUSED" },
      });
    const result = await tx.connection.update({
      where: { id },
      data: {
        desired:
          action === "connect" ? "ON" : action === "revoke" ? "REVOKE" : "OFF",
        state: action === "connect" ? "CONNECTING" : "OFFLINE",
        generation: { increment: 1 },
        qr: null,
        qrExpiresAt: null,
      },
      select: safe,
    });
    await audit(
      tx,
      actor,
      "CONNECTION_" + action.toUpperCase(),
      "connection",
      id,
    );
    return result;
  });
}
