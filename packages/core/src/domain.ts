import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  createHash,
} from "node:crypto";
import { z } from "zod";

export const attrSchema = z
  .record(
    z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,39}$/)
      .refine(
        (k) => !["constructor", "prototype", "nome", "telefone"].includes(k),
      ),
    z.string().max(500),
  )
  .refine((x) => Object.keys(x).length <= 25);
export function phone(value: string) {
  let v = value.trim();
  if (!/^\+?[\d\s().-]{8,30}$/.test(v)) return null;
  const digits = v.replace(/\D/g, "");
  if (!v.startsWith("+") && digits.length >= 12 && digits.startsWith("55"))
    v = "+" + digits;
  const p = parsePhoneNumberFromString(v, {
    defaultCountry: "BR",
    extract: false,
  });
  return p?.isValid() ? p.number : null;
}
export function render(
  body: string,
  contact: { name: string; phone: string | null; attributes: unknown },
) {
  const data = {
    ...attrSchema.safeParse(contact.attributes).data,
    nome: contact.name,
    telefone: contact.phone ?? "",
  };
  const missing = new Set<string>();
  const residue = body.replace(/\{\{\s*[a-z][a-z0-9_]{0,39}\s*\}\}/g, "");
  if (residue.includes("{{") || residue.includes("}}"))
    missing.add("sintaxe inválida");
  const text = body.replace(
    /\{\{\s*([a-z][a-z0-9_]{0,39})\s*\}\}/g,
    (_, key: string) => {
      const val = Object.hasOwn(data, key)
        ? (data as Record<string, string>)[key]
        : "";
      if (!val?.trim()) missing.add(key);
      return val ?? "";
    },
  );
  if (!text.trim() || text.length > 4096) missing.add("tamanho inválido");
  return { text, missing: [...missing] };
}
export function isOptOut(text: string) {
  return /^(SAIR|PARAR|CANCELAR|DESCADASTRAR)[.!]?$/.test(
    text.trim().normalize("NFKC").toUpperCase(),
  );
}
export const marketingFooter =
  "\n\nPara deixar de receber mensagens promocionais, responda SAIR.";
export const confirmation =
  "Seu pedido foi registrado. Você não receberá novas mensagens promocionais deste número.";
export const digest = (data: string) =>
  createHash("sha256").update(data).digest("hex");
export const fingerprint = (key: string, number: string) =>
  createHmac("sha256", Buffer.from(key, "hex"))
    .update("suppression:" + number)
    .digest("hex");
export function encrypt(key: string, value: string, aad: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  c.setAAD(Buffer.from(aad));
  return Buffer.concat([
    iv,
    c.update(value, "utf8"),
    c.final(),
    c.getAuthTag(),
  ]).toString("base64url");
}
export function decrypt(key: string, value: string, aad: string) {
  const b = Buffer.from(value, "base64url");
  const c = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    b.subarray(0, 12),
  );
  c.setAAD(Buffer.from(aad));
  c.setAuthTag(b.subarray(-16));
  return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString(
    "utf8",
  );
}
export function windowOpen(
  time: Date,
  c: { timezone: string; windowStart: number; windowEnd: number },
) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: c.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(time);
  const now =
    Number(parts.find((p) => p.type === "hour")?.value) * 60 +
    Number(parts.find((p) => p.type === "minute")?.value);
  return c.windowStart <= now && now < c.windowEnd;
}
export function nextWindow(
  now: Date,
  c: { timezone: string; windowStart: number; windowEnd: number },
) {
  if (windowOpen(now, c)) return now;
  for (let minute = 1; minute <= 2880; minute++) {
    const time = new Date(
      Math.floor(now.getTime() / 60000) * 60000 + minute * 60000,
    );
    if (windowOpen(time, c)) return time;
  }
  throw new Error("OUTSIDE_ALLOWED_WINDOW");
}
export const terminal = [
  "SUBMITTED",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
  "UNKNOWN",
  "CANCELLED",
  "SUPPRESSED",
];
export const allowed = {
  approve: ["DRAFT"],
  activate: ["READY"],
  pause: ["RUNNING", "SCHEDULED"],
  resume: ["PAUSED"],
  cancel: ["DRAFT", "READY", "SCHEDULED", "RUNNING", "PAUSED"],
} as const;
export const stateRank: Record<string, number> = {
  PENDING: 0,
  DISPATCHING: 1,
  UNKNOWN: 1,
  FAILED: 1,
  SUBMITTED: 2,
  SENT: 3,
  DELIVERED: 4,
  READ: 5,
};
