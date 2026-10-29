/**
 * What the coordinator receives from a guided inspection: one case card with every angle, the
 * AI result of each photo (copied by the server from its CV store), the AI consensus and the
 * engineer's tape measurements. Older inspections without views show only their single photo.
 */
import React, { useState } from 'react';
import type { ReportCase } from '../../../domain/workflow/model';
import { useWeather } from '../../weather/useWeather';
import { ANGLE_GUIDE, MEASURE_LABEL, areaFromDimensions, combineMeasurements, summarizeViews, volumeFromDimensions, type InspectionView, type MeasureKind } from '../../../domain/workflow/inspectionViews';
import { MarksOverlay } from './PhotoMeasure';

const SEV = { LIGHT: 'Ringan', MODERATE: 'Sedang', SEVERE: 'Berat', CRITICAL: 'Kritis' } as Record<string, string>;

export const InspectionCaseSummary: React.FC<{ c: ReportCase }> = ({ c }) => {
  const i = c.inspection;
  const [zoom, setZoom] = useState<InspectionView | null>(null);
  const { weather } = useWeather(i?.views?.length ? c.report.coordinates : null);
  if (!i?.views?.length) return null;
  const s = summarizeViews(i.views);
  const dims = i.dimensions ?? { lengthCm: null, widthCm: null, depthCm: null };
  const area = areaFromDimensions(dims) ?? i.measuredAreaM2;
  const volume = volumeFromDimensions(dims);
  const photoMeasures = combineMeasurements(i.views);
  const fact = (k: string, v: React.ReactNode, sub?: string) => (
    <div className="rounded-xl bg-white/5 p-2.5">
      <p className="text-[11px] text-[#A1A1AA]">{k}</p>
      <p className="text-sm font-extrabold text-white">{v}</p>
      {sub && <p className="text-[10px] text-[#71717A]">{sub}</p>}
    </div>
  );
  return (
    <div className="space-y-3 rounded-2xl border border-[#FFD60A]/30 bg-[#0B0D10] p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-[#FFD60A]">Ringkasan kasus dari lapangan · {i.views.length} sudut foto</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fact('Kesimpulan petugas', i.verdict === 'CONFIRMED' ? 'Rusak, terkonfirmasi' : 'Tidak ditemukan')}
        {fact('Jenis (AI, konsensus)', s.consensusLabel ?? '—', `${s.agreement.agree}/${s.agreement.of} foto setuju`)}
        {fact('Keparahan', SEV[i.severity] ?? i.severity, s.suggestedSeverity ? `saran AI: ${SEV[s.suggestedSeverity]}` : undefined)}
        {fact('Ukuran (meteran)', dims.lengthCm && dims.widthCm ? `${dims.lengthCm}×${dims.widthCm}×${dims.depthCm ?? '—'} cm` : '—', [area !== null ? `${area} m²` : null, volume !== null ? `${volume} m³ bahan` : null].filter(Boolean).join(' · ') || undefined)}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {i.views.map((v) => (
          <button key={v.angle} type="button" onClick={() => setZoom(v)} className="cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-black text-left">
            <div className="relative h-20"><img src={v.photoUrl} alt={ANGLE_GUIDE[v.angle].title} className="absolute inset-0 h-full w-full object-cover" />{v.marks && <MarksOverlay marks={v.marks} />}</div>
            <div className="p-1.5">
              <p className="text-[10px] font-bold text-white">{ANGLE_GUIDE[v.angle].title}</p>
              <p className="truncate text-[10px] text-[#A1A1AA]">{v.ai ? (v.ai.primaryLabel ? `${v.ai.primaryLabel} ${Math.round((v.ai.confidence ?? 0) * 100)}%` : 'tidak ada temuan') : 'belum dianalisis'}</p>
            </div>
          </button>
        ))}
      </div>
      {Object.keys(photoMeasures).length > 0 && (
        <p className="text-xs text-[#D4D4D8]">
          <b className="text-[#38BDF8]">Terukur di foto:</b>{' '}
          {(Object.entries(photoMeasures) as Array<[MeasureKind, NonNullable<(typeof photoMeasures)[MeasureKind]>]>).map(([k, m]) => `${MEASURE_LABEL[k]} ${m.cm} cm (${m.n} foto${m.spreadPct !== null ? `, selisih ${m.spreadPct}%` : ''})`).join(' · ')}
          <span className="text-[#71717A]"> · garis biru = pembanding, kuning = panjang/lebar, merah = kedalaman (ketuk foto)</span>
        </p>
      )}
      {weather && (
        <div className="rounded-xl border border-[#38BDF8]/30 bg-[#38BDF8]/5 p-2.5 text-xs">
          <p className="font-bold text-[#38BDF8]">Cuaca di lokasi · 7 hari ke depan: {weather.forecastMm} mm{weather.heavyDays ? ` · ${weather.heavyDays} hari hujan lebat (≥ 20 mm)` : ''}</p>
          <div className="mt-1.5 flex gap-1" aria-hidden>
            {weather.forecast.map((f) => (
              <div key={f.date} className="flex flex-1 flex-col items-center gap-0.5">
                <div className="flex h-8 w-full items-end rounded bg-white/5"><div className="w-full rounded bg-[#38BDF8]" style={{ height: `${Math.min(100, (f.mm / 40) * 100)}%` }} /></div>
                <span className="text-[9px] text-[#71717A]">{new Date(f.date).toLocaleDateString('id-ID', { weekday: 'short' })}</span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[#A1A1AA]">
            {weather.heavyDays ? 'Hujan lebat akan mengisi dan memperlebar lubang: pasang rambu dan pertimbangkan tambal darurat sebelum hujan.' : 'Tidak ada hujan lebat yang diprakirakan: jendela kerja baik untuk penambalan.'} Setahun terakhir {weather.wetMonths} bulan basah ({weather.annualMm.toLocaleString('id-ID')} mm). Sumber Open-Meteo.
          </p>
        </div>
      )}
      {s.flooded && <p className="text-xs text-[#38BDF8]">Genangan terlihat di foto: tambal setelah air dikeringkan, periksa drainase.</p>}
      {zoom && (
        <button type="button" onClick={() => setZoom(null)} className="fixed inset-0 z-[130] grid cursor-zoom-out place-items-center bg-black/90 p-4" aria-label="Tutup foto">
          <span className="relative inline-block"><img src={zoom.photoUrl} alt="Foto inspeksi" className="block max-h-[90dvh] max-w-full rounded-xl" />{zoom.marks && <MarksOverlay marks={zoom.marks} />}</span>
        </button>
      )}
    </div>
  );
};

/** The reporter's own photos from other angles (citizen report), with the server-side AI result. */
export const ReporterAngles: React.FC<{ c: ReportCase }> = ({ c }) => {
  const views = c.report.extraViews ?? [];
  if (!views.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#A1A1AA]">Foto dari pelapor · {views.length + 1} sisi</p>
      <div className="grid grid-cols-3 gap-2">
        <figure className="overflow-hidden rounded-lg bg-black">
          <img src={c.report.photoUrl} alt="Foto utama pelapor" className="h-16 w-full object-cover" />
          <figcaption className="p-1 text-[10px] text-[#A1A1AA]">Foto dekat</figcaption>
        </figure>
        {views.map((v) => (
          <figure key={v.angle} className="overflow-hidden rounded-lg bg-black">
            <img src={v.photoUrl} alt={ANGLE_GUIDE[v.angle].title} className="h-16 w-full object-cover" />
            <figcaption className="truncate p-1 text-[10px] text-[#A1A1AA]">{ANGLE_GUIDE[v.angle].title}{v.ai?.primaryLabel ? ` · ${v.ai.primaryLabel} ${Math.round((v.ai.confidence ?? 0) * 100)}%` : ''}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
};
