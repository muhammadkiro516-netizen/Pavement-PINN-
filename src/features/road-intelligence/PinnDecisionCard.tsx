/**
 * PINN decision card: one call to POST /api/engine/decide (inference/app/decide.py) turns the
 * structure, the observed cracking and the real traffic mix (incl. overloaded trucks) into the
 * answers a road authority needs: surface or structural problem, what ODOL trucks cost, what the
 * rainy season costs, how long it lasts, and which treatment is not wasted money.
 */
import React, { useEffect, useState } from 'react';
import { useWeather } from '../weather/useWeather';
import { Glyph } from '../../components/ui/brand';
import { apiUrl } from '../../services/api/client';
import type { EngineAssessRequest } from '../../types';

export interface DecideResult {
  modulus: { E0_mpa: number; E_eff_mpa: number; condition: string; damage: number; source: string };
  traffic: { esal_day: number; esal_day_if_legal: number | null; odol_extra_pct: number | null; rows: Array<{ code: string; name: string; per_day: number; vdf_normal: number; vdf_actual: number }> } | null;
  structure: { et_ue: number; ev_ue: number; governing: 'fatigue' | 'rutting'; N_seasonal: number };
  remaining_life: { dry_years: number; seasonal_years: number; wet_season_loss_pct: number } | null;
  odol: { axle_t: number; tyre_mpa: number; fatigue_factor: number | null; rutting_factor: number; fourth_power: number };
  overlay: { target_years: number; h_mm: number | null; candidates: Array<{ h_mm: number; life_years: number | null }> };
  options: Array<{ code: 'RUTIN' | 'BERKALA' | 'REKONSTRUKSI'; title: string; life_years: number | null; strength_gain: number; meets_target: boolean }>;
  verdict: { structural: boolean; governing: string; advice: 'RUTIN' | 'BERKALA' | 'REKONSTRUKSI' };
  assumptions: string[];
  warnings: string[];
  label: string;
  engine: { solver: string; elapsed_ms: number };
}

/** Typical daily heavy-vehicle mixes (per Bina Marga class), editable. */
export const TRAFFIC_PRESETS: Record<string, { label: string; counts: Record<string, number> }> = {
  kota: { label: 'Jalan kota', counts: { '5B': 40, '6A': 300, '6B': 120, '7A': 30, '7C': 10 } },
  industri: { label: 'Jalur truk industri', counts: { '5B': 30, '6A': 400, '6B': 350, '7A': 180, '7B': 40, '7C': 90 } },
  desa: { label: 'Jalan desa', counts: { '6A': 60, '6B': 15 } }
};

const ADVICE = {
  RUTIN: { title: 'Cukup pemeliharaan rutin', text: 'Struktur jalan masih kuat. Tambal kerusakan permukaannya.', tone: '#2BD67B' },
  BERKALA: { title: 'Perlu lapis ulang (overlay)', text: 'Tambal saja akan rusak lagi. Lapis tambahan memperkuat struktur.', tone: '#FFD60A' },
  REKONSTRUKSI: { title: 'Perlu dibangun ulang', text: 'Kerusakan sudah sampai ke struktur. Tambal dan overlay tipis tidak akan bertahan.', tone: '#FF4D5E' }
} as const;

