import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
} from "@nestjs/common";
import type { ExecutionContext, CanActivate } from "@nestjs/common";
import {
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response } from "express";
import { db, cfg } from "./runtime.js";
import { audit, transact } from "@hub/core";

const scrypt = promisify(scryptCb);
const cookie = cfg.PUBLIC_ORIGIN.startsWith("https:")
  ? "__Host-hub"
  : "hub_local";
const cookieOptions = {
  httpOnly: true,
  secure: cfg.PUBLIC_ORIGIN.startsWith("https:"),
  sameSite: "strict" as const,
  path: "/",
};
const TTL = 8 * 3600 * 1000;
const sign = (value: string) =>
  createHmac("sha256", cfg.JWT_SECRET).update(value).digest("hex");
const hash = async (password: string, salt: string) =>
  (await scrypt(password, salt, 64)) as Buffer;
const nullSalt = "unregistered-user-hub-salt";
export type OperatorRequest = Request & {
  operator: { id: string; email: string };
  sessionId: string;
};
export function verifyOrigin(req: Request) {
  if (req.get("origin") !== cfg.PUBLIC_ORIGIN)
    throw new ForbiddenException({
      code: "ORIGIN_INVALID",
      message: "Origem da solicitação inválida.",
    });
}
export async function bootstrapAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = cfg;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  const email = ADMIN_EMAIL.toLowerCase();
  if (await db.admin.count()) return;
  const salt = randomBytes(32).toString("hex"),
    derived = await hash(ADMIN_PASSWORD, salt);
  await transact(db, async (tx) => {
    if (await tx.admin.count()) return;
    const a = await tx.admin.create({
      data: { email, hash: salt + ":" + derived.toString("hex") },
    });
    await audit(tx, "system", "ADMIN_CREATED", "admin", a.id);
  });
}
let activeHashes = 0;
const attempts = new Map<string, { until: number; count: number }>();
function throttle(key: string) {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
  const v = attempts.get(key) ?? { until: now + 10 * 60000, count: 0 };
  if (v.count >= 12 || attempts.size >= 1000 || activeHashes >= 4)
    throw new HttpException(
      {
        code: "RATE_LIMITED",
        message: "Muitas tentativas. Aguarde alguns minutos.",
      },
      429,
    );
  v.count++;
  attempts.set(key, v);
}
export async function login(
  req: Request,
  res: Response,
  email: string,
  password: string,
) {
  verifyOrigin(req);
  throttle(req.ip ?? "unknown");
  activeHashes++;
  try {
    const admin = await db.admin.findUnique({
      where: { email: email.toLowerCase() },
    });
    const [salt, stored] = admin?.hash.split(":") ?? [
      nullSalt,
      "00".repeat(64),
    ];
    const computed = await hash(password, salt);
    const equal = timingSafeEqual(computed, Buffer.from(stored, "hex"));
    if (!admin || !equal)
      throw new UnauthorizedException({
        code: "LOGIN_INVALID",
        message: "E-mail ou senha inválidos.",
      });
    const token = randomBytes(32).toString("base64url"),
      id = sign(token);
    await db.$transaction(async (tx) => {
      await tx.session.deleteMany({
        where: {
          OR: [
            { expiresAt: { lte: new Date() } },
            ...(typeof req.cookies?.[cookie] === "string"
              ? [{ id: sign(req.cookies[cookie]) }]
              : []),
          ],
        },
      });
      await tx.session.create({
        data: { id, adminId: admin.id, expiresAt: new Date(Date.now() + TTL) },
      });
      await audit(tx, admin.id, "LOGIN", "admin", admin.id);
    });
    res.cookie(cookie, token, { ...cookieOptions, maxAge: TTL });
    return { email: admin.email };
  } finally {
    activeHashes--;
  }
}
export async function logout(req: OperatorRequest, res: Response) {
  await db.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { id: req.sessionId } });
    await audit(tx, req.operator.id, "LOGOUT", "admin", req.operator.id);
  });
  res.clearCookie(cookie, cookieOptions);
  return { ok: true };
}
@Injectable()
export class AdminGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<OperatorRequest>();
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) verifyOrigin(req);
    const token = req.cookies?.[cookie];
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException({
        code: "SESSION_REQUIRED",
        message: "Entre para continuar.",
      });
    const session = await db.session.findUnique({
      where: { id: sign(token) },
      include: { admin: { select: { id: true, email: true } } },
    });
    if (!session || session.expiresAt <= new Date())
      throw new UnauthorizedException({
        code: "SESSION_REQUIRED",
        message: "Sua sessão expirou.",
      });
    req.operator = session.admin;
    req.sessionId = session.id;
    return true;
  }
}
