/**
 * The regional price book (docs/v6/PROMPT_CLAUDE_CODE_PRICES.md). The CSVs load exactly as written: values stay
 * strings until a sum needs them, and TODO_VERIFY rows stay out of the sums until an OM confirms them.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import { rateLimit } from '../middleware/rateLimit';
import { callInference } from '../services/inferenceClient';
import { parseCsv } from '../v5/routing';
import type { V5Store } from '../v5/store';
import { caseVisibleTo } from '../../src/domain/v5/stateMachine';
import type { V5Actor, V5Case } from '../../src/domain/v5/model';
import { compareOptions, compareSubmitted, lookupPrice, nonMonotonicKSeries, validateImport, type FoundPrice, type Lookup, type OptionInput, type OptionKey, type PriceRow, type PriceStatus } from '../../src/domain/v6/costV6';
import { checkReauth } from './routes';
import type { Workspaces } from './workspaces';

const DATA = path.join(process.cwd(), 'docs', 'v6', 'data', 'prices');
const read = (name: string) => parseCsv(fs.readFileSync(path.join(DATA, name), 'utf8'));

export function loadRegional(): PriceRow[] {
  return read('price_book_regional_2026.csv').map((r, i) => ({
    id: `REG-${String(i + 1).padStart(3, '0')}`,
    regionCode: r.region_code,
    regionName: r.region_name,
    group: r.item_group,
    nameAsWritten: r.item_name_as_written,
    nameEn: r.item_name_en,
    unitAsWritten: r.unit_as_written,
    priceAsWritten: r.price_idr,
    unitNormalized: r.unit_normalized,
    priceNormalized: r.price_idr_normalized,
    validYear: r.valid_year,
    sourceDoc: r.source_doc,
    sourceUrl: r.source_url,
    sourcePage: r.source_page,
    status: r.status as PriceStatus,
    notes: r.notes,
    importedBy: null,
    importedAt: null
  }));
}

const IKK_AREA: Record<string, string> = { '3215': 'Kabupaten Karawang', '3603': 'Kabupaten Tangerang', '3175': 'Kota Jakarta (5 kota adm.)', '31': 'DKI Jakarta', '18': 'Lampung' };

export function loadIkk(): (regionCode: string) => number | null {
  const rows = parseCsv(fs.readFileSync(path.join(process.cwd(), 'docs', 'v5', 'data', 'ikk_2025.csv'), 'utf8'));
  return (code) => {
    const v = rows.find((r) => r.area === IKK_AREA[code])?.ikk_2025;
    return v ? Number(v) : null;
  };
}

interface AgencyPrices {
  rows: PriceRow[];
  confirmedIds: string[];
  /** The OM's pick between Karawang's two AC-WC lines. Never an average (README §3.1). */
  acWcChoice: string | null;
  imports: { at: string; file: string; sha256: string; rows: number; byMemberId: string }[];
}

export class PriceBook {
  readonly regional = loadRegional();
  readonly ikk = loadIkk();
  private readonly file: string;
  private data: Record<string, AgencyPrices> = {};

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'price-books.json');
    if (fs.existsSync(this.file)) this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  of(agencyId: string): AgencyPrices {
    return (this.data[agencyId] ??= { rows: [], confirmedIds: [], acWcChoice: null, imports: [] });
  }

  save(): void {
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }
}

const WANTS: Record<Exclude<OptionKey, 'HOT_MIX_PATCH' | 'AC_WC_OVERLAY'>, (r: PriceRow) => boolean> = {
  COLD_MIX_PATCH: (r) => /cold\s*mix|cphma|aspal dingin/i.test(r.nameAsWritten),
  FAST_TRACK_CONCRETE: (r) => /rapid setting|fast track/i.test(r.nameAsWritten),
  CONCRETE_K350: (r) => /^Beton Ready Mix(ed)?[,\s-]*K[.\s-]*350$/i.test(r.nameAsWritten.trim())
};
const isAcWc = (r: PriceRow) => /AC Wearing|Ac\s*-\s*Wc/i.test(r.nameAsWritten);

