/**
 * What the workspace modules and the twelve visible AI features read (docs/v6 §2.5, §3).
 * Everything is computed from recorded cases. Where a model does not exist or was never evaluated, the
 * feature says so ("NOT_MEASURED"); no output is invented. AI never changes a case state.
 */
import type { Request, Response, Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { rateLimit } from '../middleware/rateLimit';
import { weatherAt, type WeatherSummary } from '../services/weather';
import { callInference } from '../services/inferenceClient';
import { ladderStatus } from '../../src/domain/v5/escalation';
import { caseVisibleTo } from '../../src/domain/v5/stateMachine';
import { V5_STATE_LABELS, type V5Actor, type V5Case } from '../../src/domain/v5/model';
import type { V5Store } from '../v5/store';
import type { CaptureService } from '../v5/capture';
import type { Workspaces } from './workspaces';

export type AiStatus = 'REAL' | 'NOT_MEASURED' | 'NO_DATA';

export interface AiFinding {
  feature: number;
  key: string;
  title: string;
  what: string;
  benefit: string;
  status: AiStatus;
  result: string;
  confidence: number | null;
  how: string;
  decision: { decision: string; reason: string; at: string } | null;
}

export interface AiDecision {
  id: string;
  caseId: string;
  agencyId: string;
  feature: number;
  key: string;
  inputSummary: string;
  output: string;
  confidence: number | null;
  decision: 'ACCEPT' | 'EDIT' | 'REJECT';
  editedOutput: string | null;
  reason: string;
  byMemberId: string;
  at: string;
}

/** Decisions are also the training data: every correction by a person is kept (§3). */
export class AiDecisionLog {
  private readonly file: string;
  private rows: AiDecision[] = [];

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'ai-decisions.json');
    if (fs.existsSync(this.file)) this.rows = JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  add(row: AiDecision): void {
    this.rows.push(row);
    fs.writeFileSync(this.file, JSON.stringify(this.rows));
  }

  forCase(caseId: string): AiDecision[] {
    return this.rows.filter((r) => r.caseId === caseId);
  }

  forAgency(agencyId: string): AiDecision[] {
    return this.rows.filter((r) => r.agencyId === agencyId);
  }
}

const DAY = 86_400_000;
const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (part: number, all: number) => (all === 0 ? null : Math.round((part / all) * 100));
const isOpen = (c: V5Case) => !!c.state && V5_STATE_LABELS[c.state].open;
const IN_REPAIR = new Set(['WORK_ORDERED', 'IN_PROGRESS', 'WORK_SUBMITTED']);
const NEW_STATES = new Set(['SUBMITTED', 'SCREENING', 'TRIAGE']);
const PLACE = (c: V5Case) => c.routing?.segmentName ?? c.publicCode;

export function todayNumbers(cases: V5Case[], slaDays: number, now: string) {
  const nowMs = Date.parse(now);
  return {
    newCases: cases.filter((c) => c.state && NEW_STATES.has(c.state)).length,
    late: cases.filter((c) => isOpen(c) && !IN_REPAIR.has(c.state!) && nowMs - Date.parse(c.createdAt) > slaDays * DAY).length,
    inRepair: cases.filter((c) => c.state && IN_REPAIR.has(c.state)).length,
    failedInWarranty: cases.filter((c) => c.warrantyFlag).length
  };
}

/** Numbers come from code; the sentence around them is fixed (§3 rule 12). */
export function briefingLines(numbers: ReturnType<typeof todayNumbers>, rain: { heavyDays: number; openHoles: number } | null): string[] {
  const lines = [`Ada ${numbers.newCases} kasus baru dan ${numbers.inRepair} sedang diperbaiki.`];
  lines.push(numbers.late > 0 ? `${numbers.late} kasus lewat tenggat dan perlu didahulukan.` : 'Tidak ada kasus yang lewat tenggat.');
  if (numbers.failedInWarranty > 0) lines.push(`${numbers.failedInWarranty} perbaikan rusak lagi dalam masa pemeliharaan.`);
  if (rain && rain.heavyDays > 0) lines.push(`Diperkirakan ${rain.heavyDays} hari hujan lebat minggu ini; ${rain.openHoles} lubang terbuka berisiko tergenang.`);
  return lines;
}

