import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { z } from "zod";
import { audit, phone, transact } from "@hub/core";
import { db, fail, missing, read } from "./runtime.js";
import { contactInput } from "./contacts.js";
import { inflateRawSync } from "node:zlib";

const limit = 500;
const maxZip = 12 * 1024 * 1024;
function verifyZip(buf: Buffer) {
  const marker = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const end = buf.lastIndexOf(marker);
  if (end < 0 || end + 22 !== buf.length) throw new Error();
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16),
    size = 0;
  if (
    count > 100 ||
    buf.readUInt16LE(end + 4) !== 0 ||
    buf.readUInt16LE(end + 6) !== 0 ||
    buf.readUInt16LE(end + 8) !== count
  )
    throw new Error();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error();
    const method = buf.readUInt16LE(p + 10),
      compressed = buf.readUInt32LE(p + 20),
      plain = buf.readUInt32LE(p + 24),
      lp = buf.readUInt32LE(p + 42);
    if (
      buf.readUInt32LE(lp) !== 0x04034b50 ||
      buf.readUInt16LE(p + 8) & 1 ||
      ![0, 8].includes(method)
    )
      throw new Error();
    size += plain;
    if (size > maxZip) throw new Error();
    const start =
      lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28);
    if (start + compressed > p) throw new Error();
    if (
      method === 0
        ? compressed !== plain
        : inflateRawSync(buf.subarray(start, start + compressed), {
            maxOutputLength: Math.max(1, plain),
          }).length !== plain
    )
      throw new Error();
    p +=
      46 +
      buf.readUInt16LE(p + 28) +
      buf.readUInt16LE(p + 30) +
      buf.readUInt16LE(p + 32);
  }
  if (p !== end) throw new Error();
}
export const upload = z.object({
  filename: z.string().min(1).max(160),
  data: z.base64().max(2_800_000),
  phoneColumn: z.number().int().min(1).max(50).default(1),
  nameColumn: z.number().int().min(0).max(50).default(2),
});
type Row = {
  row: number;
  phone?: string;
  name?: string;
  status: "valid" | "invalid" | "duplicate";
};
export async function previewImport(value: unknown, actor: string) {
  const input = read(upload, value);
  const buffer = Buffer.from(input.data, "base64");
  let records: unknown[][];
  try {
    if (/\.csv$/i.test(input.filename)) {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      const first = decoded.split(/\r?\n/, 1)[0];
      records = parse(decoded, {
        delimiter: first.includes(";") ? ";" : ",",
        bom: true,
        relax_column_count: true,
        skip_empty_lines: false,
        max_record_size: 8192,
        to: limit + 2,
      });
    } else if (/\.xlsx$/i.test(input.filename)) {
      verifyZip(buffer);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(Uint8Array.from(buffer).buffer);
      const sheet = book.worksheets[0];
      if (!sheet || sheet.rowCount > limit + 1 || sheet.columnCount > 50)
        throw new Error();
      records = Array.from({ length: sheet.rowCount }, (_, i) =>
        Array.from(
          { length: sheet.columnCount },
          (_, j) => sheet.getRow(i + 1).getCell(j + 1).value,
        ),
      );
    } else throw new Error();
  } catch {
    fail(
      "IMPORT_SCHEMA_INVALID",
      "Use um CSV UTF-8 ou XLSX válido, com até 500 linhas e 50 colunas.",
    );
  }
  if (
    records.length < 2 ||
    records.length > limit + 1 ||
    records.some((r) => r.length > 50) ||
    input.phoneColumn > records[0].length ||
    input.nameColumn > records[0].length
  )
    fail(
      "IMPORT_SCHEMA_INVALID",
      "Confira o mapeamento e mantenha entre 1 e 500 registros.",
    );
  const safe = (x: unknown) =>
    typeof x === "string" || (typeof x === "number" && Number.isSafeInteger(x))
      ? String(x).trim()
      : "";
  const rows: Row[] = records.slice(1).map((r, i) => {
    const n = phone(safe(r[input.phoneColumn - 1])),
      name = safe(r[input.nameColumn - 1]);
    return n && name.length <= 160
      ? { row: i + 2, phone: n, name, status: "valid" }
      : { row: i + 2, status: "invalid" };
  });
  const same = new Set(
    (
      await db.contact.findMany({
        where: {
          phone: { in: rows.flatMap((r) => (r.phone ? [r.phone] : [])) },
        },
        select: { phone: true },
      })
    ).map((r) => r.phone),
  );
  for (const row of rows)
    if (row.phone) {
      if (same.has(row.phone)) row.status = "duplicate";
      else same.add(row.phone);
    }
  const batch = await db.importBatch.create({
    data: {
      filename: input.filename.replace(/^.*[\\/]/, ""),
      actor,
      rows,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return {
    id: batch.id,
    columns: records[0].map(safe),
    rows,
    valid: rows.filter((r) => r.status === "valid").length,
  };
}
export async function commitImport(batchId: string, actor: string) {
  return transact(db, async (tx) => {
    const batch = await tx.importBatch.findFirst({
      where: {
        id: batchId,
        actor,
        expiresAt: { gt: new Date() },
        committedAt: null,
      },
    });
    if (!batch) missing();
    const rows = (batch.rows as Row[]).filter((r) => r.status === "valid");
    const data = rows.map((r) =>
      contactInput.parse({ phone: r.phone, name: r.name }),
    );
    const { count } = await tx.contact.createMany({
      data,
      skipDuplicates: true,
    });
    await tx.importBatch.update({
      where: { id: batch.id },
      data: {
        committedAt: new Date(),
        rows: [],
        expiresAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    await audit(
      tx,
      actor,
      "IMPORT_COMMITTED",
      "import",
      batchId,
      String(count),
    );
    return { created: count, ignored: (batch.rows as Row[]).length - count };
  });
}