const DOC_FOR: Record<string, string> = {
  '3175': 'HSPK / e-HSPK DKI 2026 (jdih.jakarta.go.id)',
  '3215': 'daftar harga instansi (HSPK Kabupaten Karawang), lewat Impor CSV',
  default: 'SSH atau HSPK daerah TA berjalan, lewat Impor CSV'
};

export interface LifeByOption { patch: { low: number; mid: number; high: number } | null; overlay: { low: number; mid: number; high: number } | null; note: string }

/** Builds the side-by-side options. Exported so the worked example can run without a server. */
export function buildOptions(book: PriceBook, agencyId: string, regionCode: string, life: LifeByOption): OptionInput[] {
  const own = book.of(agencyId);
  const base = { agencyBook: own.rows, regional: book.regional, confirmedIds: new Set(own.confirmedIds), ikk: book.ikk, regionCode, documentToLoad: DOC_FOR[regionCode] ?? DOC_FOR.default };
  const acRows = [...own.rows, ...book.regional].filter((r) => r.regionCode === regionCode && isAcWc(r));
  const toFound = (r: PriceRow): FoundPrice => ({ row: r, priceIdr: Number(r.priceNormalized), status: r.status, how: own.rows.includes(r) ? 'AGENCY_BOOK' : 'SAME_REGION', note: null });
  const chosen = acRows.find((r) => r.id === own.acWcChoice);
  const acPrice: Lookup = chosen ? { found: toFound(chosen) } : lookupPrice({ ...base, match: isAcWc });
  const choices = !chosen && acRows.length > 1 ? acRows.map(toFound) : undefined;
  const noLife = 'Umur bahan ini belum bisa dihitung; modelnya hanya mencakup aspal.';
  return [
    { key: 'HOT_MIX_PATCH', price: acPrice, choices, lifeMonths: life.patch, lifeNote: life.patch ? life.note : noLife },
    { key: 'COLD_MIX_PATCH', price: lookupPrice({ ...base, match: WANTS.COLD_MIX_PATCH, documentToLoad: 'harga cold mix/CPHMA dari HSPK instansi, lewat Impor CSV' }), lifeMonths: null, lifeNote: noLife },
    { key: 'FAST_TRACK_CONCRETE', price: lookupPrice({ ...base, match: WANTS.FAST_TRACK_CONCRETE }), lifeMonths: null, lifeNote: noLife },
    { key: 'CONCRETE_K350', price: lookupPrice({ ...base, match: WANTS.CONCRETE_K350 }), lifeMonths: null, lifeNote: noLife },
    { key: 'AC_WC_OVERLAY', price: acPrice, choices, lifeMonths: life.overlay, lifeNote: life.overlay ? life.note : noLife }
  ];
}

const QA_RECOMMEND: Record<string, string> = { 'Core Drill (pengujian campuran aspal)': 'Tebal dan kepadatan lapisan aspal', Marshall: 'Kekuatan campuran aspal', 'Ekstraksi (Teknis)': 'Kadar aspal dalam campuran', 'Sand Cone': 'Kepadatan lapis pondasi' };

interface Deps {
  workspaces: Workspaces;
  store: V5Store;
  actorOf: (req: Request) => V5Actor | null;
  sendFail: (res: Response, status: number, code: string, message: string, rule?: string) => unknown;
  dataDir: string;
}

