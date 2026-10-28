/**
 * E3 — structural assessment for the Field Engineer (Dokumen Induk v3 §3.4, §4.4).
 *
 * Calls POST /api/engine/assess: critical strains from the layered-elastic solver (PyMastic) and
 * the indicative life index P10/P50/P90, dry vs wet, from a Monte Carlo run on the PI-surrogate
 * (OpenVINO). Every input shows where it came from; nothing is computed in the browser.
 */
import React, { useState } from 'react';
import type { AssessmentInputs } from '../../domain/intelligence/assessment';
import type { EngineAssessRequest, EngineAssessResult, MonteCarloCondition } from '../../types';
import { PinnDecisionCard } from './PinnDecisionCard';

const card = 'rounded-2xl border border-white/10 bg-surface p-4 space-y-3';
const tag = 'inline-block rounded border px-2 py-1 text-xs font-bold tracking-wide';
const fmt = (v: number, digits = 2) => v.toLocaleString('id-ID', { maximumFractionDigits: digits });
/** Life in years: two significant digits below 1 year so short lives never print as 0. */
const fmtLife = (v: number) => (v < 1 ? v.toLocaleString('id-ID', { maximumSignificantDigits: 2 }) : fmt(v, 1));
const sci = (v: number) => v.toExponential(2).replace('e+', '×10^');

