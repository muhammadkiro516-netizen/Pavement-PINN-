/**
 * Fair-cost engine, Route B (06_COST_ENGINE.md §3-§9). Official AHSP coefficients are not loaded,
 * so every result is INDICATIVE and says what it leaves out. Nothing here is guessed: each input
 * carries a status and a source, and unknown lines are excluded by name, never filled in.
 * The result is a question for the agency, not an audit finding.
 */
export const COST_ENGINE_VERSION = 'cost-engine 1.0.0';
export const PRICE_TABLE_VERSION = 'jkt-2026-11-01';
export const DEFAULT_THRESHOLD_PCT = 20;

export type InputStatus = 'MEASURED' | 'OFFICIAL' | 'INPUT' | 'ASSUMED' | 'AI_ESTIMATE' | 'TODO_VERIFY' | 'COMPUTED';
export interface Triple { low: number; mid: number; high: number }

// Prices from docs/v5/data/material_prices.csv (ids in the source text), checked by a test.
const UNIT_PRICE_ACWC: Triple = { low: 1248991.42, mid: 1254346.42, high: 1381217.0 };
const ASPHALT_DELTA_PER_KG = 11565 - 9400; // Pertamina RU IV Cilacap, Mar to Apr 2026.
const ASPHALT_KG_PER_TON = { mid: 57, high: 61.71 };
const CUT_PROXY_PER_M3 = 169737.46;
const DENSITY: Triple = { low: 2.25, mid: 2.295, high: 2.34 };
const CUT_MARGIN_M = 0.3;
const OHP_RATIO_HIGH = 1.15 / 1.1;
const PPN_EFFECTIVE = 0.11;
const MIN_THICKNESS_CM = { AC_WC: 4.0, AC_BC: 6.0, AC_BASE: 7.5 } as const;

export type Mix = 'AC_WC' | 'COLD_MIX';
export const EXCLUDED_LINES = ['7.1.(2a) tack coat', 'mobilisation', 'traffic management', 'SMKK'];

export interface CostInput {
  key: string;
  label: string;
  unit: string;
  status: InputStatus;
  source: string;
  value?: number;
  low?: number;
  mid?: number;
  high?: number;
  todo?: string;
}

export interface CostRequest {
  caseId: string;
  mode: 'SINGLE' | 'TRACE';
  mix: Mix;
  /** Pothole: damage length and width. Long damage: trace length and lane width. */
  lengthM: number | Triple;
  widthM: number | Triple;
  /** Deepest ruler reading. Null for damage without a depth measure. */
  depthCm: number | null;
  sizeStatus: InputStatus;
  sizeSource: string;
  depthStatus?: InputStatus;
  regionName: string;
  /** Prices are Jakarta study values; elsewhere they are a stand-in and the result says so. */
  regionIsJakarta: boolean;
  reportedSpendIdr?: number | null;
  reportedSource?: string;
  thresholdPct?: number;
}

export interface CostResult {
  caseId: string;
  engineVersion: string;
  priceTableVersion: string;
  route: 'B_PER_TON_FALLBACK';
  basis: 'INDICATIVE';
  completeness: { complete: boolean; excluded: string[] };
  quantity: { item: string; unit: string; qPay: Triple; tons: Triple; areaCutM2: Triple; depthRepairCm: number };
  /** Null when no price exists for the chosen mix: never estimated from nothing. */
  fairCostIdr: Triple | null;
  lines: { id: string; item: string; idr: Triple | null; status: InputStatus; sourceToFetch?: string }[];
  inputs: CostInput[];
  warnings: string[];
  comparison: { reportedSpendIdr: number; reportedStatus: 'INPUT'; reportedSource: string; diffPct: number; thresholdPct: number; insideRange: boolean; result: 'WITHIN_RANGE' | 'NEEDS_CLARIFICATION'; label_en: string; label_id: string; topDrivers: string[] } | null;
  label: string;
  disclaimer_id: string;
}

