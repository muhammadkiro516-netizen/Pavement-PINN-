/**
 * "Siapa yang harus memperbaiki jalan ini?": the agency that owns the road at a point, from the
 * routing service. Everyday words only; the road decree stays with staff.
 */
import React, { useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import { apiUrl } from '../../services/api/client';

export interface RoadOwner {
  status: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  officeName: string;
  segment: { name: string | null } | null;
  askCitizen: string | null;
}

export const ROAD_STATUS_WORD: Record<string, string> = {
  NASIONAL: 'Jalan nasional',
  TOL: 'Jalan tol',
  PROVINSI: 'Jalan provinsi',
  KABUPATEN: 'Jalan kabupaten',
  KOTA: 'Jalan kota',
  DESA: 'Jalan desa',
  KHUSUS: 'Jalan khusus',
  UNKNOWN: 'Status jalan belum diketahui'
};

export const CONFIDENCE_WORD: Record<RoadOwner['confidence'], string> = {
  HIGH: 'Sudah pasti',
  MEDIUM: 'Kemungkinan besar',
  LOW: 'Petugas akan memastikan'
};

const CONFIDENCE_TONE: Record<RoadOwner['confidence'], string> = {
  HIGH: 'bg-[#2BD67B]/15 text-[#2BD67B]',
  MEDIUM: 'bg-[#FFD60A]/15 text-[#FFD60A]',
  LOW: 'bg-[#FF6B2C]/15 text-[#FF6B2C]'
};

export const RoadOwnerCard: React.FC<{ latitude: number; longitude: number; accuracyMeters?: number | null; className?: string }> = ({ latitude, longitude, accuracyMeters, className = '' }) => {
  const [owner, setOwner] = useState<RoadOwner | null>(null);
  const [failed, setFailed] = useState(false);
  const [toll, setToll] = useState<'yes' | 'no' | null>(null);

  useEffect(() => {
    let live = true;
    setFailed(false);
    const query = `lat=${latitude}&lon=${longitude}&accuracy=${accuracyMeters ?? 25}${toll ? `&toll=${toll}` : ''}`;
    fetch(apiUrl(`/api/v5/routing/resolve?${query}`))
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        if (j?.success) setOwner(j.data);
        else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [latitude, longitude, accuracyMeters, toll]);

  // Without an answer the coordinator still receives the report, so nothing is guessed here.
  if (failed) return null;
  if (!owner) {
    return <div className={`h-[84px] animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.03] ${className}`} />;
  }
  return (
    <div className={`pp-rise rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 ${className}`} data-testid="road-owner">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FFD60A]/15 text-[#FFD60A]">
          <Landmark className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-400">Yang bertanggung jawab atas jalan ini</p>
          <p className="mt-0.5 text-[15px] font-extrabold leading-snug text-white" data-testid="road-owner-office">{owner.officeName}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-bold text-slate-200">{ROAD_STATUS_WORD[owner.status] ?? owner.status}</span>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${CONFIDENCE_TONE[owner.confidence]}`} data-testid="road-owner-confidence">{CONFIDENCE_WORD[owner.confidence]}</span>
          </div>
          {owner.askCitizen === 'Are you on the toll road?' && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-slate-200">Anda sedang di jalan tol?</p>
              <div className="mt-1.5 flex gap-2">
                <button type="button" onClick={() => setToll('yes')} className="min-h-9 flex-1 cursor-pointer rounded-xl bg-white/[0.08] text-xs font-bold text-white">Ya</button>
                <button type="button" onClick={() => setToll('no')} className="min-h-9 flex-1 cursor-pointer rounded-xl bg-white/[0.08] text-xs font-bold text-white">Tidak</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
