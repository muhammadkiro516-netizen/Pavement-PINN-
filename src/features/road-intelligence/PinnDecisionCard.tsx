/**
 * PINN decision card (docs/LEAN_PLAN.md "AI engines"): four questions a road authority asks,
 * answered in plain Indonesian from real runs of the PINN surrogate / MLET service.
 *
 * Every scenario is compared through the allowable load repetitions of the governing
 * criterion (fatigue or rutting) from the computed strains, so no traffic data is needed:
 * "how many passes can this structure take" is physics, not a guess about the traffic.
 */
import React, { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { EngineAssessRequest, EngineAssessResult } from '../../types';

/** Standard axle (Bina Marga / AASHTO 8.16 t) and an overloaded (ODOL) axle, 1.6 x. */
export const LEGAL_AXLE_T = 8.16;
export const ODOL_AXLE_T = 13;
/** Asphalt modulus of a new AC-WC overlay / reconstruction layer (MPa). */
const NEW_AC_MPA = 4000;

export interface DecisionScenario {
  key: 'base' | 'legal' | 'odol' | 'wet' | 'overlay' | 'recon';
  request: EngineAssessRequest;
}

/** The structural scenarios, derived from the engineer's own inputs (base request). */
export function decisionScenarios(base: EngineAssessRequest): DecisionScenario[] {
  const noTraffic = { ...base, traffic: undefined, n_mc: undefined };
  const [surface, ...rest] = base.layers;
  return [
    { key: 'base', request: base },
    { key: 'legal', request: { ...noTraffic, load: { ...base.load, axle_t: LEGAL_AXLE_T } } },
    { key: 'odol', request: { ...noTraffic, load: { ...base.load, axle_t: ODOL_AXLE_T } } },
    { key: 'wet', request: { ...noTraffic, subgrade: { ...base.subgrade, state: 'wet' } } },
    { key: 'overlay', request: { ...noTraffic, layers: [{ ...surface, h_mm: surface.h_mm + 50, E_mpa: Math.max(surface.E_mpa, 3000), source: 'SCENARIO: overlay AC-WC 5 cm' }, ...rest] } },
    { key: 'recon', request: { ...noTraffic, layers: [{ ...surface, h_mm: Math.max(surface.h_mm, 100), E_mpa: NEW_AC_MPA, source: 'SCENARIO: rekonstruksi lapis aspal' }, ...rest.map((l) => ({ ...l, h_mm: Math.max(l.h_mm, 300), source: 'SCENARIO: rekonstruksi lapis pondasi' }))] } }
  ];
}

/** Allowable repetitions of the governing criterion. */
export const allowableN = (r: EngineAssessResult) => Math.min(r.allowable.nf, r.allowable.nd);

export interface Decision {
  structural: boolean;
  governing: 'fatigue' | 'rutting';
  lifeP50: number | null;
  odolFactor: number;
  wetLossPct: number;
  overlayFactor: number;
  reconFactor: number;
  advice: 'RUTIN' | 'BERKALA' | 'REKONSTRUKSI';
}

/** Turns the scenario results into the four answers. Pure, unit-tested. */
export function decide(results: Record<DecisionScenario['key'], EngineAssessResult>): Decision {
  const base = results.base;
  const n = allowableN(base);
  const lifeP50 = base.life_years?.p50 ?? null;
  const overlayFactor = allowableN(results.overlay) / n;
  const reconFactor = allowableN(results.recon) / n;
  // Structural when the subgrade governs (rutting) or the remaining life is short: a surface patch
  // does not change the strains that cause the damage.
  const structural = base.allowable.governing === 'rutting' || (lifeP50 !== null && lifeP50 < 3);
  const advice: Decision['advice'] = !structural ? 'RUTIN' : overlayFactor >= 3 ? 'BERKALA' : 'REKONSTRUKSI';
  return {
    structural,
    governing: base.allowable.governing,
    lifeP50,
    odolFactor: allowableN(results.legal) / allowableN(results.odol),
    wetLossPct: Math.max(0, (1 - allowableN(results.wet) / n) * 100),
    overlayFactor,
    reconFactor,
    advice
  };
}

const ADVICE = {
  RUTIN: { title: 'Pemeliharaan rutin (tambal) cukup', text: 'Struktur jalan masih kuat; kerusakan ada di permukaan.' },
  BERKALA: { title: 'Pemeliharaan berkala: overlay', text: 'Tambal saja akan rusak lagi. Lapis tambahan 5 cm cukup memperkuat struktur.' },
  REKONSTRUKSI: { title: 'Rekonstruksi', text: 'Kerusakan ada di struktur. Tambal dan overlay tipis tidak akan bertahan lama.' }
} as const;

const x = (v: number) => (v >= 10 ? `${Math.round(v)}×` : `${v.toFixed(1)}×`);

export const PinnDecisionCard: React.FC<{ base: EngineAssessRequest; onRun: (body: EngineAssessRequest) => Promise<EngineAssessResult> }> = ({ base, onRun }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const results = {} as Record<DecisionScenario['key'], EngineAssessResult>;
      for (const s of decisionScenarios(base)) results[s.key] = await onRun(s.request);
      setDecision(decide(results));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl bg-[#1A1A1C] p-4 text-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-extrabold">Keputusan dengan PINN</p>
          <p className="text-sm text-white/60">Empat pertanyaan penanganan, dijawab dari perhitungan fisika jalan ini.</p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full bg-[#FFE14D] px-4 py-2.5 text-sm font-extrabold text-black disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {decision ? 'Hitung ulang' : 'Analisis'}
        </button>
      </div>
      {error && <p className="mt-3 rounded-2xl bg-rose-500/15 p-3 text-sm text-rose-200">Layanan PINN belum dapat dihubungi: {error}</p>}
      {decision && (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl bg-[#FFE14D] p-4 text-black">
            <p className="text-xs font-bold uppercase tracking-wide">Rekomendasi</p>
            <p className="text-xl font-extrabold">{ADVICE[decision.advice].title}</p>
            <p className="text-sm">{ADVICE[decision.advice].text}</p>
          </div>
          <Answer q="Rusak di permukaan atau di struktur?" a={decision.structural ? 'Indikasi kerusakan struktural' : 'Kerusakan permukaan'}>
            Bagian yang paling cepat gagal: {decision.governing === 'rutting' ? 'tanah dasar (amblas/alur roda)' : 'lapis aspal (retak lelah)'}.
            {decision.lifeP50 !== null && ` Perkiraan sisa umur (median) ${decision.lifeP50.toFixed(1)} tahun dengan lalu lintas yang diisi.`}
          </Answer>
          <Answer q="Seberapa parah truk kelebihan muatan (ODOL)?" a={`1 truk ODOL ≈ ${x(decision.odolFactor)} truk normal`}>
            Gandar {ODOL_AXLE_T} ton dibanding gandar standar {LEGAL_AXLE_T} ton, dari regangan yang dihitung untuk struktur ini.
          </Answer>
          <Answer q="Apa pengaruh musim hujan?" a={`Daya tahan turun ${Math.round(decision.wetLossPct)}%`}>Saat tanah dasar jenuh air.</Answer>
          <Answer q="Penanganan mana yang tidak sia-sia?" a="Perbandingan daya tahan">
            Tambal: ×1 (struktur tidak berubah) · Overlay 5 cm: {x(decision.overlayFactor)} · Rekonstruksi: {x(decision.reconFactor)}
          </Answer>
          <p className="text-xs text-white/40">Indikatif, bukan desain. Dihitung dengan PINN surrogate dan solver MLET dari tebal lapisan dan beban yang diisi petugas.</p>
        </div>
      )}
    </div>
  );
};

const Answer: React.FC<{ q: string; a: string; children: React.ReactNode }> = ({ q, a, children }) => (
  <div className="rounded-2xl bg-white/5 p-3">
    <p className="text-xs font-bold text-white/50">{q}</p>
    <p className="text-[15px] font-extrabold">{a}</p>
    <p className="text-sm text-white/70">{children}</p>
  </div>
);