const toTriple = (v: number | Triple): Triple => (typeof v === 'number' ? { low: v, mid: v, high: v } : v);
const round = (n: number) => Math.round(n);
const roundTriple = (t: Triple): Triple => ({ low: round(t.low), mid: round(t.mid), high: round(t.high) });
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function fairCost(req: CostRequest): CostResult {
  const length = toTriple(req.lengthM);
  const width = toTriple(req.widthM);
  const tMin = MIN_THICKNESS_CM.AC_WC;
  const dRep = Math.max(req.depthCm ?? 0, tMin);

  // Cut-out (06 §4): a pothole gets a margin on all sides; a long full-lane strip only at the ends.
  const lengthCut = (k: keyof Triple) => length[k] + 2 * CUT_MARGIN_M;
  const widthCut = (k: keyof Triple) => (req.mode === 'TRACE' ? width[k] : width[k] + 2 * CUT_MARGIN_M);
  const areaCut: Triple = { low: lengthCut('low') * widthCut('low'), mid: lengthCut('mid') * widthCut('mid'), high: lengthCut('high') * widthCut('high') };
  const qPay: Triple = { low: (areaCut.low * dRep) / 100, mid: (areaCut.mid * dRep) / 100, high: (areaCut.high * dRep) / 100 };
  const tons: Triple = { low: qPay.low * DENSITY.low, mid: qPay.mid * DENSITY.mid, high: qPay.high * DENSITY.high };

  const escalation = { low: 0, mid: ASPHALT_DELTA_PER_KG * ASPHALT_KG_PER_TON.mid, high: ASPHALT_DELTA_PER_KG * ASPHALT_KG_PER_TON.high };

  const inputs: CostInput[] = [
    { key: 'L', label: req.mode === 'TRACE' ? 'Length of damage' : 'Damage length', unit: 'm', status: req.sizeStatus, source: req.sizeSource, ...length },
    { key: 'W', label: req.mode === 'TRACE' ? 'Lane width' : 'Damage width', unit: 'm', status: req.mode === 'TRACE' ? 'ASSUMED' : req.sizeStatus, source: req.mode === 'TRACE' ? 'Default lane width 3.5 m unless the inspector measured it' : req.sizeSource, ...width },
    { key: 'd_meas', label: 'Deepest point', unit: 'cm', status: req.depthCm === null ? 'TODO_VERIFY' : req.depthStatus ?? 'MEASURED', source: req.depthCm === null ? 'No depth recorded' : 'Ruler-at-deepest-point photo, typed by the inspector', value: req.depthCm ?? undefined },
    { key: 'cut_margin', label: 'Cut margin each side', unit: 'm', status: 'ASSUMED', source: 'Common practice; Spec 2018 Rev 2 Seksi 11.1 not retrieved', value: CUT_MARGIN_M },
    { key: 't_min_acwc', label: 'Minimum AC-WC thickness', unit: 'cm', status: 'OFFICIAL', source: 'Bina Marga SKh-1.6.27 (2019); BPK Malut Buku Saku', value: tMin },
    { key: 'rho', label: 'Compacted density', unit: 't/m³', status: 'ASSUMED', source: 'Field cores PNJ CMJ; Unibos 2026', todo: 'SE 30/2025 Tabel A.2.d', ...DENSITY },
    { key: 'f_loss', label: 'Material loss factor', unit: '×', status: 'TODO_VERIFY', source: 'Not applied. Source to fetch: SE 30/2025 Lampiran I/II', value: 1 },
    { key: 'unit_price_acwc', label: 'AC-WC unit price', unit: 'Rp/t', status: 'ASSUMED', source: 'Suryaman & Wacono, PNJ 2025, Jakarta parking-lot paving (UP-ACWC-JKT-2025)', ...UNIT_PRICE_ACWC },
    { key: 'asphalt_escalation', label: 'Asphalt price change', unit: 'Rp/t', status: 'ASSUMED', source: 'Pertamina RU IV Cilacap Mar to Apr 2026 via TIMES Indonesia; Jakarta supply point TODO_VERIFY', ...escalation },
    { key: 'cut_proxy', label: 'Cut-out proxy', unit: 'Rp/m³', status: 'ASSUMED', source: 'PNJ 2025 "Galian"; generic excavation, not saw-cutting', value: CUT_PROXY_PER_M3 },
    { key: 'ohp', label: 'Overhead and profit', unit: '%', status: 'OFFICIAL', source: 'SE DJBM 01/SE/Db/2019 (10%); Permen PUPR 8/2023 Ps 11(3) (up to 15%)', mid: 10, high: 15 },
    { key: 'ppn_eff', label: 'PPN, effective', unit: '%', status: 'OFFICIAL', source: 'PMK 131/2024 (12% × 11/12). Construction after the 2026 PMK: TODO_VERIFY', value: 11 }
  ];

  const warnings = [
    'Official AHSP 11.1.(9) coefficients not loaded (SE 30/SE/Dk/2025 Lampiran V).',
    'Material loss factor not applied (TODO_VERIFY).',
    'Unit prices dated 2025 predate the Apr 2026 Pertamina asphalt change; escalation applied (ASSUMED).'
  ];
  if (!req.regionIsJakarta) warnings.push(`Jakarta study prices used for ${req.regionName}: local SSH/HSPK not loaded (TODO_VERIFY), no IKK scaling available.`);
  if (req.sizeStatus !== 'MEASURED') warnings.push('Size not measured on site with a marker card, so the range is wider.');

  const quantity = { item: req.mode === 'TRACE' ? '7.3.(5a)' : '11.1.(9)', unit: 'm3', qPay: { low: round4(qPay.low), mid: round4(qPay.mid), high: round4(qPay.high) }, tons: { low: round4(tons.low), mid: round4(tons.mid), high: round4(tons.high) }, areaCutM2: { low: round4(areaCut.low), mid: round4(areaCut.mid), high: round4(areaCut.high) }, depthRepairCm: dRep };
  const tackLine = { id: 'tack', item: '7.1.(2a) tack coat', idr: null, status: 'TODO_VERIFY' as const, sourceToFetch: 'SE 30/SE/Dk/2025 Lampiran V; Spec 2018 Rev 2 Seksi 7.1' };
  const base = { caseId: req.caseId, engineVersion: COST_ENGINE_VERSION, priceTableVersion: PRICE_TABLE_VERSION, route: 'B_PER_TON_FALLBACK' as const, basis: 'INDICATIVE' as const, quantity, inputs, disclaimer_id: 'Estimasi biaya wajar berdasarkan AHSP/asumsi model; bukan temuan audit.' };

  if (req.mix !== 'AC_WC') {
    return {
      ...base,
      completeness: { complete: false, excluded: ['all lines: no cold-mix price loaded', ...EXCLUDED_LINES] },
      fairCostIdr: null,
      lines: [{ id: 'coldmix', item: '11.1.(11) CPHMA', idr: null, status: 'TODO_VERIFY', sourceToFetch: 'SE 30/SE/Dk/2025 Lampiran V; local HSPK' }, tackLine],
      warnings: [...warnings, 'No sourced cold-mix price is loaded, so no range is shown.'],
      comparison: null,
      label: 'Not computed: cold-mix price not loaded (TODO_VERIFY).'
    };
  }

  const hotmix: Triple = {
    low: tons.low * (UNIT_PRICE_ACWC.low + escalation.low),
    mid: tons.mid * (UNIT_PRICE_ACWC.mid + escalation.mid),
    high: tons.high * (UNIT_PRICE_ACWC.high + escalation.high) * OHP_RATIO_HIGH
  };
  const cutout: Triple = { low: qPay.low * CUT_PROXY_PER_M3, mid: qPay.mid * CUT_PROXY_PER_M3, high: qPay.high * CUT_PROXY_PER_M3 * OHP_RATIO_HIGH };
  const subtotal: Triple = { low: hotmix.low + cutout.low, mid: hotmix.mid + cutout.mid, high: hotmix.high + cutout.high };
  const ppn: Triple = { low: subtotal.low * PPN_EFFECTIVE, mid: subtotal.mid * PPN_EFFECTIVE, high: subtotal.high * PPN_EFFECTIVE };
  const fair: Triple = { low: subtotal.low + ppn.low, mid: subtotal.mid + ppn.mid, high: subtotal.high + ppn.high };
  const fairCostIdr = roundTriple(fair);

  const thresholdPct = req.thresholdPct ?? DEFAULT_THRESHOLD_PCT;
  let comparison: CostResult['comparison'] = null;
  if (typeof req.reportedSpendIdr === 'number' && req.reportedSpendIdr > 0) {
    const diffPct = Math.round((((req.reportedSpendIdr - fairCostIdr.mid) / fairCostIdr.mid) * 100) * 10) / 10;
    const flagged = Math.abs(diffPct) > thresholdPct;
    comparison = {
      reportedSpendIdr: req.reportedSpendIdr,
      reportedStatus: 'INPUT',
      reportedSource: req.reportedSource ?? 'Typed by the responsible role',
      diffPct,
      thresholdPct,
      insideRange: req.reportedSpendIdr >= fairCostIdr.low && req.reportedSpendIdr <= fairCostIdr.high,
      result: flagged ? 'NEEDS_CLARIFICATION' : 'WITHIN_RANGE',
      // Route B is always indicative (06 §6).
      label_en: flagged ? 'Indicative difference — needs clarification' : 'Within the expected range',
      label_id: flagged ? 'Selisih indikatif — perlu klarifikasi' : 'Dalam kisaran wajar',
      topDrivers: ['unit_price_acwc', 'excluded: mobilisation', 'rho']
    };
  }

  return {
    ...base,
    completeness: { complete: false, excluded: EXCLUDED_LINES },
    fairCostIdr,
    lines: [
      { id: 'hotmix', item: '7.3.(5a) per-ton proxy', idr: roundTriple(hotmix), status: 'ASSUMED' },
      { id: 'cutout', item: 'galian proxy', idr: roundTriple(cutout), status: 'ASSUMED' },
      tackLine,
      { id: 'ppn', item: 'PPN 11%', idr: roundTriple(ppn), status: 'OFFICIAL' }
    ],
    warnings,
    comparison,
    label: 'Indicative: official AHSP coefficients not loaded; excludes tack coat, mobilisation, traffic management, SMKK.'
  };
}

export const IDR_THRESHOLD_NOTE = 'A difference above 20% (configurable) is a neutral question to the agency, never a finding.';
