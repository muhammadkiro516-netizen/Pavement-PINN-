/**
 * What the coordinator receives from a guided inspection: one case card with every angle, the
 * AI result of each photo (copied by the server from its CV store), the AI consensus and the
 * engineer's tape measurements. Older inspections without views show only their single photo.
 */
import React, { useState } from 'react';
import type { ReportCase } from '../../../domain/workflow/model';
import { ANGLE_GUIDE, areaFromDimensions, summarizeViews, volumeFromDimensions } from '../../../domain/workflow/inspectionViews';

const SEV = { LIGHT: 'Ringan', MODERATE: 'Sedang', SEVERE: 'Berat', CRITICAL: 'Kritis' } as Record<string, string>;

export const InspectionCaseSummary: React.FC<{ c: ReportCase }> = ({ c }) => {
  const i = c.inspection;
  const [zoom, setZoom] = useState<string | null>(null);
  if (!i?.views?.length) return null;
  const s = summarizeViews(i.views);
  const dims = i.dimensions ?? { lengthCm: null, widthCm: null, depthCm: null };
  const area = areaFromDimensions(dims) ?? i.measuredAreaM2;
  const volume = volumeFromDimensions(dims);
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
          <button key={v.angle} type="button" onClick={() => setZoom(v.photoUrl)} className="cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-black text-left">
            <img src={v.photoUrl} alt={ANGLE_GUIDE[v.angle].title} className="h-20 w-full object-cover" />
            <div className="p-1.5">
              <p className="text-[10px] font-bold text-white">{ANGLE_GUIDE[v.angle].title}</p>
              <p className="truncate text-[10px] text-[#A1A1AA]">{v.ai ? (v.ai.primaryLabel ? `${v.ai.primaryLabel} ${Math.round((v.ai.confidence ?? 0) * 100)}%` : 'tidak ada temuan') : 'belum dianalisis'}</p>
            </div>
          </button>
        ))}
      </div>
      {s.flooded && <p className="text-xs text-[#38BDF8]">Genangan terlihat di foto: tambal setelah air dikeringkan, periksa drainase.</p>}
      {zoom && (
        <button type="button" onClick={() => setZoom(null)} className="fixed inset-0 z-[130] grid cursor-zoom-out place-items-center bg-black/90 p-4" aria-label="Tutup foto">
          <img src={zoom} alt="Foto inspeksi" className="max-h-full max-w-full rounded-xl" />
        </button>
      )}
    </div>
  );
};
