/**
 * Imports real Indonesian road-damage photos from Wikimedia Commons as reports by the system
 * account "Arsip Foto Publik · Wikimedia Commons", through the real path of a running server:
 * CV job on the actual photo -> report submission (screening, authority routing, audit).
 * Only photos whose location is stated by the source are imported; the location precision is
 * written in the report. Idempotent: a photo whose hash was imported before is skipped.
 *
 *   npx tsx scripts/import-public-photos.ts http://localhost:3100
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AccountStore } from "../server/repositories/accountStore";
import { loadServerConfig } from "../server/config/env";
import { photoGpsPosition } from "../server/services/photoValidation";

const BASE = process.argv[2] ?? "http://localhost:3100";
const ROOT = process.cwd();
const CREDITS: Array<{ file: string; title: string; author: string; license: string; source: string }> = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/data/photoCredits.json"), "utf8")
);

/** Where each photo was taken, as stated by its Commons page. */
const PLACES: Record<string, { coords: [number, number]; place: string; precision: string; note: string; segmentId: string }> = {
  "photos/ubud-bali.jpg": {
    coords: [-8.50735, 115.26351], place: "Jalan Raya Ubud (depan pasar), Gianyar, Bali", precision: "koordinat dari Commons",
    note: "Lubang muncul di depan pasar Ubud lalu jalan ambles; terdengar aliran air di bawahnya (keterangan fotografer, Juli 2009).",
    segmentId: "BALI-DENPASAR-GILIMANUK"
  },
  "photos/perbaikan-kebumen.jpg": {
    coords: [-7.6725, 109.6563], place: "Jl. Kaswari, Kebumen, Jawa Tengah", precision: "setingkat jalan (dari nama jalan pada keterangan foto)",
    note: "Lubang di jalan aspal sedang diperbaiki PUPR Kab. Kebumen (keterangan fotografer, April 2023).",
    segmentId: "TRANS-JAVA-KM208"
  },
  "photos/rambu-kebumen.jpg": {
    coords: [-7.7733, 109.7194], place: "Kecamatan Ambal, Kebumen, Jawa Tengah", precision: "setingkat kecamatan",
    note: "Rambu 'Hati-hati banyak jalan berlubang' dipasang warga/pemerintah di Ambal (keterangan fotografer, Mei 2023).",
    segmentId: "TRANS-JAVA-KM208"
  }
};

const ARCHIVE_EMAIL = "arsip-commons@pavement-pinn.id";

async function main() {
  const store = new AccountStore(path.join(loadServerConfig().dataDir, "accounts.json"));
  const pwFile = path.join(loadServerConfig().dataDir, "archive-account.txt");
  let password = fs.existsSync(pwFile) ? fs.readFileSync(pwFile, "utf8").trim() : "";
  if (!store.verify(ARCHIVE_EMAIL, password)) {
    password = `Arsip-${randomBytes(6).toString("hex")}`;
    if (!store.list().some((a) => a.email === ARCHIVE_EMAIL)) {
      store.create({ email: ARCHIVE_EMAIL, name: "Arsip Foto Publik · Wikimedia Commons", password, role: "PUBLIC_REPORTER" });
      fs.writeFileSync(pwFile, password);
    } else {
      throw new Error(`${ARCHIVE_EMAIL} exists but its password is not in ${pwFile}`);
    }
  }
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: ARCHIVE_EMAIL, password }) });
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!login.ok) throw new Error(`login failed: ${login.status}`);

  const existing = await (await fetch(`${BASE}/api/workflow/reports?limit=500`, { headers: { cookie } })).json();
  const known = new Set<string>((existing.items ?? []).map((v: any) => v.case?.report?.description ?? "").filter((d: string) => d.includes("sha256:")).map((d: string) => d.split("sha256:")[1].slice(0, 12)));

  for (const credit of CREDITS) {
    const place = PLACES[credit.file];
    if (!place) continue;
    const bytes = fs.readFileSync(path.join(ROOT, "public", credit.file));
    // The camera's own GPS, when the photo still carries it, beats the place named in the caption.
    const gps = photoGpsPosition(`data:image/jpeg;base64,${bytes.toString("base64")}`);
    if (gps) Object.assign(place, { coords: gps, precision: "koordinat GPS kamera pada foto" });
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (known.has(sha.slice(0, 12))) {
      console.log(`skip (already imported): ${credit.file}`);
      continue;
    }
    // 1. Real CV analysis of the photo
    const job = await (await fetch(`${BASE}/api/cv/jobs`, { method: "POST", headers: { "Content-Type": "image/jpeg", cookie }, body: bytes })).json();
    if (!job.success) throw new Error(`cv job failed: ${JSON.stringify(job.error)}`);
    let analysis: any = null;
    for (let i = 0; i < 200 && !analysis; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const j = await (await fetch(`${BASE}/api/cv/jobs/${job.job.jobId}`, { headers: { cookie } })).json();
      if (j.job?.state === "done") analysis = j.job.analysis;
      if (j.job?.state === "failed") throw new Error(`cv failed: ${JSON.stringify(j.job)}`);
    }
    const primary = analysis?.primary;
    const damageType = primary?.damageType ?? "POTHOLE";
    const severity = { severe: "SEVERE", moderate: "MODERATE", minor: "LIGHT" }[analysis?.overallSeverity as string] ?? "MODERATE";
    // 2. Report through the normal submission path
    const draft = {
      reporterName: "Arsip Foto Publik · Wikimedia Commons",
      reporterRole: "Arsip publik",
      timestamp: new Date().toISOString(),
      segmentId: place.segmentId,
      segmentName: place.place,
      corridor: place.place,
      province: place.place.split(", ").pop(),
      coordinates: place.coords,
      damageType,
      damageTypeLabel: primary?.label ?? "Jalan berlubang",
      severity,
      estimatedDepthCm: 0,
      estimatedAreaM2: 0,
      photoUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
      description: `${place.note} Lokasi: ${place.place} (${place.precision}). Foto: "${credit.title}" oleh ${credit.author || "tidak diketahui"}, ${credit.license}, ${credit.source} · sha256:${sha.slice(0, 12)}`,
      upvotesCount: 0,
      cvAnalysisId: analysis?.analysisId
    };
    const res = await (await fetch(`${BASE}/api/workflow/reports`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ report: draft }) })).json();
    if (!res.success) throw new Error(`submit failed: ${JSON.stringify(res.error)}`);
    const c = res.report.case;
    console.log(`imported ${credit.file} -> ${c.id} | state ${c.state} | AI ${primary?.label ?? "-"} ${primary ? Math.round(primary.confidence * 100) + "%" : ""} | hazards ${(analysis?.hazards ?? []).join(",") || "-"} | authority ${c.authority?.name ?? "di luar wilayah pilot"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
