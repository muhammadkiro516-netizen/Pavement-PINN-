/**
 * Independent Repair Audit Report (07 §11). The view model is built only from the case record and
 * the event log up to a checkpoint, rendered with escaped values, printed by headless Chromium.
 * Same snapshot and template give the same bytes: Chromium's clock in the PDF is replaced with the
 * snapshot time. No government kop or emblem exists anywhere in this path.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import type { V5Case } from '../../src/domain/v5/model';
import { V5_STATE_LABELS } from '../../src/domain/v5/model';
import { bannedWordsIn } from '../../src/domain/v5/wording';
import type { ChainEvent } from './chain';

const ROOT = process.cwd();
const TEMPLATE = path.join(ROOT, 'docs', 'v5', 'templates', 'audit_report_independent.html');
const FONTS = path.join(ROOT, 'public', 'fonts');

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const STATUS_ID: Record<string, { label: string; cls: string }> = {
  MEASURED: { label: 'TERUKUR', cls: 'measured' },
  OFFICIAL: { label: 'RESMI', cls: 'official' },
  INPUT: { label: 'MASUKAN', cls: 'input' },
  ASSUMED: { label: 'ASUMSI', cls: 'assumed' },
  AI_ESTIMATE: { label: 'PERKIRAAN AI', cls: 'ai' },
  TODO_VERIFY: { label: 'PERLU VERIFIKASI', cls: 'assumed' },
  COMPUTED: { label: 'DIHITUNG', cls: 'input' }
};
const statusChip = (s: string) => `<span class="status status-${STATUS_ID[s]?.cls ?? 'input'}">${esc(STATUS_ID[s]?.label ?? s)}</span>`;

const EVENT_STEP_ID: Record<string, string> = {
  'demo.seeded': 'Data contoh dimuat (DEMO)',
  'case.submitted': 'Laporan warga diterima',
  'case.screening_started': 'Penyaringan otomatis dimulai',
  'case.screened': 'Penyaringan dan penentuan kewenangan selesai',
  'case.duplicate_suggested': 'Usulan duplikat dicatat',
  'case.accepted': 'Diterima instansi',
  'case.transfer_requested': 'Permintaan pengalihan kewenangan',
  'case.transfer_confirmed': 'Pengalihan kewenangan dikonfirmasi',
  'case.pending_set': 'Alasan penundaan dicatat',
  'case.hazard_marked': 'Rambu sementara dicatat',
  'inspection.assigned': 'Inspeksi ditugaskan',
  'inspection.submitted': 'Hasil inspeksi lapangan',
  'inspection.verified': 'Hasil inspeksi diperiksa',
  'cost.estimated': 'Estimasi biaya wajar dihitung',
  'pinn.run': 'Rentang umur dihitung',
  'plan.proposed': 'Usulan penanganan disusun',
  'plan.approved': 'Penanganan disetujui',
  'plan.returned': 'Usulan dikembalikan',
  'work_order.issued': 'Perintah kerja internal diterbitkan',
  'work.started': 'Pekerjaan dimulai',
  'work.stage_evidence': 'Bukti tahap pekerjaan',
  'work.submitted': 'Bukti pekerjaan lengkap dikirim',
  'work.rejected': 'Pekerjaan perlu diulang',
  'work.verified': 'Hasil diperiksa pengawas',
  'work.accepted': 'Pekerjaan diterima; pemantauan dijadwalkan',
  'follow_up.recorded': 'Pemantauan lanjutan dicatat',
  'follow_up.scheduled': 'Pemantauan lanjutan dijadwalkan',
  'flag.created': 'Catatan indikasi dibuat',
  'response.added': 'Tanggapan pihak terkait',
  'case.reopened': 'Kasus dibuka kembali',
  'case.closed': 'Kasus ditutup',
  'document.issued': 'Dokumen diterbitkan',
  'demo.time_advanced': 'Waktu demo dimajukan (DEMO)'
};

const ROLE_ID: Record<string, string> = {
  CITIZEN: 'Warga', FIELD_INSPECTOR: 'Petugas Inspeksi', COORDINATOR: 'Koordinator Pemeliharaan', APPROVER: 'Pejabat Penyetuju', REPAIR_CREW: 'Pelaksana Perbaikan', SUPERVISOR: 'Pengawas Pekerjaan', AUDITOR: 'Auditor', AGENCY_HEAD: 'Pimpinan Instansi', ADMIN: 'Admin Wilayah', SYSTEM: 'Sistem'
};

const wib = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().replace('T', ' ').slice(0, 16) + ' WIB';
const rupiah = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `Rp${Math.round(n).toLocaleString('id-ID')}`);
const num = (n: number, digits = 2) => n.toLocaleString('id-ID', { maximumFractionDigits: digits });

export interface DocSnapshot {
  chainId: string;
  firstSeq: number;
  lastSeq: number;
  root: string;
  period: string;
  time: string;
}

export interface RenderInput {
  docId: string;
  version: number;
  supersedes: string | null;
  c: V5Case;
  events: ChainEvent[];
  evidenceHashes: { label: string; sha256Public: string; sha256Enc: string | null }[];
  snapshot: DocSnapshot;
  verifyUrl: string;
  authorityAddress: string;
  authorityContact: string;
}

function measurementRows(c: V5Case): string {
  const i = c.inspection;
  const rows: string[] = [];
  const row = (name: string, value: string, unc: string, method: string, status: string) => rows.push(`<tr><td>${esc(name)}</td><td class="num">${esc(value)}</td><td class="num">${esc(unc)}</td><td>${esc(method)}</td><td>${statusChip(status)}</td></tr>`);
  if (i?.lengthMm && i?.widthMm) {
    const method = i.areaStatus === 'MEASURED' ? 'Kartu penanda + ketikan petugas' : 'Ketikan petugas, tanpa kartu penanda';
    row('Panjang kerusakan', `${num(i.lengthMm / 1000)} m`, 'belum diukur', method, i.areaStatus ?? 'INPUT');
    row('Lebar kerusakan', `${num(i.widthMm / 1000)} m`, 'belum diukur', method, i.areaStatus ?? 'INPUT');
    row('Luas kerusakan', `${num((i.areaCm2 ?? 0) / 10000, 3)} m²`, 'belum diukur', method, i.areaStatus ?? 'INPUT');
  }
  if (i?.depthMmTyped) row('Kedalaman terdalam', `${i.depthMmTyped} mm`, 'belum diukur', 'Mistar perata + penggaris, foto bukti', 'MEASURED');
  if (c.trace) row('Panjang jejak GPS', `${num(c.trace.lengthM, 1)} m`, 'mengikuti akurasi GPS', `Jejak GPS, kualitas ${c.trace.quality}`, 'MEASURED');
  if (c.declared?.thicknessMm) row('Tebal lepas dideklarasikan', `${c.declared.thicknessMm} mm`, 'belum diukur', 'Ketikan pelaksana', 'INPUT');
  return rows.join('') || '<tr><td colspan="5">Belum ada pengukuran lapangan.</td></tr>';
}

function costRows(c: V5Case): string {
  const run = c.costRun;
  if (!run) return '<tr><td colspan="6">Estimasi biaya belum dihitung.</td></tr>';
  const range = (t: { low: number; high: number } | null) => (t ? `${rupiah(t.low)} – ${rupiah(t.high)}` : '–');
  return run.lines.map((l: { id: string; item: string; idr: { low: number; high: number } | null; status: string; sourceToFetch?: string }) => `<tr><td>${esc(l.item)}</td><td class="num">${l.id === 'hotmix' ? esc(num(run.quantity.tons.mid, 3)) : '–'}</td><td>${l.id === 'hotmix' ? 'ton' : '–'}</td><td class="num">–</td><td class="num">${esc(l.idr ? range(l.idr) : 'tidak dihitung')}</td><td>${statusChip(l.status)} ${esc(l.sourceToFetch ?? '')}</td></tr>`).join('');
}

function indicationItems(c: V5Case): string {
  const items = c.flags.filter((f) => f.state !== 'WITHDRAWN').map((f) => `<li>${esc(f.text)}${f.note ? ` <span class="muted">(${esc(f.note)})</span>` : ''}</li>`);
  return items.join('') || '<li>Belum ada catatan indikasi pada kasus ini.</li>';
}

function responseItems(events: ChainEvent[]): string {
  const items = events.filter((e) => e.type === 'response.added').map((e) => `<li>${esc(ROLE_ID[e.actor.role] ?? e.actor.role)}, ${esc(wib(e.server_received_at))}: ${esc(e.payload.text)}</li>`);
  return items.join('') || '<li>Belum ada tanggapan yang tercatat.</li>';
}

export function buildPlaceholders(input: RenderInput, qrDataUrl: string): Record<string, string> {
  const { c, events, snapshot, docId, version, supersedes, verifyUrl } = input;
  const routing = c.routing;
  const run = c.costRun;
  const cmp = run?.comparison;
  const pinn = c.pinnRun;
  const wo = c.workOrder;
  const roadName = routing?.segmentName || 'Ruas belum teridentifikasi';
  const timeline = events
    .map((e) => `<tr><td>${esc(wib(e.server_received_at))}</td><td>${esc(EVENT_STEP_ID[e.type] ?? e.type)}</td><td>${esc(ROLE_ID[e.actor.role] ?? e.actor.role)}</td><td>${e.refs.evidence_sha256.length || '–'}</td></tr>`)
    .join('');
  const contract = wo
    ? `<table class="data"><tr><th style="width:34%">Jenis pekerjaan</th><td>${esc(wo.type)}${wo.packageId ? ` · paket ${esc(wo.packageId)}` : ''}</td></tr><tr><th>Tanggal serah terima pertama (PHO)</th><td>${wo.phoDate ? `${esc(wib(wo.phoDate))} ${statusChip('INPUT')}` : 'Tidak berlaku atau belum dicatat'}</td></tr><tr><th>Masa pemeliharaan</th><td>${wo.maintenanceMonths ? `${wo.maintenanceMonths} bulan ${statusChip('INPUT')}` : 'Belum dicatat'}</td></tr></table>`
    : '<p>Belum ada perintah kerja internal pada kasus ini.</p>';
  const followUps = c.followUps.map((f) => `<tr><td>${esc(f.milestone)}</td><td>${f.dueAt ? esc(wib(f.dueAt)) : 'Menunggu hujan lebat pertama'}</td><td>${esc(f.result ?? 'Belum')}</td></tr>`).join('');
  const durability = `<table class="data"><tr><th style="width:34%">Rentang umur perkiraan</th><td>${pinn?.lifeMonths ? `${esc(num(pinn.lifeMonths.p10, 1))}–${esc(num(pinn.lifeMonths.p90, 1))} bulan (median ${esc(num(pinn.lifeMonths.p50, 1))}) ${statusChip('AI_ESTIMATE')}, lalu lintas ${statusChip('INPUT')}, struktur ${statusChip('ASSUMED')}` : 'Tidak dihitung'}</td></tr></table><h3>Jadwal pemantauan</h3><table class="data"><thead><tr><th>Tahap</th><th>Jatuh tempo</th><th>Hasil</th></tr></thead><tbody>${followUps || '<tr><td colspan="3">Belum terjadwal.</td></tr>'}</tbody></table>`;
  const recs = ['Direkomendasikan uji inti (core drill) untuk memeriksa tebal lapisan dan kepadatan (persyaratan ≥ 98% sesuai spesifikasi yang berlaku).', 'Instansi berwenang dimohon memverifikasi data lapangan di lokasi.'];

  return {
    doc_id: esc(docId),
    doc_version: String(version),
    supersedes_line: supersedes ? `Menggantikan versi ${esc(supersedes)}` : '',
    case_id: esc(c.id),
    public_code: esc(c.publicCode),
    issued_at_wib: esc(wib(snapshot.time)),
    road_name: esc(roadName),
    segment_id: esc(routing?.segmentId ?? 'tidak ada'),
    road_status: esc(routing?.roadStatus ?? 'Belum diketahui'),
    status_basis: esc(routing?.basis ?? 'Belum diketahui'),
    routing_confidence: esc({ HIGH: 'TINGGI', MEDIUM: 'SEDANG', LOW: 'RENDAH' }[routing?.confidence ?? 'LOW']),
    sta_or_coordinates: esc(`${(c.location.latE6 / 1e6).toFixed(5)}, ${(c.location.lonE6 / 1e6).toFixed(5)}`),
    authority_name: esc(routing?.officeName ?? routing?.authorityName ?? 'Belum ditentukan'),
    authority_address: esc(input.authorityAddress),
    authority_contact: esc(input.authorityContact),
    authority_level: esc(routing?.authorityLevel ?? '–'),
    timeline,
    measurement_table: measurementRows(c),
    cost_table: costRows(c),
    cost_summary: esc(run?.fairCostIdr ? `${rupiah(run.fairCostIdr.low)} – ${rupiah(run.fairCostIdr.high)} (tengah ${rupiah(run.fairCostIdr.mid)}). Indikatif: koefisien AHSP resmi belum dimuat; tidak termasuk ${run.completeness.excluded.join(', ')}.` : 'Tidak dihitung'),
    reported_spend: cmp ? `${esc(rupiah(cmp.reportedSpendIdr))} ${statusChip('INPUT')}` : 'Belum ada nilai yang dilaporkan',
    cost_diff_line: esc(cmp ? `Estimasi biaya wajar berbeda ${Math.abs(cmp.diffPct)}% dari nilai yang dilaporkan: ${cmp.label_id} (bukan temuan audit).` : '–'),
    contract_stage_block: contract,
    durability_block: durability,
    indication_list: indicationItems(c),
    recommendation_list: recs.map((r) => `<li>${esc(r)}</li>`).join(''),
    response_list: responseItems(events),
    evidence_hashes: input.evidenceHashes.map((e) => `<tr><td>${esc(e.label)}</td><td class="mono">${esc(e.sha256Public)}</td><td class="mono">${esc(e.sha256Enc ?? '–')}</td></tr>`).join('') || '<tr><td colspan="3">Tidak ada bukti foto.</td></tr>',
    snapshot_root: esc(snapshot.root),
    snapshot_range: esc(`#${snapshot.firstSeq}–#${snapshot.lastSeq} (rantai ${snapshot.chainId})`),
    checkpoint_period: esc(snapshot.period),
    ots_status: esc(c.isDemo ? 'Rantai DEMO: tidak dijangkarkan ke Bitcoin' : 'Belum dijangkarkan; OpenTimestamps belum diaktifkan'),
    verify_qr: `<img src="${qrDataUrl}" alt="Kode QR verifikasi integritas" width="120" height="120">`,
    verify_url: esc(verifyUrl),
    ai_assist_line: esc('Deteksi kerusakan dan rentang umur dihitung model AI dan diberi label. Tidak ada keputusan yang diambil oleh AI. Laporan ini belum ditandatangani secara elektronik; keaslian dapat diperiksa melalui kode QR.'),
    demo_watermark: c.isDemo ? '<div class="demo-watermark">DEMO — BUKAN DATA NYATA</div>' : '',
    operator_entity: esc('Tim PAVEMENT-PINN (badan hukum: belum ditetapkan)'),
    operator_address: esc('Alamat operator: belum ditetapkan'),
    operator_website: esc(new URL(verifyUrl).host)
  };
}

export function renderTemplate(values: Record<string, string>): string {
  const template = fs.readFileSync(TEMPLATE, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const missing = new Set<string>();
  const html = template.replace(/\{\{([a-z_]+)\}\}/g, (_m, name: string) => {
    if (!(name in values)) missing.add(name);
    return values[name] ?? '';
  });
  if (missing.size > 0) throw new Error(`Unknown template placeholders: ${[...missing].join(', ')}`);
  return html.replace(/url\("fonts\//g, `url("file:///${FONTS.replace(/\\/g, '/')}/`);
}

/** Text of a rendered report, for the banned-word and no-kop checks. */
export function reportProblems(html: string): string[] {
  const text = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
  // The legal disclaimer names these terms only to deny them, in the wording library's own sentence.
  const scrubbed = text
    .replace(/bukan merupakan kesimpulan audit, penilaian kerugian negara/g, '')
    .replace(/bukan temuan audit dan bukan penilaian kerugian negara/g, '');
  return bannedWordsIn(scrubbed);
}