export function reportCard(cases: V5Case[], slaDays: number, firstResponse: (c: V5Case) => string | null, now: string) {
  const nowMs = Date.parse(now);
  const times = cases.flatMap((c) => {
    const at = firstResponse(c);
    return at ? [(Date.parse(at) - Date.parse(c.createdAt)) / DAY] : [];
  });
  const handled = cases.filter((c) => firstResponse(c));
  const inSla = handled.filter((c) => (Date.parse(firstResponse(c)!) - Date.parse(c.createdAt)) / DAY <= slaDays);
  const durable = (months: 3 | 6) => {
    const milestone = months === 3 ? 'M3' : 'M6';
    const rows = cases.flatMap((c) => c.followUps.filter((f) => f.milestone === milestone && f.result));
    return { checked: rows.length, stillGoodPct: pct(rows.filter((f) => f.result === 'OK').length, rows.length) };
  };
  const repaired = cases.filter((c) => c.plan?.areaCm2 && c.costRun?.fairCostIdr);
  return {
    totalCases: cases.length,
    medianResponseDays: median(times),
    withinSlaPct: pct(inSla.length, handled.length),
    durable3: durable(3),
    durable6: durable(6),
    late: cases.filter((c) => isOpen(c) && !IN_REPAIR.has(c.state!) && nowMs - Date.parse(c.createdAt) > slaDays * DAY).length,
    costPerM2Idr: median(repaired.map((c) => Number(c.costRun!.fairCostIdr.mid) / (c.plan!.areaCm2 / 10_000)).filter(Number.isFinite))
  };
}

/** Ranked by how long a repair lasts, not by speed alone (§2.5). Few samples are shown as few. */
export function rankBy(cases: V5Case[], keyOf: (c: V5Case) => string | null) {
  const groups = new Map<string, V5Case[]>();
  for (const c of cases) {
    const key = keyOf(c);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.entries()].map(([name, rows]) => {
    const checks = rows.flatMap((c) => c.followUps.filter((f) => f.result));
    const good = checks.filter((f) => f.result === 'OK').length;
    return { name, cases: rows.length, checks: checks.length, durablePct: pct(good, checks.length), failedInWarranty: rows.filter((c) => c.warrantyFlag).length };
  }).sort((a, b) => (b.durablePct ?? -1) - (a.durablePct ?? -1) || a.failedInWarranty - b.failedInWarranty);
}

/** Neutral: each row asks for clarification, and names no person. */
export function anomalies(cases: V5Case[], decisions: AiDecision[]) {
  const rows: { caseId: string; publicCode: string; kind: string; text: string }[] = [];
  for (const c of cases) {
    for (const f of c.flags.filter((x) => x.state === 'OPEN')) rows.push({ caseId: c.id, publicCode: c.publicCode, kind: 'FLAG', text: FLAG_WORD[f.code] ?? 'Perlu klarifikasi' });
    if (c.costComparison?.audit?.needsClarification) rows.push({ caseId: c.id, publicCode: c.publicCode, kind: 'COST_GAP', text: `Selisih biaya ${c.costComparison.audit.differencePct}% dari rentang wajar. Perlu klarifikasi.` });
    else if (c.costRun?.comparison && Math.abs(Number(c.costRun.comparison.diffPct)) > 20) rows.push({ caseId: c.id, publicCode: c.publicCode, kind: 'COST_GAP', text: `Selisih biaya ${Math.round(Math.abs(Number(c.costRun.comparison.diffPct)))}% dari perkiraan wajar. Perlu klarifikasi.` });
    if (c.warrantyFlag) rows.push({ caseId: c.id, publicCode: c.publicCode, kind: 'WARRANTY', text: 'Rusak lagi dalam masa pemeliharaan.' });
    const duplicate = c.evidence.length > 0 && decisions.some((d) => d.caseId === c.id && d.key === 'photo-trust' && d.decision === 'REJECT');
    if (duplicate) rows.push({ caseId: c.id, publicCode: c.publicCode, kind: 'PHOTO', text: 'Petugas menandai foto kasus ini untuk diperiksa.' });
  }
  return rows;
}