interface FieldDef {
  key: keyof Inputs;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

interface Inputs {
  h1: number; E1: number; h2: number; E2: number; cbr: number; axle: number;
  esal10: number; esal50: number; esal90: number;
}

const FIELDS: FieldDef[] = [
  { key: 'h1', label: 'Tebal aspal h1', unit: 'mm', min: 50, max: 250, step: 5 },
  { key: 'E1', label: 'Modulus aspal E1', unit: 'MPa', min: 1000, max: 5000, step: 100 },
  { key: 'h2', label: 'Tebal base h2', unit: 'mm', min: 100, max: 400, step: 10 },
  { key: 'E2', label: 'Modulus base E2', unit: 'MPa', min: 100, max: 500, step: 10 },
  { key: 'cbr', label: 'CBR tanah dasar', unit: '%', min: 1, max: 15, step: 0.5 },
  { key: 'axle', label: 'Beban sumbu (roda ganda)', unit: 't', min: 6, max: 25, step: 0.01 },
  { key: 'esal10', label: 'ESAL/hari P10', unit: '', min: 1, max: 100000, step: 10 },
  { key: 'esal50', label: 'ESAL/hari P50', unit: '', min: 1, max: 100000, step: 10 },
  { key: 'esal90', label: 'ESAL/hari P90', unit: '', min: 1, max: 100000, step: 10 }
];

/** Which inputs came from the segment record (synthetic pilot attributes) vs assumed defaults. */
const FROM_SEGMENT = new Set<keyof Inputs>(['h1', 'E1', 'cbr']);

export function initialInputs(baseline: AssessmentInputs): Inputs {
  return {
    h1: Math.min(250, Math.max(50, baseline.asphaltThicknessCm * 10)),
    E1: Math.min(5000, Math.max(1000, baseline.asphaltModulusMpa)),
    h2: 150,
    E2: 200,
    cbr: Math.min(15, Math.max(1, baseline.subgradeCbrPercent)),
    axle: 8.16,
    // Illustrative traffic range (v3 reference example), ASSUMED until Module E counts exist.
    esal10: 1360,
    esal50: 2000,
    esal90: 2930
  };
}

export function buildRequest(segmentId: string, v: Inputs, criterion: 'AI' | 'AUS'): EngineAssessRequest {
  const src = (k: keyof Inputs) => (FROM_SEGMENT.has(k) ? 'SEGMENT_RECORD (SYNTHETIC)' : 'ASSUMED');
  return {
    segment_id: segmentId,
    layers: [
      { h_mm: v.h1, E_mpa: v.E1, nu: 0.35, source: src('h1') },
      { h_mm: v.h2, E_mpa: v.E2, nu: 0.35, source: src('h2') }
    ],
    subgrade: { cbr: v.cbr, state: 'dry' },
    load: { axle_t: v.axle, q_mpa: 0.55, dual_spacing_mm: 330 },
    traffic: { esal_day_p10: v.esal10, esal_day_p50: v.esal50, esal_day_p90: v.esal90, growth: 0.04 },
    criterion,
    n_mc: 2000
  };
}

const LifeRow: React.FC<{ label: string; mc: MonteCarloCondition; scaleMax: number }> = ({ label, mc, scaleMax }) => {
  if (mc.status !== 'COMPUTED' || !mc.life_years) {
    return (
      <tr className="border-t border-white/5">
        <th scope="row" className="py-1 pr-2 text-left font-medium text-slate-300">{label}</th>
        <td colSpan={4} className="py-1 text-amber-200">{mc.status}: {mc.message}</td>
      </tr>
    );
  }
  const { p10, p50, p90 } = mc.life_years;
  const pct = (x: number) => `${Math.min(100, (x / scaleMax) * 100)}%`;
  return (
    <tr className="border-t border-white/5">
      <th scope="row" className="py-1 pr-2 text-left font-medium text-slate-300">{label}</th>
      <td className="py-1 pr-2 font-mono text-slate-200">{fmtLife(p10)}</td>
      <td className="py-1 pr-2 font-mono font-bold text-white">{fmtLife(p50)}</td>
      <td className="py-1 pr-2 font-mono text-slate-200">{fmtLife(p90)}</td>
      <td className="py-1 w-1/3" aria-hidden="true">
        <div className="relative h-2 rounded bg-white/5">
          <div className="absolute h-2 rounded bg-sky-400/50" style={{ left: pct(p10), width: `calc(${pct(p90)} - ${pct(p10)})` }} />
          <div className="absolute h-2 w-1 bg-white" style={{ left: pct(p50) }} />
        </div>
      </td>
    </tr>
  );
};

const SENSITIVITY_LABEL: Record<string, string> = {
  h1: 'Tebal aspal', h2: 'Tebal base', E1: 'Modulus aspal', E2: 'Modulus base', subgrade_cbr: 'CBR tanah dasar', traffic: 'Lalu lintas'
};

const Tornado: React.FC<{ rho: Record<string, number> }> = ({ rho }) => {
  const rows = Object.entries(rho).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return (
    <ul className="space-y-1" aria-label="Sensitivitas (korelasi Spearman dengan umur)">
      {rows.map(([k, v]) => (
        <li key={k} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-2 text-xs">
          <span className="text-slate-300">{SENSITIVITY_LABEL[k] ?? k}</span>
          <span className="relative h-2 rounded bg-white/5" aria-hidden="true">
            <span
              className={`absolute h-2 rounded ${v >= 0 ? 'bg-emerald-400/70' : 'bg-rose-400/70'}`}
              style={v >= 0 ? { left: '50%', width: `${Math.abs(v) * 50}%` } : { right: '50%', width: `${Math.abs(v) * 50}%` }}
            />
            <span className="absolute left-1/2 h-2 w-px bg-white/30" />
          </span>
          <span className="font-mono text-right text-slate-200">{v > 0 ? '+' : ''}{fmt(v)}</span>
        </li>
      ))}
    </ul>
  );
};

export const StructuralAssessmentPanel: React.FC<{
  segmentId: string;
  baseline: AssessmentInputs;
  onRun: (body: EngineAssessRequest) => Promise<EngineAssessResult>;
}> = ({ segmentId, baseline, onRun }) => {
  const [values, setValues] = useState<Inputs>(() => initialInputs(baseline));
  const [criterion, setCriterion] = useState<'AI' | 'AUS'>('AI');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EngineAssessResult | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await onRun(buildRequest(segmentId, values, criterion)));
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mc = result?.monte_carlo && 'dry' in result.monte_carlo ? result.monte_carlo : null;
  const scaleMax = mc ? Math.max(mc.dry.life_years?.p90 ?? 0, mc.wet.life_years?.p90 ?? 0) * 1.1 || 1 : 1;