export function registerPriceRoutes(router: Router, deps: Deps): PriceBook {
  const { workspaces, store, actorOf, sendFail } = deps;
  const book = new PriceBook(path.join(deps.dataDir, 'v6'));
  const limit = rateLimit('v6-prices', 60, 60_000);

  const reader = (req: Request, res: Response): V5Actor | null => {
    const actor = actorOf(req);
    if (!actor?.agencyId) { sendFail(res, 401, 'UNAUTHENTICATED', 'Belum masuk.'); return null; }
    if (actor.v6Role === 'CONTRACTOR') { sendFail(res, 403, 'FORBIDDEN', 'Peran Anda tidak bisa membuka ini.'); return null; }
    return actor;
  };
  const manager = (req: Request, res: Response): V5Actor | null => {
    const actor = reader(req, res);
    if (!actor) return null;
    if (actor.v6Role !== 'OM') { sendFail(res, 403, 'FORBIDDEN', 'Hanya Operations Manager yang bisa mengubah buku harga.'); return null; }
    return checkReauth({ workspaces, sendFail }, req, res, actor) ? actor : null;
  };

  router.get('/api/v6/prices', (req, res) => {
    const actor = reader(req, res);
    if (!actor) return;
    const own = book.of(actor.agencyId!);
    const agency = workspaces.agency(actor.agencyId!);
    const wages = read('wages_daily_2026.csv');
    res.json({ success: true, data: {
      region: agency?.region ?? '',
      rows: [...own.rows, ...book.regional],
      confirmedIds: own.confirmedIds,
      acWcChoice: own.acWcChoice,
      acWcRows: [...own.rows, ...book.regional].filter((r) => r.regionCode === agency?.region && isAcWc(r)).map((r) => ({ id: r.id, name: r.nameAsWritten, price: r.priceNormalized, page: r.sourcePage })),
      wages,
      equipment: read('equipment_rental_2026.csv'),
      qa: read('qa_test_prices_2026.csv').map((q) => ({ ...q, purpose: QA_RECOMMEND[q.test_as_written] ?? null })),
      signals: read('market_price_signals_2026.csv'),
      todoRegions: read('price_book_todo_regions.csv'),
      imports: own.imports,
      notes: [
        ...nonMonotonicKSeries(book.regional),
        ...wages.filter((w) => /^Operator Alat Berat$/.test(w.role_as_written)).map((w) => `${w.region_name}: upah Operator Alat Berat Rp ${Number(w.wage_idr_per_day).toLocaleString('id-ID')}/OH tertulis lebih rendah dari Pekerja. Ditampilkan apa adanya. Mohon admin memeriksa.`),
        'Kabupaten Tangerang: Perbup 32/2025 sudah diubah oleh Perbup 68/2025. Nilainya perlu dicek ulang.',
        'Konversi mutu K ke fc\' hanya perkiraan (≈), bukan nilai dari dokumen.'
      ]
    } });
  });

  router.post('/api/v6/prices/import', limit, (req, res) => {
    const actor = manager(req, res);
    if (!actor) return;
    const csv = String(req.body?.csv ?? '');
    const fileName = String(req.body?.fileName ?? 'unggahan.csv').slice(0, 120);
    if (!csv.trim()) return sendFail(res, 400, 'VALIDATION', 'File CSV kosong.');
    const rows = parseCsv(csv);
    const header = csv.split(/\r?\n/, 1)[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    const { problems, warnings } = validateImport(rows, header, book.regional);
    if (problems.length) return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'File belum bisa dipakai.' }, problems, warnings });
    const now = new Date().toISOString();
    const sha256 = createHash('sha256').update(csv).digest('hex');
    const own = book.of(actor.agencyId!);
    const base = own.rows.length;
    own.rows.push(...rows.map((r, i): PriceRow => ({
      id: `${actor.agencyId}-${base + i + 1}`,
      regionCode: r.region_code, regionName: r.region_name, group: r.item_group, nameAsWritten: r.item_name_as_written, nameEn: r.item_name_en ?? '',
      unitAsWritten: r.unit_as_written, priceAsWritten: r.price_idr, unitNormalized: r.unit_normalized || r.unit_as_written, priceNormalized: r.price_idr_normalized || r.price_idr,
      validYear: r.valid_year, sourceDoc: r.source_doc, sourceUrl: r.source_url ?? '', sourcePage: r.source_page ?? '', status: (r.status as PriceStatus) || 'AGENCY', notes: r.notes ?? '', importedBy: actor.accountId, importedAt: now
    })));
    own.imports.push({ at: now, file: fileName, sha256, rows: rows.length, byMemberId: actor.accountId });
    book.save();
    store.recordEntity('prices.imported', { type: 'agency', id: actor.agencyId! }, { file: fileName, sha256, rows: rows.length, warnings: warnings.length }, actor, now);
    res.json({ success: true, data: { rows: rows.length, warnings, sha256 } });
  });

  router.post('/api/v6/prices/confirm', limit, (req, res) => {
    const actor = manager(req, res);
    if (!actor) return;
    const id = String(req.body?.rowId ?? '');
    const row = book.regional.find((r) => r.id === id);
    const reason = String(req.body?.reason ?? '').trim();
    if (!row || row.status !== 'TODO_VERIFY') return sendFail(res, 400, 'VALIDATION', 'Baris ini tidak perlu dikonfirmasi.');
    if (reason.length < 10) return sendFail(res, 400, 'VALIDATION', 'Tulis dokumen yang Anda periksa.');
    const own = book.of(actor.agencyId!);
    if (!own.confirmedIds.includes(id)) own.confirmedIds.push(id);
    book.save();
    store.recordEntity('prices.confirmed', { type: 'agency', id: actor.agencyId! }, { row_id: id, name: row.nameAsWritten, reason }, actor, new Date().toISOString());
    res.json({ success: true, data: { confirmedIds: own.confirmedIds } });
  });

  router.post('/api/v6/prices/ac-wc-choice', limit, (req, res) => {
    const actor = manager(req, res);
    if (!actor) return;
    const own = book.of(actor.agencyId!);
    const region = workspaces.agency(actor.agencyId!)?.region;
    const row = [...own.rows, ...book.regional].find((r) => r.id === req.body?.rowId && r.regionCode === region && isAcWc(r));
    if (!row) return sendFail(res, 400, 'VALIDATION', 'Pilih salah satu baris AC-WC wilayah Anda.');
    own.acWcChoice = row.id;
    book.save();
    store.recordEntity('prices.ac_wc_chosen', { type: 'agency', id: actor.agencyId! }, { row_id: row.id, name: row.nameAsWritten, price: row.priceNormalized }, actor, new Date().toISOString());
    res.json({ success: true, data: { acWcChoice: row.id } });
  });

  /** Life per option from the physics service; the spread comes from the case's PINN run. */
  const lifeFor = async (c: V5Case, esalYear: number, h: number, cbr: number): Promise<LifeByOption> => {
    const none = { patch: null, overlay: null, note: 'Layanan fisika tidak terjangkau.' };
    const reply = await callInference('POST', '/v1/decide', { layers: [{ h_mm: h, E_mpa: 3000, nu: 0.35 }, { h_mm: 300, E_mpa: 300, nu: 0.35 }], subgrade: { cbr, soaked_factor: 0.5 }, esal_day: esalYear / 365 });
    if ('unavailable' in reply || !reply.ok) return none;
    const options = (reply.body as { options: { code: string; life_years: number | null }[] }).options;
    const months = (code: string) => { const y = options.find((o) => o.code === code)?.life_years; return y === null || y === undefined ? null : y * 12; };
    const p = c.pinnRun?.lifeMonths;
    const lowRatio = p && p.p50 > 0 ? p.p10 / p.p50 : 1;
    const highRatio = p && p.p50 > 0 ? p.p90 / p.p50 : 1;
    const spread = (m: number | null) => (m === null ? null : { low: Math.round(m * lowRatio * 10) / 10, mid: Math.round(m * 10) / 10, high: Math.round(m * highRatio * 10) / 10 });
    return { patch: spread(months('RUTIN')), overlay: spread(months('BERKALA')), note: `Dari model fisika dengan beban ${Math.round(esalYear).toLocaleString('id-ID')} ESAL/tahun, tebal aspal ${h} mm, CBR ${cbr}. ${p ? 'Rentang mengikuti hasil PINN kasus ini.' : 'Jalankan PINN untuk melihat rentangnya.'} Tebal, CBR, dan modulus adalah asumsi sampai diukur.` };
  };

  router.post('/api/v6/cases/:id/compare-options', limit, async (req, res) => {
    const actor = reader(req, res);
    if (!actor) return;
    const c = store.get(req.params.id);
    if (!c || !caseVisibleTo(c, actor)) return sendFail(res, 404, 'NOT_FOUND', 'Kasus tidak ditemukan.');
    if (actor.v6Role === 'AUDITOR' && c.costComparison) return res.json({ success: true, data: c.costComparison });
    if (actor.v6Role === 'AUDITOR') return sendFail(res, 404, 'NOT_FOUND', 'Petugas belum membandingkan biaya untuk kasus ini.');
    const areaM2 = c.inspection?.areaCm2 ? c.inspection.areaCm2 / 10_000 : c.inspection?.lengthMm && c.inspection.widthMm ? (c.inspection.lengthMm * c.inspection.widthMm) / 1e6 : null;
    const depthCm = c.inspection?.depthMmTyped ? c.inspection.depthMmTyped / 10 : null;
    if (!areaM2 || !depthCm) return sendFail(res, 400, 'VALIDATION', 'Ukur luas dan kedalamannya dulu.');
    const esalYear = Number(req.body?.esalYear ?? c.pinnRun?.esalYear ?? 0);
    if (!Number.isFinite(esalYear) || esalYear <= 0) return sendFail(res, 400, 'VALIDATION', 'Isi beban lalu lintas dulu, atau jalankan PINN.');
    const agency = workspaces.agency(actor.agencyId!);
    const life = await lifeFor(c, esalYear, Number(req.body?.asphaltMm) || 60, Number(req.body?.cbr) || 5);
    const options = compareOptions(buildOptions(book, actor.agencyId!, agency?.region ?? '', life), { areaM2, depthCm });
    const best = options.find((o) => o.best);
    const now = new Date().toISOString();
    const costComparison = { bestLabel: best?.label ?? null, ranAt: now, options, excluded: 'Belum termasuk upah dan alat: koefisien AHSP resmi (SE 30/SE/Dk/2025 Lampiran V) belum dimuat.', regionCode: agency?.region ?? '', measure: { areaM2, depthCm } };
    const next = store.record(c, { costComparison }, 'cost.compared', { region: agency?.region ?? '', options: options.map((o) => ({ key: o.key, status: o.status, mid_idr: o.totalIdr?.mid ?? null, per_year_idr: o.costPerYearIdr?.mid ?? null })), best: best?.key ?? null }, actor, now);
    res.json({ success: true, data: next.costComparison });
  });

  // Submitted or contract value against the computed range: more than 20% goes to the auditor's list.
  router.post('/api/v6/cases/:id/submitted-value', limit, (req, res) => {
    const actor = reader(req, res);
    if (!actor) return;
    if (actor.v6Role === 'AUDITOR') return sendFail(res, 403, 'FORBIDDEN', 'Auditor hanya membaca.');
    const c = store.get(req.params.id);
    if (!c || !caseVisibleTo(c, actor)) return sendFail(res, 404, 'NOT_FOUND', 'Kasus tidak ditemukan.');
    const submitted = Number(req.body?.submittedIdr);
    if (!Number.isFinite(submitted) || submitted <= 0) return sendFail(res, 400, 'VALIDATION', 'Isi nilai dalam rupiah.');
    const comparison = c.costComparison as unknown as { options: { key: string; totalIdr: { low: number; mid: number; high: number } | null }[] } | null;
    const chosen = comparison?.options.find((o) => o.key === req.body?.optionKey && o.totalIdr);
    if (!chosen) return sendFail(res, 400, 'VALIDATION', 'Bandingkan opsi dulu, lalu pilih opsi yang punya harga.');
    const audit = compareSubmitted(submitted, chosen.totalIdr!);
    const now = new Date().toISOString();
    const next = store.record(c, { costComparison: { ...comparison!, audit: { ...audit, optionKey: chosen.key } } as never }, 'cost.submitted_compared', { option: chosen.key, submitted_idr: submitted, difference_pct_x10: Math.round(audit.differencePct * 10), needs_clarification: audit.needsClarification }, actor, now);
    res.json({ success: true, data: next.costComparison });
  });

  return book;
}