const FLAG_WORD: Record<string, string> = {
  LOW_MIX_TEMPERATURE: 'Suhu campuran tercatat di bawah batas. Perlu klarifikasi.',
  QUANTITY_DIFFERENCE: 'Jumlah material berbeda dari perkiraan. Perlu klarifikasi.',
  EARLY_FAILURE_IN_MAINTENANCE: 'Rusak lagi dalam masa pemeliharaan. Perlu klarifikasi.',
  AUDITOR_NOTE: 'Catatan auditor.'
};

interface Deps {
  workspaces: Workspaces;
  store: V5Store;
  capture: CaptureService;
  decisions: AiDecisionLog;
  actorOf: (req: Request) => V5Actor | null;
  sendFail: (res: Response, status: number, code: string, message: string, rule?: string) => unknown;
  visible: (actor: V5Actor) => V5Case[];
  caseNow: (c: V5Case) => string;
}

/** The twelve features for one case. Each says plainly whether it really ran. */
export function caseFindings(c: V5Case, deps: Pick<Deps, 'capture' | 'decisions' | 'store'>, weather: WeatherSummary | null, now: string): AiFinding[] {
  const records = c.evidence.map((e) => ({ ref: e, rec: deps.capture.get(e.id) })).filter((x) => x.rec);
  const decided = deps.decisions.forCase(c.id);
  const last = (key: string) => {
    const d = [...decided].reverse().find((x) => x.key === key);
    return d ? { decision: d.decision, reason: d.reason, at: d.at } : null;
  };
  const findings: Omit<AiFinding, 'decision'>[] = [];

  const detections = records.flatMap((x) => x.rec!.ai.detections);
  const best = [...detections].sort((a, b) => b.confidence - a.confidence)[0];
  const aiRan = records.some((x) => x.rec!.ai.status === 'REAL');
  findings.push({
    feature: 1, key: 'detection', title: 'Deteksi kerusakan',
    what: 'AI mengenali jenis kerusakan dari foto warga.',
    benefit: 'Laporan langsung jelas tanpa isi formulir.',
    status: aiRan ? 'REAL' : 'NO_DATA',
    result: !aiRan ? 'Layanan AI tidak memeriksa foto ini.' : best ? `Ditemukan: ${best.label}.` : 'Tidak ada kerusakan yang dikenali di foto.',
    confidence: best?.confidence ?? null,
    how: `Model ${records.find((x) => x.rec!.ai.modelId)?.rec!.ai.modelId ?? '-'} lewat OpenVINO. Akurasi pada foto lokal: belum diukur.`
  });

  const dups = records.filter((x) => (x.rec!.checks.duplicate ?? '').startsWith('MATCH'));
  const offSite = records.filter((x) => (x.rec!.checks.site ?? '').startsWith('OFF_SITE'));
  const passed = records.length - dups.length - offSite.length;
  findings.push({
    feature: 2, key: 'photo-trust', title: 'Cek keaslian foto',
    what: 'Memeriksa apakah foto diambil langsung di lokasi dan bukan foto daur ulang.',
    benefit: 'Mencegah foto lama atau foto hasil editan dipakai sebagai bukti.',
    status: records.length ? 'REAL' : 'NO_DATA',
    result: records.length === 0 ? 'Belum ada foto.' : `${passed} dari ${records.length} foto lolos. ${dups.length} mirip foto lain, ${offSite.length} di luar lokasi.`,
    confidence: records.length ? passed / records.length : null,
    how: 'Yang sudah berjalan: kode sekali pakai dari server, waktu server, GPS, dan sidik gambar. Pendeteksi foto layar dan editan AI: belum diukur, karena modelnya belum dilatih.'
  });

  const near = deps.store.list().filter((o) => o.id !== c.id && o.state && V5_STATE_LABELS[o.state].open && o.agencyId === c.agencyId && Math.hypot((o.location.latE6 - c.location.latE6) * 0.11132, (o.location.lonE6 - c.location.lonE6) * 0.11132) <= 25);
  findings.push({
    feature: 3, key: 'duplicates', title: 'Penggabung duplikat',
    what: 'Mencari laporan lain untuk lubang yang sama.',
    benefit: 'Petugas tidak datang berkali-kali untuk satu lubang.',
    status: 'REAL',
    result: near.length ? `${near.length + 1} laporan dalam radius 25 m: ${near.map((o) => o.publicCode).join(', ')}.` : 'Tidak ada laporan lain dalam radius 25 m.',
    confidence: null,
    how: 'Memakai jarak GPS. Kemiripan gambar dengan CLIP: belum diukur.'
  });

  const openDays = ladderStatus(c, now).daysWaiting;
  const factors = [c.hazard ? 'ditandai berbahaya' : null, c.damageClass === 'POTHOLE' ? 'lubang' : null, openDays > 0 ? `sudah menunggu ${openDays} hari` : null, c.witnesses > 0 ? `${c.witnesses} warga lain melihat` : null, (weather?.heavyDays ?? 0) > 0 ? 'hujan lebat diperkirakan' : null].filter(Boolean);
  findings.push({
    feature: 4, key: 'priority', title: 'Skor prioritas',
    what: 'Menyusun urutan kerja dan menjelaskan alasannya.',
    benefit: 'Urutan kerja bisa dipertanggungjawabkan.',
    status: 'REAL',
    result: factors.length ? `Alasan: ${factors.join(' · ')}.` : 'Belum ada faktor yang menaikkan prioritas.',
    confidence: null,
    how: 'Aturan terbuka dari data kasus dan prakiraan hujan. Kepadatan motor dan jarak ke sekolah atau rumah sakit: belum ada datanya.'
  });

  findings.push({
    feature: 5, key: 'rain', title: 'Peringatan hujan',
    what: 'Menandai lubang yang bisa tergenang sebelum hujan lebat datang.',
    benefit: 'Lubang tergenang tidak terlihat pengendara. Bisa ditambal lebih dulu.',
    status: weather ? 'REAL' : 'NO_DATA',
    result: !weather ? 'Prakiraan cuaca belum bisa diambil.' : weather.heavyDays > 0 ? `${weather.heavyDays} hari hujan lebat dalam prakiraan. Sebaiknya ditangani lebih dulu.` : 'Tidak ada hujan lebat dalam prakiraan.',
    confidence: null,
    how: `Sumber: ${weather?.source ?? 'Open-Meteo'}. Hari hujan lebat dihitung dari curah hujan harian.`
  });

  const markers = records.filter((x) => x.rec!.marker?.found);
  findings.push({
    feature: 6, key: 'measure', title: 'Ukur dibantu AI',
    what: 'Menghitung ukuran dari kartu penanda di foto.',
    benefit: 'Ukuran lebih cepat dan sulit dimanipulasi.',
    status: records.some((x) => x.rec!.marker) ? 'REAL' : 'NO_DATA',
    result: c.inspection?.areaCm2 ? `Luas tercatat ${Math.round(c.inspection.areaCm2 / 100) / 100} m². ${markers.length ? 'Kartu penanda terbaca.' : 'Kartu penanda tidak terbaca, jadi ini ketikan petugas.'}` : 'Belum diukur di lapangan.',
    confidence: null,
    how: 'Kartu penanda dibaca dengan ArUco (OpenCV). Pembaca angka penggaris: belum diukur, karena modelnya belum ada.'
  });

  const run = c.pinnRun;
  findings.push({
    feature: 7, key: 'pinn', title: 'Perkiraan umur perbaikan',
    what: 'Menghitung berapa lama jalan akan bertahan dari ribuan skenario fisika.',
    benefit: 'Memilih perbaikan yang awet, bukan tambal ulang terus.',
    status: run?.status === 'COMPUTED' ? 'REAL' : 'NO_DATA',
    result: run?.lifeMonths ? `Sekitar ${Math.round(run.lifeMonths.p50)} bulan (kisaran ${Math.round(run.lifeMonths.p10)} sampai ${Math.round(run.lifeMonths.p90)} bulan).` : 'Belum dihitung.',
    confidence: null,
    how: run?.samples ? `${run.samples} skenario pada ${run.device ?? 'CPU'}. Dibandingkan dengan data lapangan: belum diukur.` : 'Dijalankan petugas dari layar kasus.'
  });

  findings.push({
    feature: 8, key: 'cost-per-year', title: 'Biaya per tahun',
    what: 'Menggabungkan biaya tiap bahan dengan perkiraan umurnya.',
    benefit: 'Memilih yang termurah per tahun, bukan termurah hari ini.',
    status: c.costComparison ? 'REAL' : 'NO_DATA',
    result: c.costComparison?.bestLabel ? `Termurah per tahun yang tahan lama: ${c.costComparison.bestLabel}.` : 'Belum dibandingkan.',
    confidence: null,
    how: 'Harga dari buku harga wilayah beserta sumbernya; umur dari PINN.'
  });

  const flagged = anomalies([c], decided);
  findings.push({
    feature: 9, key: 'cost-anomaly', title: 'Deteksi kejanggalan biaya',
    what: 'Membandingkan nilai yang diajukan dengan rentang wajar.',
    benefit: 'Auditor langsung tahu kasus yang perlu klarifikasi.',
    status: c.costRun || c.declared ? 'REAL' : 'NO_DATA',
    result: flagged.length ? flagged.map((f) => f.text).join(' ') : c.costRun || c.declared ? 'Tidak ada yang perlu klarifikasi.' : 'Belum ada nilai untuk dibandingkan.',
    confidence: null,
    how: 'Aturan: selisih lebih dari 20% dari rentang wajar, atau selisih material lebih dari 15%. Ini pertanyaan, bukan tuduhan.'
  });

  const before = records.find((x) => x.ref.stage === 'BEFORE')?.rec;
  const after = records.find((x) => x.ref.stage === 'AFTER')?.rec;
  const distance = before?.gps && after?.gps ? Math.round(Math.hypot((before.gps.lat - after.gps.lat) * 111_320, (before.gps.lon - after.gps.lon) * 111_320)) : null;
  findings.push({
    feature: 10, key: 'before-after', title: 'Cek sebelum dan sesudah',
    what: 'Memastikan foto sebelum dan sesudah diambil di tempat yang sama.',
    benefit: 'Perbaikan di tempat lain atau setengah jadi lebih cepat ketahuan.',
    status: distance === null ? 'NO_DATA' : 'REAL',
    result: distance === null ? 'Foto sebelum dan sesudah belum lengkap.' : distance <= 25 ? `Lokasi cocok, jarak ${distance} m.` : `Jarak ${distance} m. Perlu dicek.`,
    confidence: null,
    how: 'Yang berjalan: pencocokan GPS. Hitung luas tambalan dan celah tepi dari foto: belum diukur, karena modelnya belum ada.'
  });

  const checks = deps.store.list().flatMap((o) => o.followUps.filter((f) => f.result));
  findings.push({
    feature: 11, key: 'early-failure', title: 'Prediksi rusak dini',
    what: 'Memberi peringatan bila pola perbaikan ini mirip yang dulu cepat rusak.',
    benefit: 'Pemeriksaan ulang tepat waktu dan bahan untuk garansi.',
    status: 'NOT_MEASURED',
    result: `Belum diukur. Model butuh riwayat tindak lanjut; saat ini baru ada ${checks.length} catatan.`,
    confidence: null,
    how: 'Model belajar dari konfirmasi warga dan petugas setelah datanya cukup. Sampai saat itu tidak ada angka yang ditampilkan.'
  });

  findings.push({
    feature: 12, key: 'copilot', title: 'Draf tulisan',
    what: 'Menyusun draf usulan untuk dibaca dan diubah petugas.',
    benefit: 'Menghemat waktu menulis.',
    status: 'REAL',
    result: 'Tekan "Buat draf" di bawah. Angka diisi oleh sistem, bukan oleh AI.',
    confidence: null,
    how: 'Qwen2.5 lewat OpenVINO GenAI kalau modelnya terpasang; kalau tidak, memakai templat. Sumbernya selalu ditulis.'
  });

  return findings.map((f) => ({ ...f, decision: last(f.key) }));
}

