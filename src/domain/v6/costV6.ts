/**
 * Cost engine v6 (docs/v6/PROMPT_CLAUDE_CODE_PRICES.md, README_PRICE_DATA.md §4). Pure: the caller passes the
 * prices it found. No price or coefficient is ever invented: what is missing stays missing and says so.
 */
export type PriceStatus = 'OFFICIAL' | 'SOURCE' | 'TODO_VERIFY' | 'ASSUMED' | 'COMPUTED' | 'AGENCY';

export interface PriceRow {
  id: string;
  regionCode: string;
  regionName: string;
  group: string;
  nameAsWritten: string;
  nameEn: string;
  unitAsWritten: string;
  priceAsWritten: string;
  unitNormalized: string;
  priceNormalized: string;
  validYear: string;
  sourceDoc: string;
  sourceUrl: string;
  sourcePage: string;
  status: PriceStatus;
  notes: string;
  importedBy: string | null;
  importedAt: string | null;
}

export interface FoundPrice {
  row: PriceRow;
  priceIdr: number;
  status: PriceStatus;
  how: 'AGENCY_BOOK' | 'SAME_REGION' | 'OTHER_REGION_IKK';
  note: string | null;
}

export type Lookup = { found: FoundPrice } | { missing: string };

export interface LookupInput {
  regionCode: string;
  match: (row: PriceRow) => boolean;
  agencyBook: PriceRow[];
  regional: PriceRow[];
  /** TODO_VERIFY rows an OM has confirmed. Every other TODO_VERIFY row stays out of the sums. */
  confirmedIds: ReadonlySet<string>;
  ikk: (regionCode: string) => number | null;
  documentToLoad: string;
}

const usable = (row: PriceRow, confirmed: ReadonlySet<string>) => row.status !== 'TODO_VERIFY' || confirmed.has(row.id);
const num = (row: PriceRow) => Number(row.priceNormalized);

/** The order of README §4: agency book, same region, other region × IKK (ASSUMED), else nothing. */
export function lookupPrice(input: LookupInput): Lookup {
  const own = input.agencyBook.find((r) => r.regionCode === input.regionCode && input.match(r) && usable(r, input.confirmedIds));
  if (own) return { found: { row: own, priceIdr: num(own), status: own.status === 'TODO_VERIFY' ? 'OFFICIAL' : own.status, how: 'AGENCY_BOOK', note: null } };
  const same = input.regional.find((r) => r.regionCode === input.regionCode && input.match(r) && usable(r, input.confirmedIds));
  if (same) return { found: { row: same, priceIdr: num(same), status: same.status, how: 'SAME_REGION', note: null } };
  const target = input.ikk(input.regionCode);
  if (target !== null) {
    for (const other of input.regional.filter((r) => r.regionCode !== input.regionCode && input.match(r) && usable(r, input.confirmedIds))) {
      const source = input.ikk(other.regionCode);
      if (source === null) continue;
      return { found: { row: other, priceIdr: Math.round(num(other) * (target / source)), status: 'ASSUMED', how: 'OTHER_REGION_IKK', note: `Harga ${other.regionName} dikali IKK ${target} ÷ ${source}.` } };
    }
  }
  return { missing: input.documentToLoad };
}

export const OHP = { default: 0.1, max: 0.15 };
export const PPN_EFFECTIVE = 0.11;
/** Asphalt density, t/m³. ASSUMED, the same range as the v5 engine, until a job-mix formula is given. */
export const DENSITY = { low: 2.25, mid: 2.295, high: 2.34 };
/** Minimum wearing course (Spec 2018 rev.2 via ahsp_items.json, OFFICIAL). */
export const MIN_AC_WC_CM = 4;

export type OptionKey = 'HOT_MIX_PATCH' | 'COLD_MIX_PATCH' | 'FAST_TRACK_CONCRETE' | 'CONCRETE_K350' | 'AC_WC_OVERLAY';

export const OPTION_LABEL: Record<OptionKey, string> = {
  HOT_MIX_PATCH: 'Tambal aspal panas (AC-WC)',
  COLD_MIX_PATCH: 'Tambal aspal dingin',
  FAST_TRACK_CONCRETE: 'Beton cepat kering',
  CONCRETE_K350: 'Beton semen K-350',
  AC_WC_OVERLAY: 'Lapis ulang AC-WC'
};

export interface Coefficients {
  /** Rupiah of labour and equipment per unit of material, from an official AHSP. Absent until loaded. */
  labourPerUnitIdr?: number;
  equipmentPerUnitIdr?: number;
  source: string;
}

export interface OptionInput {
  key: OptionKey;
  price: Lookup;
  /** Shown when the price needs an OM's choice first (two AC-WC lines). */
  choices?: FoundPrice[];
  coefficients?: Coefficients | null;
  /** Service life from PINN, months. Null when no model covers this material. */
  lifeMonths: { low: number; mid: number; high: number } | null;
  lifeNote: string;
}

