import { z } from "zod";
import { fingerprint } from "@hub/core";
import { cfg, db, id, read } from "./runtime.js";

export async function dashboard(query: unknown) {
  const filter = read(
    z.object({
      connectionId: id.optional(),
      campaignId: id.optional(),
      days: z.coerce.number().int().min(1).max(30).default(7),
    }),
    query,
  );
  const now = new Date(),
    today = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z"),
    since = new Date(+today - (filter.days - 1) * 86400000);
  const dispatchWhere = {
    ...(filter.connectionId ? { connectionId: filter.connectionId } : {}),
    ...(filter.campaignId ? { campaignId: filter.campaignId } : {}),
  };
  const [
    camps,
    connections,
    states,
    contacts,
    inbound,
    optouts,
    pace,
    worker,
    receipts,
    activeCampaigns,
    pending,
    holds,
  ] = await Promise.all([
    db.campaign.findMany({
      where: {
        ...(filter.campaignId ? { id: filter.campaignId } : {}),
        ...(filter.connectionId ? { connectionId: filter.connectionId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, state: true, scheduledAt: true },
    }),
    db.connection.groupBy({
      by: ["state"],
      _count: true,
      where: filter.connectionId ? { id: filter.connectionId } : {},
    }),
    db.dispatch.groupBy({
      by: ["state"],
      _count: true,
      where: { ...dispatchWhere, createdAt: { gte: since } },
    }),
    db.contact.findMany({
      where: {
        phone: { not: null },
        consents: { some: { revokedAt: null, purpose: "MARKETING" } },
      },
      select: { phone: true },
    }),
    db.channelEvent.count({
      where: {
        kind: "INBOUND",
        createdAt: { gte: since },
        ...(filter.connectionId ? { connectionId: filter.connectionId } : {}),
      },
    }),
    db.channelEvent.count({
      where: {
        kind: { in: ["OPT_OUT", "OPT_OUT_UNRESOLVED"] },
        createdAt: { gte: since },
        ...(filter.connectionId ? { connectionId: filter.connectionId } : {}),
      },
    }),
    db.$queryRaw<
      Array<{ day: Date; accepted: number; delivered: number; failed: number }>
    >`SELECT date_trunc('day',"createdAt") AS day,
      count(*) FILTER (WHERE "submittedAt" IS NOT NULL)::int AS accepted,
      count(*) FILTER (WHERE "deliveredAt" IS NOT NULL)::int AS delivered,
      count(*) FILTER (WHERE state IN ('FAILED','UNKNOWN'))::int AS failed
      FROM "Dispatch" WHERE "createdAt" >= ${since}
      AND (${filter.connectionId ?? null}::text IS NULL OR "connectionId" = ${filter.connectionId ?? null})
      AND (${filter.campaignId ?? null}::text IS NULL OR "campaignId" = ${filter.campaignId ?? null})
      GROUP BY 1 ORDER BY 1`,
    db.runtime.findUnique({ where: { id: "worker" } }),
    db.dispatch.count({
      where: {
        ...dispatchWhere,
        createdAt: { gte: since },
        deliveredAt: { not: null },
      },
    }),
    db.campaign.count({
      where: {
        state: { in: ["SCHEDULED", "RUNNING"] },
        ...(filter.connectionId ? { connectionId: filter.connectionId } : {}),
        ...(filter.campaignId ? { id: filter.campaignId } : {}),
      },
    }),
    db.dispatch.count({
      where: { ...dispatchWhere, state: { in: ["PENDING", "DISPATCHING"] } },
    }),
    db.channelEvent.count({ where: { kind: "OPT_OUT_UNRESOLVED" } }),
  ]);
  const suppressed = contacts.length
    ? await db.suppression.count({
        where: {
          fingerprint: {
            in: contacts.map((c) =>
              fingerprint(cfg.APP_ENCRYPTION_KEY, c.phone!),
            ),
          },
        },
      })
    : 0;
  return {
    campaigns: camps,
    connections: Object.fromEntries(
      connections.map((s) => [s.state, s._count]),
    ),
    states: Object.fromEntries(states.map((s) => [s.state, s._count])),
    eligible: contacts.length - suppressed,
    inbound,
    optouts,
    receipts,
    pace,
    activeCampaigns,
    pending,
    holds,
    workerAlive: !!worker && +now - +worker.beat < 15000,
  };
}