const weatherCache = new Map<string, Promise<WeatherSummary | null>>();
const weatherFor = (lat: number, lon: number) => {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${new Date().toISOString().slice(0, 13)}`;
  if (!weatherCache.has(key)) weatherCache.set(key, weatherAt(lat, lon).catch(() => null));
  return weatherCache.get(key)!;
};

export function registerV6Insights(router: Router, deps: Deps): void {
  const { workspaces, store, actorOf, sendFail, visible, decisions } = deps;
  const writeLimit = rateLimit('v6-ai', 120, 60_000);

  const staff = (req: Request, res: Response): V5Actor | null => {
    const actor = actorOf(req);
    if (!actor?.agencyId) { sendFail(res, 401, 'UNAUTHENTICATED', 'Belum masuk.'); return null; }
    return actor;
  };

  const firstResponse = (c: V5Case) => store.eventsFor(c.id, c.chainId).find((e) => e.type === 'case.accepted' || e.type === 'inspection.assigned')?.server_received_at ?? null;

  router.get('/api/v6/today', async (req, res) => {
    const actor = staff(req, res);
    if (!actor) return;
    const now = new Date().toISOString();
    const cases = visible(actor);
    const agency = workspaces.agency(actor.agencyId!);
    const numbers = todayNumbers(cases, agency?.slaDays ?? 7, now);
    const holes = cases.filter((c) => isOpen(c) && c.damageClass === 'POTHOLE');
    const anchor = holes[0] ?? cases[0];
    const weather = anchor ? await weatherFor(anchor.location.latE6 / 1e6, anchor.location.lonE6 / 1e6) : null;
    const rain = weather ? { heavyDays: weather.heavyDays, openHoles: holes.length, days: weather.forecast.filter((d) => d.mm >= 20).map((d) => d.date), source: weather.source } : null;
    res.json({ success: true, data: { numbers, briefing: briefingLines(numbers, rain), rain, briefingSource: 'Disusun otomatis dari angka kasus', holes: rain?.heavyDays ? holes.slice(0, 8).map((c) => ({ id: c.id, publicCode: c.publicCode, place: PLACE(c) })) : [] } });
  });

  router.get('/api/v6/monitor', (req, res) => {
    const actor = staff(req, res);
    if (!actor) return;
    if (actor.onlyCaseId) return sendFail(res, 403, 'FORBIDDEN', 'Peran Anda tidak bisa membuka ini.');
    const rows = visible(actor).flatMap((c) => c.followUps.map((f) => ({ caseId: c.id, publicCode: c.publicCode, place: PLACE(c), milestone: f.milestone, dueAt: f.dueAt, result: f.result, warranty: c.warrantyFlag })));
    rows.sort((a, b) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
    res.json({ success: true, data: rows });
  });

  router.get('/api/v6/report-card', (req, res) => {
    const actor = staff(req, res);
    if (!actor) return;
    if (actor.onlyCaseId) return sendFail(res, 403, 'FORBIDDEN', 'Peran Anda tidak bisa membuka ini.');
    const now = new Date().toISOString();
    const cases = visible(actor);
    const name = (id: string | null | undefined) => (id ? workspaces.member(id)?.name ?? null : null);
    res.json({ success: true, data: {
      card: reportCard(cases, workspaces.agency(actor.agencyId!)?.slaDays ?? 7, firstResponse, now),
      byArea: rankBy(cases, (c) => c.routing?.officeName ?? null),
      byExecutor: rankBy(cases, (c) => name(c.workOrder?.crewAccountId))
    } });
  });

  // Public comparison: service numbers per agency, and no person's name (§2.5).
  router.get('/api/v6/public/rankings', (_req, res) => {
    const now = new Date().toISOString();
    const all = store.list();
    res.json({ success: true, data: workspaces.agencies().map((a) => {
      const cases = all.filter((c) => c.agencyId === a.id);
      const card = reportCard(cases, a.slaDays, firstResponse, now);
      return { agency: a.name, totalCases: card.totalCases, medianResponseDays: card.medianResponseDays, withinSlaPct: card.withinSlaPct, stillGood6Pct: card.durable6.stillGoodPct, late: card.late };
    }) });
  });

  router.get('/api/v6/audit/overview', (req, res) => {
    const actor = staff(req, res);
    if (!actor) return;
    if (actor.v6Role !== 'AUDITOR' && actor.v6Role !== 'OM') return sendFail(res, 403, 'FORBIDDEN', 'Peran Anda tidak bisa membuka ini.');
    const cases = visible(actor);
    const own = new Set(cases.map((c) => c.id));
    const events = store.chain.events('prod').filter((e) => own.has(e.entity.id));
    res.json({ success: true, data: {
      chain: store.verify('prod'),
      anomalies: anomalies(cases, decisions.forAgency(actor.agencyId!)),
      exceptions: events.filter((e) => e.actor.overlap_basis).map((e) => ({ caseId: e.entity.id, type: e.type, basis: e.actor.overlap_basis, at: e.server_received_at })),
      documents: store.documents().filter((d) => own.has(d.caseId)).length,
      aiDecisions: decisions.forAgency(actor.agencyId!).length
    } });
  });

  const ownCase = (req: Request, res: Response, actor: V5Actor) => {
    const c = store.get(req.params.id);
    if (!c || !caseVisibleTo(c, actor)) { sendFail(res, 404, 'NOT_FOUND', 'Kasus tidak ditemukan.'); return null; }
    return c;
  };

  router.get('/api/v6/cases/:id/ai', async (req, res) => {
    const actor = staff(req, res);
    if (!actor) return;
    const c = ownCase(req, res, actor);
    if (!c) return;
    if (actor.onlyCaseId) return sendFail(res, 403, 'FORBIDDEN', 'Peran Anda tidak bisa membuka ini.');
    const weather = await weatherFor(c.location.latE6 / 1e6, c.location.lonE6 / 1e6);
    res.json({ success: true, data: caseFindings(c, deps, weather, new Date().toISOString()) });
  });

  // A person decides. This only writes down what they said: it never touches the case state.
  router.post('/api/v6/cases/:id/ai/decisions', writeLimit, async (req, res) => {
    const actor = staff(req, res);
    if (!actor) return;
    if (actor.v6Role !== 'OM' && actor.v6Role !== 'FE') return sendFail(res, 403, 'FORBIDDEN', 'Peran Anda tidak bisa memutuskan ini.');
    const c = ownCase(req, res, actor);
    if (!c) return;
    const decision = req.body?.decision;
    const reason = String(req.body?.reason ?? '').trim();
    const finding = caseFindings(c, deps, null, new Date().toISOString()).find((f) => f.key === req.body?.key);
    if (!finding) return sendFail(res, 400, 'VALIDATION', 'Fitur AI tidak dikenal.');
    if (!['ACCEPT', 'EDIT', 'REJECT'].includes(decision)) return sendFail(res, 400, 'VALIDATION', 'Pilih Terima, Ubah, atau Tolak.');
    if (decision !== 'ACCEPT' && reason.length < 5) return sendFail(res, 400, 'VALIDATION', 'Tulis alasannya.');
    const at = new Date().toISOString();
    const row: AiDecision = { id: `AI-${randomUUID().slice(0, 12)}`, caseId: c.id, agencyId: actor.agencyId!, feature: finding.feature, key: finding.key, inputSummary: finding.what, output: finding.result, confidence: finding.confidence, decision, editedOutput: decision === 'EDIT' ? String(req.body?.edited ?? '') : null, reason, byMemberId: actor.accountId, at };
    decisions.add(row);
    store.recordEntity('ai.suggestion_decided', { type: 'case', id: c.id }, { suggestion_id: row.id, feature: row.feature, decision }, actor, at);
    res.json({ success: true, data: row });
  });

  // Copilot draft: the model writes words, the code fills the numbers (§3 feature 12).
  router.post('/api/v6/cases/:id/ai/draft', writeLimit, async (req, res) => {
    const actor = staff(req, res);
    if (!actor) return;
    if (actor.v6Role !== 'OM' && actor.v6Role !== 'FE') return sendFail(res, 403, 'FORBIDDEN', 'Peran Anda tidak bisa memakai ini.');
    const c = ownCase(req, res, actor);
    if (!c) return;
    const life = c.pinnRun?.lifeMonths ? `${Math.round(c.pinnRun.lifeMonths.p50)} bulan` : 'belum dihitung';
    const cost = c.costRun?.fairCostIdr ? `Rp ${Math.round(c.costRun.fairCostIdr.low).toLocaleString('id-ID')} sampai Rp ${Math.round(c.costRun.fairCostIdr.high).toLocaleString('id-ID')}` : 'belum dihitung';
    const values = { RUAS: PLACE(c), INSTANSI: workspaces.agency(actor.agencyId!)?.name ?? '', SISA_UMUR: life, BERULANG: c.warrantyFlag ? 'pernah rusak lagi' : 'belum ada catatan', LAPORAN_TERBUKA: String(visible(actor).filter(isOpen).length), BIAYA_WAJAR: cost };
    const facts = { ruas: PLACE(c), kerusakan: c.damageClass ?? 'kerusakan jalan', status_jalan: c.routing?.roadStatus ?? 'belum diketahui' };
    const reply = await callInference('POST', '/v1/proposal', { facts, values }, 120_000).catch((e: Error) => ({ error: e.message }));
    const body = ((reply as { body?: Record<string, unknown> }).body ?? {}) as Record<string, unknown>;
    const text = typeof body.text === 'string' ? body.text : typeof body.draft === 'string' ? body.draft : null;
    if (!text) return sendFail(res, 503, 'MODEL_UNAVAILABLE', 'Layanan penulisan belum tersedia. Coba lagi.');
    res.json({ success: true, data: { text, source: body.source ?? 'TEMPLAT', label: 'Disusun AI, perlu persetujuan' } });
  });

  // Settings: the OM's own workspace. Logos come from the agency itself; the app draws none.
  router.get('/api/v6/agency', (req, res) => {
    const actor = staff(req, res);
    if (!actor) return;
    if (actor.v6Role !== 'OM' && actor.v6Role !== 'AUDITOR') return sendFail(res, 403, 'FORBIDDEN', 'Peran Anda tidak bisa membuka ini.');
    res.json({ success: true, data: { agency: workspaces.agency(actor.agencyId!), jurisdictions: workspaces.jurisdictions(actor.agencyId!) } });
  });
}

