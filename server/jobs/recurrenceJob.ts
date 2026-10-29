import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { recurrence, repairLives, statsByMethod } from "../../src/domain/roads/recurrence";
import type { ReportCase } from "../../src/domain/workflow/model";
import type { RepairConfirmation } from "../../src/domain/roads/recurrence";

export interface RecurrenceSource {
  listCases(): Promise<ReportCase[]>;
  listRepairConfirmations(): Promise<RepairConfirmation[]>;
}

function commit(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

/** SPEC M2.2 / M10: the local-problem metric, written from recorded events only. */
export async function writeRecurrenceMeasurement(src: RecurrenceSource, file: string, now: Date = new Date()) {
  const lives = repairLives(await src.listCases(), await src.listRepairConfirmations(), now.getTime());
  const out = {
    measuredAt: now.toISOString(),
    commit: commit(),
    label: "TERUKUR",
    definition: "Perbaikan = RESOLVE terverifikasi. Berulang = laporan baru <= 10 m atau konfirmasi warga 'berlubang lagi'. Penyebut = perbaikan yang sudah teramati selama jendela penuh atau gagal di dalamnya.",
    repairs: lives.length,
    recurrence3m: recurrence(lives, 3),
    recurrence6m: recurrence(lives, 6),
    byMethod: statsByMethod(lives),
    maintenanceFlags: lives.filter((l) => l.inMaintenance).length
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  return out;
}

/** Runs once at start, then every `everyMs` (default daily). Returns a stop function. */
export function startRecurrenceJob(src: RecurrenceSource, file: string, everyMs = 86_400_000): () => void {
  const run = () => void writeRecurrenceMeasurement(src, file).catch((e) => console.warn("recurrence job:", (e as Error).message));
  run();
  const t = setInterval(run, everyMs);
  t.unref?.();
  return () => clearInterval(t);
}