export interface Measure { areaM2: number; depthCm: number }

export interface Range { low: number; mid: number; high: number }

export interface OptionResult {
  key: OptionKey;
  label: string;
  status: 'COMPUTED' | 'PRICE_NOT_AVAILABLE' | 'NEEDS_OM_CHOICE';
  documentToLoad: string | null;
  quantity: { amount: Range; unit: string; how: string } | null;
  price: FoundPrice | null;
  choices: { name: string; priceIdr: number; page: string; costMid: number }[];
  materialIdr: Range | null;
  labourIdr: Range | null;
  equipmentIdr: Range | null;
  includesLabourEquipment: boolean;
  totalIdr: Range | null;
  lifeMonths: Range | null;
  lifeNote: string;
  costPerYearIdr: Range | null;
  lasts: boolean;
  best: boolean;
}

const r = (n: number) => Math.round(n);

/** Quantity from the measurement. Nothing here rounds until the end. */
export function quantityFor(key: OptionKey, m: Measure): { amount: Range; unit: string; how: string } {
  if (key === 'FAST_TRACK_CONCRETE' || key === 'CONCRETE_K350') {
    const v = m.areaM2 * (m.depthCm / 100);
    return { amount: { low: v, mid: v, high: v }, unit: 'm³', how: `Luas ${m.areaM2} m² × dalam ${m.depthCm} cm` };
  }
  const depth = key === 'AC_WC_OVERLAY' ? MIN_AC_WC_CM : Math.max(m.depthCm, MIN_AC_WC_CM);
  const v = m.areaM2 * (depth / 100);
  return { amount: { low: v * DENSITY.low, mid: v * DENSITY.mid, high: v * DENSITY.high }, unit: 'ton', how: `Luas ${m.areaM2} m² × tebal ${depth} cm × kepadatan ${DENSITY.low}-${DENSITY.high} t/m³ (asumsi)` };
}

const withOverhead = (direct: Range): Range => ({
  low: r(direct.low * (1 + OHP.default) * (1 + PPN_EFFECTIVE)),
  mid: r(direct.mid * (1 + OHP.default) * (1 + PPN_EFFECTIVE)),
  high: r(direct.high * (1 + OHP.max) * (1 + PPN_EFFECTIVE))
});

const totalFor = (price: number, amount: Range, c?: Coefficients | null) => {
  const mat = { low: price * amount.low, mid: price * amount.mid, high: price * amount.high };
  const lab = c?.labourPerUnitIdr ? { low: c.labourPerUnitIdr * amount.low, mid: c.labourPerUnitIdr * amount.mid, high: c.labourPerUnitIdr * amount.high } : null;
  const eq = c?.equipmentPerUnitIdr ? { low: c.equipmentPerUnitIdr * amount.low, mid: c.equipmentPerUnitIdr * amount.mid, high: c.equipmentPerUnitIdr * amount.high } : null;
  const direct = { low: mat.low + (lab?.low ?? 0) + (eq?.low ?? 0), mid: mat.mid + (lab?.mid ?? 0) + (eq?.mid ?? 0), high: mat.high + (lab?.high ?? 0) + (eq?.high ?? 0) };
  return { mat, lab, eq, total: withOverhead(direct) };
};

/** "Lasts" means at least a year in the middle estimate; a cheap patch that fails in months does not win. */
export const LASTS_MONTHS = 12;

export function compareOptions(inputs: OptionInput[], m: Measure): OptionResult[] {
  const results: OptionResult[] = inputs.map((o) => {
    const base = { key: o.key, label: OPTION_LABEL[o.key], lifeNote: o.lifeNote, lifeMonths: o.lifeMonths, includesLabourEquipment: !!(o.coefficients?.labourPerUnitIdr && o.coefficients.equipmentPerUnitIdr), lasts: false, best: false };
    const empty = { quantity: null, price: null, materialIdr: null, labourIdr: null, equipmentIdr: null, totalIdr: null, costPerYearIdr: null };
    const q = quantityFor(o.key, m);
    if (o.choices && o.choices.length > 1) {
      return { ...base, ...empty, quantity: q, status: 'NEEDS_OM_CHOICE' as const, documentToLoad: null, choices: o.choices.map((c) => ({ name: c.row.nameAsWritten, priceIdr: c.priceIdr, page: c.row.sourcePage, costMid: totalFor(c.priceIdr, q.amount).total.mid })) };
    }
    if ('missing' in o.price) return { ...base, ...empty, status: 'PRICE_NOT_AVAILABLE' as const, documentToLoad: o.price.missing, choices: [] };
    const { mat, lab, eq, total } = totalFor(o.price.found.priceIdr, q.amount, o.coefficients);
    const perYear = o.lifeMonths && o.lifeMonths.mid > 0 ? { low: r(total.low / (o.lifeMonths.high / 12)), mid: r(total.mid / (o.lifeMonths.mid / 12)), high: r(total.high / (Math.max(o.lifeMonths.low, 1) / 12)) } : null;
    return { ...base, status: 'COMPUTED' as const, documentToLoad: null, choices: [], quantity: q, price: o.price.found, materialIdr: { low: r(mat.low), mid: r(mat.mid), high: r(mat.high) }, labourIdr: lab && { low: r(lab.low), mid: r(lab.mid), high: r(lab.high) }, equipmentIdr: eq && { low: r(eq.low), mid: r(eq.mid), high: r(eq.high) }, totalIdr: total, costPerYearIdr: perYear, lasts: !!o.lifeMonths && o.lifeMonths.mid >= LASTS_MONTHS };
  });
  const eligible = results.filter((x) => x.lasts && x.costPerYearIdr);
  const best = [...eligible].sort((a, b) => a.costPerYearIdr!.mid - b.costPerYearIdr!.mid)[0];
  if (best) best.best = true;
  return results;
}