  return (
    <section className={card} aria-label="Penilaian struktural">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-white">Penilaian struktural (MLET + PI-surrogate)</h3>
        <span className={`${tag} border-sky-400/60 text-sky-200 bg-sky-400/10`}>COMPUTED · indikatif, bukan desain</span>
      </div>
      <p className="text-xs text-slate-400">
        Regangan kritis dari teori elastis berlapis (PyMastic). Indeks Umur dari Monte Carlo 2.000 sampel pada PI-surrogate (OpenVINO),
        kering vs basah. Dipakai untuk membandingkan ruas dan opsi, bukan meramal tanggal kerusakan.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-xs text-slate-300">
            <span className="flex justify-between gap-1">
              <span>{f.label}{f.unit && ` (${f.unit})`}</span>
              <span className={FROM_SEGMENT.has(f.key) ? 'text-slate-500' : 'text-amber-300/80'}>{FROM_SEGMENT.has(f.key) ? 'data ruas' : 'ASSUMED'}</span>
            </span>
            <input
              type="number"
              aria-label={`${f.label}${f.unit ? ` (${f.unit})` : ''}`}
              min={f.min}
              max={f.max}
              step={f.step}
              value={values[f.key]}
              onChange={(e) => setValues({ ...values, [f.key]: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-white/15 bg-elevated px-2 py-1 font-mono text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
            />
          </label>
        ))}
        <label className="block text-xs text-slate-300">
          Kriteria fungsi transfer
          <select
            value={criterion}
            onChange={(e) => setCriterion(e.target.value as 'AI' | 'AUS')}
            className="mt-1 w-full rounded-lg border border-white/15 bg-elevated px-2 py-1 text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
          >
            <option value="AI">Asphalt Institute (1982)</option>
            <option value="AUS">Austroads (bentuk 2004)</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          aria-busy={busy}
          className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 disabled:opacity-60 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 transition-colors"
        >
          {busy ? 'Menghitung…' : 'Hitung penilaian'}
        </button>
        <button type="button" onClick={() => { setValues(initialInputs(baseline)); setResult(null); setError(null); }} className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 transition-colors">
          Kembalikan input awal
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-rose-200">Penilaian gagal: {error}</p>}
      {/* Plain-language decisions first; the technical numbers follow for the engineer. */}
      <PinnDecisionCard base={buildRequest(segmentId, values, criterion)} />
      {result && (
        <div className="space-y-3" role="status">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['εt dasar aspal', `${fmt(result.mlet.et_ue, 1)} µε`],
              ['εv puncak tanah dasar', `${fmt(result.mlet.ev_ue, 1)} µε`],
              ['Nf / Nd', `${sci(result.allowable.nf)} / ${sci(result.allowable.nd)}`],
              ['Penentu', result.allowable.governing === 'fatigue' ? 'Retak lelah' : 'Alur (rutting)']
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-white/10 bg-elevated p-2">
                <p className="text-xs text-slate-400">{k}</p>
                <p className="text-sm font-semibold text-white">{v}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            {result.mlet.method}, {fmt(result.mlet.elapsed_ms, 1)} ms · E tanah dasar {fmt(result.subgrade_E_mpa, 0)} MPa · kriteria {result.allowable.criterion}
          </p>

          {mc ? (
            <>
              <table className="w-full text-xs">
                <caption className="pb-1 text-left text-xs font-semibold text-slate-200">Indeks Umur Struktural (tahun)</caption>
                <thead>
                  <tr className="text-slate-400">
                    <th scope="col" className="text-left font-medium">Kondisi</th>
                    <th scope="col" className="text-left font-medium">P10</th>
                    <th scope="col" className="text-left font-medium">P50</th>
                    <th scope="col" className="text-left font-medium">P90</th>
                    <th scope="col" className="text-left font-medium"><span className="sr-only">Rentang</span></th>
                  </tr>
                </thead>
                <tbody>
                  <LifeRow label="Kering" mc={mc.dry} scaleMax={scaleMax} />
                  <LifeRow label="Basah" mc={mc.wet} scaleMax={scaleMax} />
                </tbody>
              </table>
              {mc.dry.sensitivity_spearman && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-200">Yang paling memengaruhi umur (kering)</p>
                  <Tornado rho={mc.dry.sensitivity_spearman} />
                </div>
              )}
              <p className="text-xs text-slate-500">
                {result.surrogate ? `${result.surrogate.version} ${result.surrogate.precision.toUpperCase()} di OpenVINO ${result.surrogate.openvino_version.split('-')[0]} (${result.surrogate.device})` : 'Surrogate tidak dipakai'}
                {mc.dry.crosscheck && ` · uji silang PyMastic ${mc.dry.crosscheck.n} sampel, galat maks ${fmt(mc.dry.crosscheck.max_err_pct)}%`}
                {` · ${fmt(mc.elapsed_ms, 0)} ms total`}
              </p>
            </>
          ) : (
            result.monte_carlo && 'message' in result.monte_carlo && (
              <p className="text-xs text-amber-200">Monte Carlo tidak dijalankan: {result.monte_carlo.message}</p>
            )
          )}

          {result.assumptions.length > 0 && (
            <details className="text-xs text-slate-400">
              <summary className="cursor-pointer text-slate-300">Asumsi ({result.assumptions.length})</summary>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {result.assumptions.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
};
