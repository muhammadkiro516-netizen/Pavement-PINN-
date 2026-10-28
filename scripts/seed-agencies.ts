/**
 * Creates one Koordinator and one Pengawas Lapangan for each pilot agency (DKI Jakarta and
 * Kabupaten Karawang, config/authorities/pilot.json). Idempotent: existing emails are skipped.
 * New passwords are printed once and written to .data/pilot-accounts.txt (not committed).
 *
 *   npx tsx scripts/seed-agencies.ts
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AccountError, AccountStore } from "../server/repositories/accountStore";
import { loadServerConfig } from "../server/config/env";
import { AGENCIES } from "../server/services/authorityResolver";

const PILOT = ["dbm-dki", "sudin-bm-jaktim", "bbpjn-jabar-dki", "dbmpr-jabar", "dpupr-karawang"];
const SHORT: Record<string, string> = {
  "dbm-dki": "Dinas Bina Marga DKI",
  "sudin-bm-jaktim": "Sudin Bina Marga Jakarta Timur",
  "bbpjn-jabar-dki": "BBPJN Jabar-DKI",
  "dbmpr-jabar": "DBMPR Jawa Barat",
  "dpupr-karawang": "Dinas PUPR Kab. Karawang"
};

const dataDir = loadServerConfig().dataDir;
const store = new AccountStore(path.join(dataDir, "accounts.json"));
const lines: string[] = [];
for (const id of PILOT) {
  const agency = AGENCIES.find((a) => a.id === id);
  if (!agency) continue;
  for (const [role, prefix, title] of [
    ["OPERATIONS_MANAGER", "koordinator", "Koordinator"],
    ["FIELD_ENGINEER", "pengawas", "Pengawas Lapangan"]
  ] as const) {
    const email = `${prefix}.${id}@pavement-pinn.id`;
    const password = `Pinn-${randomBytes(4).toString("hex")}`;
    try {
      store.create({ email, name: `${title} · ${SHORT[id]}`, password, role, agency: agency.name, agencyId: id });
      lines.push(`${title.padEnd(18)} ${agency.name}\n  ${email}  /  ${password}`);
    } catch (error) {
      if (!(error instanceof AccountError && error.code === "CONFLICT")) throw error;
    }
  }
}
if (lines.length) {
  const out = path.join(dataDir, "pilot-accounts.txt");
  fs.appendFileSync(out, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  console.log(`\nSaved to ${out}`);
} else {
  console.log("All pilot accounts already exist.");
}