const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode }> = ({ on, onClick, children }) => (
  <button type="button" onClick={onClick} className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-bold transition ${on ? 'bg-[#FFD60A] text-[#0B0D10]' : 'bg-[#FFFFFF]/8 text-[#FFFFFF]/80 hover:bg-[#FFFFFF]/14'}`}>
    {children}
  </button>
);

const Answer: React.FC<{ q: string; a: string; children?: React.ReactNode }> = ({ q, a, children }) => (
  <div className="pp-rise rounded-2xl bg-[#FFFFFF]/5 p-3">
    <p className="text-[11px] font-bold uppercase tracking-wide text-[#FFFFFF]/45">{q}</p>
    <p className="mt-0.5 text-[15px] font-extrabold text-[#FFFFFF]">{a}</p>
    {children && <p className="mt-0.5 text-sm text-[#FFFFFF]/65">{children}</p>}
  </div>
);

export const PinnDecisionCard: React.FC<{ base: EngineAssessRequest; at?: [number, number] | null }> = ({ base, at }) => {
  const [preset, setPreset] = useState<keyof typeof TRAFFIC_PRESETS>('industri');
  const [odol, setOdol] = useState(30);
  const [wet, setWet] = useState(6);
  // Wet months from measured rainfall at this location (Open-Meteo, last 12 months), when available.
  const { weather } = useWeather(at);
  useEffect(() => {
    if (weather) setWet(weather.wetMonths);
  }, [weather]);
  const [target, setTarget] = useState(10);
  const [alligator, setAlligator] = useState(0);
  const [severity, setSeverity] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('LOW');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<DecideResult | null>(null);
  const [details, setDetails] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/engine/decide'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segment_id: base.segment_id,
          layers: base.layers.map(({ h_mm, E_mpa, nu }) => ({ h_mm, E_mpa, nu })),
          subgrade: { cbr: base.subgrade.cbr },
          distress: alligator > 0 ? { source: 'INSPECTION', alligator_pct: alligator, severity } : null,
          counts: TRAFFIC_PRESETS[preset].counts,
          odol_share: odol / 100,
          wet_months: wet,
          target_years: target,
          criterion: base.criterion ?? 'AI'
        })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      setR(json.result as DecideResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const maxLife = r ? Math.max(target * 1.25, ...r.options.map((o) => o.life_years ?? 0)) : 1;

  return (
    <div className="rounded-[28px] border border-[#FFFFFF]/8 bg-[#15181D] p-4 text-[#FFFFFF]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-extrabold">Keputusan dengan PINN</p>
          <p className="text-sm text-[#FFFFFF]/60">Fisika perkerasan (MLET) menghitung apa arti kerusakan ini dan penanganan yang tidak sia-sia.</p>
        </div>
        <button type="button" onClick={() => void run()} disabled={busy}
          className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full bg-[#FFD60A] px-4 py-2.5 text-sm font-extrabold text-[#0B0D10] disabled:opacity-60">
          {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Glyph name="spark" size={18} />}
          {r ? 'Hitung ulang' : 'Hitung'}
        </button>
      </div>

      <div className="mt-4 space-y-3 text-sm">
        <div>
          <p className="mb-1.5 text-xs font-bold text-[#FFFFFF]/50">Lalu lintas kendaraan berat</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(TRAFFIC_PRESETS).map(([k, p]) => <Chip key={k} on={preset === k} onClick={() => setPreset(k as keyof typeof TRAFFIC_PRESETS)}>{p.label}</Chip>)}
          </div>
        </div>
        <label className="block">
          <span className="text-xs font-bold text-[#FFFFFF]/50">Truk bermuatan berlebih (ODOL): {odol}%</span>
          <input type="range" min={0} max={80} step={5} value={odol} onChange={(e) => setOdol(Number(e.target.value))} className="mt-1 w-full accent-[#FF6B2C]" />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-[#FFFFFF]/50">Retak buaya teramati: {alligator}% luas lajur</span>
          <input type="range" min={0} max={60} step={5} value={alligator} onChange={(e) => setAlligator(Number(e.target.value))} className="mt-1 w-full accent-[#FFD60A]" />
        </label>
        {alligator > 0 && (
          <div className="flex gap-2">
            {(['LOW', 'MEDIUM', 'HIGH'] as const).map((s) => <Chip key={s} on={severity === s} onClick={() => setSeverity(s)}>{{ LOW: 'Ringan', MEDIUM: 'Sedang', HIGH: 'Berat' }[s]}</Chip>)}
          </div>
        )}
        <div className="flex flex-wrap gap-4">
          <div>
            <p className="mb-1.5 text-xs font-bold text-[#FFFFFF]/50">Bulan musim hujan</p>
            <div className="flex gap-2">
              {weather && ![3, 6, 9].includes(weather.wetMonths) && <Chip on={wet === weather.wetMonths} onClick={() => setWet(weather.wetMonths)}>{weather.wetMonths}</Chip>}
              {[3, 6, 9].map((m) => <Chip key={m} on={wet === m} onClick={() => setWet(m)}>{m}</Chip>)}
            </div>
            {weather && (
              <p className="mt-1.5 max-w-[260px] text-[11px] leading-snug text-[#38BDF8]">
                Terukur di lokasi: {weather.wetMonths} bulan ≥ 200 mm dalam 12 bulan terakhir ({weather.annualMm.toLocaleString('id-ID')} mm/tahun). Sumber Open-Meteo.
              </p>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-bold text-[#FFFFFF]/50">Target umur (tahun)</p>
            <div className="flex gap-2">{[5, 10, 15].map((t) => <Chip key={t} on={target === t} onClick={() => setTarget(t)}>{t}</Chip>)}</div>
          </div>
        </div>
      </div>

      {error && <p className="mt-3 rounded-2xl bg-[#FF4D5E]/15 p-3 text-sm text-[#FF8A95]">Mesin PINN belum dapat dihubungi: {error}</p>}

      {r && (
        <div className="mt-4 space-y-3">
          <div className="pp-pop rounded-2xl p-4 text-[#0B0D10]" style={{ background: ADVICE[r.verdict.advice].tone }}>
            <p className="text-[11px] font-extrabold uppercase tracking-wide">Rekomendasi</p>
            <p className="text-xl font-extrabold">{ADVICE[r.verdict.advice].title}</p>
            <p className="text-sm font-semibold">{ADVICE[r.verdict.advice].text}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Answer q="Masalahnya di mana?" a={r.verdict.structural ? 'Struktur jalan' : 'Permukaan'}>
              Yang paling cepat gagal: {r.structure.governing === 'rutting' ? 'tanah dasar (amblas / alur roda)' : 'lapis aspal (retak lelah)'}. Modulus aspal {Math.round(r.modulus.E_eff_mpa)} MPa ({r.modulus.condition}).
            </Answer>
            <Answer q="Dampak truk ODOL" a={r.traffic?.odol_extra_pct != null ? `Beban harian +${Math.round(r.traffic.odol_extra_pct)}%` : '–'}>
              Satu gandar {r.odol.axle_t} t merusak tanah dasar setara {r.odol.rutting_factor}× gandar standar{r.odol.fatigue_factor ? `, lapis aspal ${r.odol.fatigue_factor}×` : ''}.
            </Answer>
            <Answer q="Musim hujan" a={r.remaining_life ? `Daya tahan −${Math.round(r.remaining_life.wet_season_loss_pct)}%` : '–'}>
              {wet} bulan tanah dasar jenuh air{weather && wet === weather.wetMonths ? ' (dari curah hujan terukur di lokasi)' : ''}.
            </Answer>
            <Answer q="Sisa umur" a={r.remaining_life ? `${r.remaining_life.seasonal_years.toFixed(1)} tahun` : 'Butuh data lalu lintas'}>
              Bila dibiarkan dengan lalu lintas ini.
            </Answer>
          </div>
          <div className="rounded-2xl bg-[#FFFFFF]/5 p-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#FFFFFF]/45">Umur setelah penanganan (target {target} th)</p>
            <div className="relative space-y-2.5">
              <span className="absolute bottom-0 top-0 w-px bg-[#FFFFFF]/40" style={{ left: `${(target / maxLife) * 100}%` }} />
              {r.options.map((o, i) => (
                <div key={o.code}>
                  <div className="flex justify-between text-xs font-bold">
                    <span>{o.title}</span>
                    <span className={o.meets_target ? 'text-[#2BD67B]' : 'text-[#FFFFFF]/60'}>{o.life_years != null ? `${o.life_years.toFixed(1)} th` : '–'}</span>
                  </div>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-[#FFFFFF]/8">
                    <div className="h-full rounded-full transition-[width] duration-700 ease-out"
                      style={{ width: `${Math.min(100, ((o.life_years ?? 0) / maxLife) * 100)}%`, background: o.meets_target ? '#2BD67B' : i === 0 ? '#FF4D5E' : '#FFD60A', transitionDelay: `${i * 120}ms` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => setDetails((v) => !v)} className="cursor-pointer text-xs font-bold text-[#FFD60A]">
            {details ? 'Sembunyikan detail teknis' : 'Detail teknis'}
          </button>
          {details && (
            <div className="space-y-2 rounded-2xl bg-[#0B0D10] p-3 text-xs text-[#FFFFFF]/70">
              <p>εt {r.structure.et_ue} µε · εv {r.structure.ev_ue} µε · N musiman {r.structure.N_seasonal.toLocaleString('id-ID')} · ESAL/hari {r.traffic?.esal_day ?? '–'} · {r.engine.solver}, {Math.round(r.engine.elapsed_ms)} ms</p>
              <p>Overlay: {r.overlay.candidates.map((c) => `${c.h_mm / 10} cm → ${c.life_years ?? '–'} th`).join(' · ')}</p>
              <ul className="list-disc space-y-1 pl-4">{[...r.warnings, ...r.assumptions].map((a) => <li key={a}>{a}</li>)}</ul>
              <p className="text-[#FFFFFF]/45">{r.label}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
