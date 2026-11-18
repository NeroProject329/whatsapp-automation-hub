import { PrismaClient } from "./generated/index.js";
import type { Prisma } from "./generated/index.js";
import { fingerprint } from "./domain.js";
export type Tx = Prisma.TransactionClient;
export function transact<T>(db: PrismaClient, fn: (tx: Tx) => Promise<T>) {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS held FROM pg_advisory_xact_lock(hashtextextended(current_schema() || ':hub-mutations',0))`;
      return fn(tx);
    },
    { maxWait: 8000, timeout: 20000 },
  );
}
export function audit(
  tx: Tx,
  actor: string,
  action: string,
  entity: string,
  entityId: string,
  code?: string,
) {
  return tx.audit.create({ data: { actor, action, entity, entityId, code } });
}
export async function suppress(
  tx: Tx,
  key: string,
  number: string,
  reason: string,
) {
  const fp = fingerprint(key, number);
  const inserted = await tx.suppression.createMany({
    data: { fingerprint: fp, reason },
    skipDuplicates: true,
  });
  const contact = await tx.contact.findUnique({ where: { phone: number } });
  if (contact) {
    await tx.consent.updateMany({
      where: { contactId: contact.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.dispatch.updateMany({
      where: { contactId: contact.id, state: "PENDING" },
      data: { state: "SUPPRESSED", code: reason },
    });
  }
  return { contact, inserted: inserted.count === 1 };
}
