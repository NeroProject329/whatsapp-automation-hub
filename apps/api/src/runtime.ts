import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { env, PrismaClient, redis } from "@hub/core";
export const cfg = env();
export const db = new PrismaClient({ datasourceUrl: cfg.DATABASE_URL });
export const cache = redis(cfg);
export const id = z.uuid();
export function read<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    fail(
      "REQUEST_INVALID",
      "Confira os campos informados.",
      parsed.error.issues.map((x) => ({
        field: x.path.join("."),
        message: x.message,
      })),
    );
  return parsed.data;
}
export function fail(code: string, message: string, details?: unknown): never {
  throw new BadRequestException({ code, message, details });
}
export function conflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}
export function missing(): never {
  throw new NotFoundException({
    code: "NOT_FOUND",
    message: "Registro não encontrado.",
  });
}