const PDF_DATE = /\/(CreationDate|ModDate) \(D:[0-9]{14}[^)]*\)/g;

/** Replaces Chromium's clock with the snapshot time, same length, so bytes repeat (IN-3). */
export function normalizePdf(pdf: Buffer, snapshotTime: string): Buffer {
  const stamp = snapshotTime.replace(/[-:T]/g, '').slice(0, 14);
  const text = pdf.toString('latin1').replace(PDF_DATE, (m, field: string) => {
    const date = `/${field} (D:${stamp}`;
    const close = m.length - date.length - 1;
    return `${date}${"+00'00'".slice(0, Math.max(0, close)).padEnd(Math.max(0, close), ' ')})`;
  });
  return Buffer.from(text, 'latin1');
}

export async function htmlToPdf(html: string, workDir: string, snapshotTime: string): Promise<Buffer> {
  const { chromium } = await import('playwright-core');
  fs.mkdirSync(workDir, { recursive: true });
  const file = path.join(workDir, `render-${createHash('sha256').update(html).digest('hex').slice(0, 12)}.html`);
  fs.writeFileSync(file, html);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`file:///${file.replace(/\\/g, '/')}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: false });
    return normalizePdf(Buffer.from(pdf), snapshotTime);
  } finally {
    await browser.close();
    fs.rmSync(file, { force: true });
  }
}

export const qrFor = (url: string) => QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' });

export const stateLabel = (c: V5Case) => (c.state ? V5_STATE_LABELS[c.state].en : 'New');