export const CLARIFY_PCT = 20;

/** Against the computed range. More than 20% outside is a question for the auditor, never an accusation. */
export function compareSubmitted(submittedIdr: number, range: Range) {
  const nearest = submittedIdr > range.high ? range.high : submittedIdr < range.low ? range.low : null;
  const differencePct = nearest === null ? 0 : Math.round((Math.abs(submittedIdr - nearest) / nearest) * 1000) / 10;
  return { submittedIdr, range, differencePct, needsClarification: differencePct > CLARIFY_PCT };
}

export interface ImportProblem { line: number; problem: string }

export const REQUIRED_COLUMNS = ['region_code', 'region_name', 'item_group', 'item_name_as_written', 'unit_as_written', 'price_idr', 'valid_year', 'source_doc'] as const;
export const KNOWN_UNITS = ['ton', 'kg', 'liter', 'm3', 'm2', 'm', 'zak', 'sak', 'batang', 'oh', 'jam', 'titik', 'sampel', 'kg (as written)'];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Refuses what cannot be used; warns about what looks odd against the same item elsewhere (README §5). */
export function validateImport(rows: Record<string, string>[], header: string[], others: PriceRow[]): { problems: ImportProblem[]; warnings: ImportProblem[] } {
  const problems: ImportProblem[] = [];
  const warnings: ImportProblem[] = [];
  for (const col of REQUIRED_COLUMNS) if (!header.includes(col)) problems.push({ line: 1, problem: `Kolom "${col}" tidak ada.` });
  if (problems.length) return { problems, warnings };
  rows.forEach((row, i) => {
    const line = i + 2;
    for (const col of REQUIRED_COLUMNS) if (!String(row[col] ?? '').trim()) problems.push({ line, problem: `Kolom "${col}" kosong.` });
    const price = Number(row.price_idr);
    if (!Number.isFinite(price) || price <= 0) problems.push({ line, problem: 'Harga harus angka lebih dari 0.' });
    if (row.unit_as_written && !KNOWN_UNITS.includes(row.unit_as_written.trim().toLowerCase())) problems.push({ line, problem: `Satuan "${row.unit_as_written}" tidak dikenal.` });
    const same = others.filter((o) => o.nameAsWritten.toLowerCase() === String(row.item_name_as_written).trim().toLowerCase()).map((o) => Number(o.priceNormalized));
    if (same.length && Number.isFinite(price)) {
      const mid = median(same);
      if (price > mid * 3 || price < mid * 0.3) warnings.push({ line, problem: `Harga ini jauh dari median wilayah lain (Rp ${mid.toLocaleString('id-ID')}). Mohon diperiksa.` });
    }
  });
  return { problems, warnings };
}

/** Grades where a stronger mix costs less. Shown as written, and only ever a note for the agency. */
export function nonMonotonicKSeries(rows: PriceRow[]): string[] {
  const notes: string[] = [];
  const regions = [...new Set(rows.map((r2) => r2.regionCode))];
  for (const region of regions) {
    const list = rows.filter((x) => x.regionCode === region && x.group === 'concrete_readymix' && /^Beton Ready Mix(ed)?[,\s-]*K[.\s-]*\d+$/i.test(x.nameAsWritten.trim()));
    const graded = list.map((x) => ({ k: Number(x.nameAsWritten.match(/(\d+)\s*$/)![1]), price: Number(x.priceNormalized), name: x.regionName })).sort((a, b) => a.k - b.k);
    for (let i = 1; i < graded.length; i++) {
      if (graded[i].price < graded[i - 1].price) notes.push(`${graded[i].name}: K-${graded[i].k} tertulis lebih murah dari K-${graded[i - 1].k}. Catatan untuk instansi, bukan tuduhan.`);
    }
  }
  return notes;
}
