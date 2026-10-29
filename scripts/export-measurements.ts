/**
 * SPEC M10: export pilot evidence from the real data store (.data) into measurements/*.json:
 *   field_accuracy.json  AI accepted by field engineers (per class), auto-pass share
 *   pilot.json           real reports, unique reporting devices, verified, repairs and their life
 *   sus.json             in-app SUS questionnaire (n, mean, per role)
 * Run: npx tsx scripts/export-measurements.ts
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { FileCaseStore } from "../server/repositories/fileCaseStore";
import { loadServerConfig } from "../server/config/env";
import { impactStats } from "../src/domain/workflow/impactStats";
import { recurrence, repairLives, statsByMethod } from "../src/domain/roads/recurrence";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "measurements");
const store = new FileCaseStore(loadServerConfig().dataDir);
const snap = await store.load();
const real = snap.cases.filter((c) => c.dataStatus !== "SYNTHETIC" && c.dataStatus !== "PUBLIC_ARCHIVE");
let commit: string | null = null;
try {
  commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch {
  /* not a git checkout */
}
const meta = { measuredAt: new Date().toISOString(), commit, label: "TERUKUR", source: "data pilot nyata (.data), tanpa data contoh" };
const write = (name: string, body: object) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify({ ...meta, ...body }, null, 2));
};

const s = impactStats(real);
write("field_accuracy.json", {
  reportsScreenedByAi: s.aiScreened,
  autoPassed: s.aiAutoPassed,
  fieldReviewed: s.fieldReviewed,
  fieldAccepted: s.fieldAccepted,
  fieldAccuracyPct: s.fieldReviewed ? Math.round((s.fieldAccepted / s.fieldReviewed) * 1000) / 10 : null,
  perClass: s.perClass,
  overrides: s.overrides
});

const lives = repairLives(real, snap.repairConfirmations ?? []);
const reporters = new Set(real.filter((c) => c.createdBy.role === "PUBLIC_REPORTER").map((c) => c.createdBy.id));
write("pilot.json", {
  reports: real.length,
  uniqueReportingAccounts: reporters.size,
  verified: s.total - real.filter((c) => c.state === "NEEDS_REVIEW").length,
  resolved: s.resolved,
  medianDaysToResolve: s.medianDaysToResolve,
  witnesses: (snap.witnesses ?? []).length,
  repairConfirmations: (snap.repairConfirmations ?? []).length,
  repairs: lives.length,
  recurrence3m: recurrence(lives, 3),
  byMethod: statsByMethod(lives)
});

const sus = (snap.sus ?? []) as Array<{ score?: number; role?: string }>;
const scores = sus.map((r) => Number(r.score)).filter(Number.isFinite);
const byRole: Record<string, number[]> = {};
for (const r of sus) (byRole[r.role ?? "?"] ??= []).push(Number(r.score));
write("sus.json", {
  n: scores.length,
  mean: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
  byRole: Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, { n: v.length, mean: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 }])),
  note: "SUS 0-100; > 68 di atas rata-rata (Sauro 2011). Kosong sampai pengguna nyata mengisi."
});
console.log(`field_accuracy: ${s.fieldReviewed} reviewed; pilot: ${real.length} reports; sus: ${scores.length} answers`);
