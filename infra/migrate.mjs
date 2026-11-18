import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { env } from "../packages/core/dist/index.js";
const c = env();
const db = new URL(c.DATABASE_URL);
const local =
  c.HUB_MODE === "local" &&
  ["127.0.0.1", "localhost", "[::1]", "postgres"].includes(db.hostname);
if (!local && process.env.HUB_BACKUP_CONFIRMED !== "true") {
  console.error(
    "Confirme o backup verificado do banco antes da migração remota (HUB_BACKUP_CONFIRMED=true).",
  );
  process.exit(1);
}
try {
  execFileSync(
    process.execPath,
    [
      resolve("packages/core/node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
    ],
    {
      cwd: resolve("packages/core"),
      env: { ...process.env, DATABASE_URL: c.DATABASE_URL },
      stdio: local ? "inherit" : "pipe",
    },
  );
  if (!local)
    console.log("Migração versionada concluída no schema configurado.");
} catch {
  console.error(
    "Falha na migração. Revise disponibilidade, permissões do schema e histórico de migrações.",
  );
  process.exit(1);
}
