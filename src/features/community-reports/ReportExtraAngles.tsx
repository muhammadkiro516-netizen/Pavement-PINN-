/**
 * Citizen report, step 3: "Foto dari sisi lain" (recommended, skippable). The first photo is the
 * close-up; a far shot and a low side shot let the AI and the field engineer judge extent and
 * depth before anyone drives out. Each photo comes from the in-page camera and runs through the real CV service.
 */
import React, { useEffect, useState } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { ensureDeviceSession } from '../roles/api';
import { Capture, apiUrl as roleApiUrl } from '../roles/Capture';
import '../roles/roles.css';
import type { CvAnalysis } from '../../types/cv';
import { ANGLE_GUIDE, type InspectionAngle } from '../../domain/workflow/inspectionViews';

export type ExtraShot = { evidenceId?: string; photoUrl: string; takenAt: string; state: 'analysing' | 'done' | 'error'; analysis: CvAnalysis | null };
export type ExtraShots = Partial<Record<InspectionAngle, ExtraShot>>;
export const CITIZEN_ANGLES: InspectionAngle[] = ['OVERVIEW', 'SIDE'];

const CITIZEN_HOW: Partial<Record<InspectionAngle, string>> = {
  OVERVIEW: 'Mundur beberapa langkah: seluruh lebar jalan dan kerusakan terlihat.',
  SIDE: 'Jongkok, kamera rendah & miring: terlihat seberapa dalam lubangnya.'
};

/** Payload for the report draft: the server re-reads every AI result from its own store. */
export const extraViewsPayload = (shots: ExtraShots) =>
  CITIZEN_ANGLES.filter((a) => shots[a]).map((a) => ({ angle: a, photoUrl: shots[a]!.photoUrl, takenAt: shots[a]!.takenAt, analysisId: shots[a]!.analysis?.analysisId ?? null }));

export const ReportExtraAngles: React.FC<{ shots: ExtraShots; onChange: (update: (s: ExtraShots) => ExtraShots) => void }> = ({ shots, onChange }) => {
  const [camera, setCamera] = useState<InspectionAngle | null>(null);
  useEffect(() => { void ensureDeviceSession(); }, []);
  const done = CITIZEN_ANGLES.filter((a) => shots[a]).length;
  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-extrabold text-white">Foto dari sisi lain <span className="text-xs font-semibold text-[#FFD60A]">disarankan</span></p>
        <p className="text-[11px] text-[#A1A1AA]">{done + 1}/3 sisi</p>
      </div>
      <p className="text-xs text-[#A1A1AA]">Tiga sisi membuat AI dan petugas bisa menilai luas & kedalaman sebelum turun ke lokasi. Boleh dilewati.</p>
      <div className="grid grid-cols-2 gap-2">
        {CITIZEN_ANGLES.map((a) => {
          const s = shots[a];
          return (
            <div key={a} className={`relative overflow-hidden rounded-xl border ${s ? 'border-[#2BD67B]/60' : 'border-dashed border-[#FFD60A]/50'} bg-[#0B0D10]`}>
              <button type="button" className="block w-full cursor-pointer text-left" aria-label={ANGLE_GUIDE[a].title} onClick={() => setCamera(a)} data-testid={`extra-angle-${a}`}>
                <div className="relative grid h-24 place-items-center overflow-hidden">
                  {s ? <img src={s.photoUrl} alt={ANGLE_GUIDE[a].title} className="absolute inset-0 h-full w-full object-cover" /> : <Camera className="h-6 w-6 text-[#FFD60A]" />}
                  {s?.state === 'analysing' && <span className="absolute inset-0 grid place-items-center bg-black/55 text-[11px] text-white"><Loader2 className="h-5 w-5 animate-spin text-[#FFD60A]" /></span>}
                </div>
                <div className="p-2">
                  <p className="text-xs font-bold text-white">{ANGLE_GUIDE[a].title}</p>
                  <p className="text-[11px] leading-snug text-[#A1A1AA]">
                    {s?.state === 'done' ? (s.analysis?.primary ? `AI: ${s.analysis.primary.label} ${Math.round((s.analysis.primary.confidence ?? 0) * 100)}%` : 'AI: tidak ada temuan jelas') : s?.state === 'error' ? 'AI gagal, foto tetap terlampir' : CITIZEN_HOW[a]}
                  </p>
                </div>
              </button>
              {s && (
                <button type="button" onClick={() => onChange((x) => { const n = { ...x }; delete n[a]; return n; })} aria-label={`Hapus ${ANGLE_GUIDE[a].title}`} className="absolute right-1.5 top-1.5 cursor-pointer rounded-full bg-black/70 p-1 text-white">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {camera && (
        <div className="v5-shell fixed inset-0 z-[2100] overflow-y-auto">
          <div className="v5-page">
            <button type="button" className="v5-link" onClick={() => setCamera(null)}>Batal</button>
            <Capture kind="CLOSEUP" purpose="REPORT" title={ANGLE_GUIDE[camera].title} hint={CITIZEN_HOW[camera]} onDone={(e) => {
              const best = [...e.ai.detections].sort((x, y) => y.confidence - x.confidence)[0];
              onChange((prev) => ({ ...prev, [camera]: { photoUrl: roleApiUrl(e.imageUrl), takenAt: new Date().toISOString(), state: 'done', analysis: best ? { primary: { label: best.label, confidence: best.confidence } } : null, evidenceId: e.id } }));
              setCamera(null);
            }} />
          </div>
        </div>
      )}
    </div>
  );
};
