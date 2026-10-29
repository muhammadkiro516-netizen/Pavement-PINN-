/**
 * SPEC M4.1-M4.3: build the 9:16 story card for a report (or the impact card), pick a caption
 * tone, and share through the phone's share sheet (WhatsApp, Instagram Story, ...). Fallback:
 * download the PNG and copy the caption.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../../services/api/client';
import { caption, type StoryTemplate, type Tone } from '../../domain/share/captions';
import { escalationOf } from '../../domain/workflow/escalation';
import { renderStoryCard, type StoryInput } from './storyCard';

export interface ShareCase {
  id: string;
  state: string;
  createdAt: string;
  isMine?: boolean;
  report: {
    photoUrl?: string | null;
    damageTypeLabel: string;
    severity?: string | null;
    segmentName: string;
    coordinates: [number, number];
    repairDetails?: { afterPhotoUrl?: string | null } | null;
    aiAnalysis?: { modelStatus?: string } | null;
    cvAssessment?: { hazards?: string[]; detections?: Array<{ bbox: [number, number, number, number]; label: string }> } | null;
  };
  authority?: { name: string } | null;
}

const TONES: Array<[Tone, string]> = [['INFORMATIF', 'Informatif'], ['MENDESAK', 'Mendesak (sopan)'], ['APRESIASI', 'Apresiasi']];
const VERIFIED = new Set(['VERIFIED', 'FIELD_INSPECTION_REQUESTED', 'INSPECTED', 'INSPECTION_VERIFIED', 'ACTION_RECOMMENDED', 'ACTION_APPROVED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
const STATUS: Record<string, string> = { NEEDS_REVIEW: 'Menunggu ditinjau', VERIFIED: 'Diterima', FIELD_INSPECTION_REQUESTED: 'Dijadwalkan inspeksi', INSPECTED: 'Diinspeksi', INSPECTION_VERIFIED: 'Diinspeksi', ACTION_RECOMMENDED: 'Penanganan diusulkan', ACTION_APPROVED: 'Penanganan disetujui', IN_PROGRESS: 'Sedang dikerjakan', RESOLVED: 'Sudah diperbaiki', CLOSED: 'Selesai' };

export function templateFor(c: ShareCase): StoryTemplate {
  if (c.state === 'RESOLVED' || c.state === 'CLOSED') return 'DIPERBAIKI';
  if (c.report.cvAssessment?.hazards?.includes('GENANGAN')) return 'SIAGA_HUJAN';
  return escalationOf({ state: c.state as never, createdAt: c.createdAt }).waitingDays > 14 ? 'BELUM_DITANGANI' : 'BARU';
}

export const ShareSheet: React.FC<{ c?: ShareCase; impact?: StoryInput['impact']; paviSvg?: string | null; onClose: () => void }> = ({ c, impact, paviSvg, onClose }) => {
  const template: StoryTemplate = c ? templateFor(c) : 'DAMPAK';
  const [tone, setTone] = useState<Tone>('INFORMATIF');
  const [code, setCode] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const url = c ? (code ? `${window.location.origin}/r/${code}` : null) : window.location.origin;
  const days = c ? escalationOf({ state: c.state as never, createdAt: c.createdAt }).waitingDays : 0;

  useEffect(() => {
    if (!c) return;
    fetch(apiUrl(`/api/share/code/${encodeURIComponent(c.id)}`), { credentials: 'same-origin' }).then((r) => r.json()).then((j) => j?.success && setCode(j.code)).catch(() => setErr('Kode tautan tidak dapat dimuat.'));
  }, [c]);

  useEffect(() => {
    if (!url) return;
    setBlob(null);
    renderStoryCard({
      template,
      photoUrl: c?.report.photoUrl ?? null,
      afterPhotoUrl: c?.report.repairDetails?.afterPhotoUrl ?? null,
      boxes: c?.report.cvAssessment?.detections?.map((d) => ({ bbox: d.bbox, label: d.label })),
      damage: c?.report.damageTypeLabel ?? '',
      severity: c?.report.severity ?? null,
      address: c?.report.segmentName ?? '',
      agency: c?.authority?.name ?? null,
      statusLabel: c ? STATUS[c.state] ?? c.state : '',
      days,
      url,
      verified: c ? VERIFIED.has(c.state) : false,
      aiAnalysed: c?.report.aiAnalysis?.modelStatus === 'REAL',
      impact,
      paviSvg
    })
      .then(async (b) => {
        setBlob(b);
        // The reporter's (blurred) card becomes the link preview image (SPEC M4.4).
        if (c?.isMine) {
          const png = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b); });
          void fetch(apiUrl(`/api/share/${encodeURIComponent(c.id)}/og`), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ png }) }).catch(() => undefined);
        }
      })
      .catch(() => setErr('Kartu tidak dapat dibuat di perangkat ini.'));
  }, [url, template]);

  const text = useMemo(() => (url ? caption(template, tone, { damage: c?.report.damageTypeLabel ?? '', place: c?.report.segmentName ?? '', agency: c?.authority?.name ?? null, days, url, points: impact?.points, areaM2: impact?.areaM2 }) : ''), [template, tone, url]);
  const preview = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  const file = blob ? new File([blob], `pavementpinn-${template.toLowerCase()}.png`, { type: 'image/png' }) : null;

  const share = async () => {
    if (!file) return;
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text, url: url ?? undefined });
        return;
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
    const a = document.createElement('a');
    a.href = preview!;
    a.download = file.name;
    a.click();
    await navigator.clipboard?.writeText(text).catch(() => undefined);
    setMsg('Kartu diunduh dan caption disalin. Tempel di WhatsApp atau Instagram Story.');
  };

  return (
    <div className="fixed inset-0 z-[3000] flex items-end justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-[#15181D] p-4 text-[#FFFFFF]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-lg font-extrabold">Bagikan kartu</p>
          <button type="button" onClick={onClose} className="min-h-10 cursor-pointer rounded-full px-3 text-sm text-[#FFFFFF]/70">Tutup</button>
        </div>
        <div className="mx-auto mt-3 w-48 overflow-hidden rounded-2xl bg-[#0B0D10]" style={{ aspectRatio: '9 / 16' }}>
          {preview ? <img src={preview} alt="Pratinjau kartu story" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-xs text-[#FFFFFF]/50">{err ?? 'Membuat kartu…'}</div>}
        </div>
        <div className="mt-3 flex gap-2">
          {TONES.map(([t, l]) => (
            <button key={t} type="button" onClick={() => setTone(t)} className={`min-h-10 flex-1 cursor-pointer rounded-xl text-xs font-bold ${tone === t ? 'bg-[#FFD60A] text-[#0B0D10]' : 'bg-[#FFFFFF]/8'}`}>{l}</button>
          ))}
        </div>
        <p className="mt-2 whitespace-pre-line rounded-xl bg-[#FFFFFF]/5 p-3 text-xs text-[#FFFFFF]/85">{text}</p>
        <button type="button" disabled={!file} onClick={() => void share()} className="mt-3 min-h-12 w-full cursor-pointer rounded-2xl bg-[#FFD60A] text-sm font-extrabold text-[#0B0D10] disabled:opacity-40">Bagikan ke WhatsApp / Instagram</button>
        {msg && <p className="mt-2 text-xs text-[#2BD67B]">{msg}</p>}
        <p className="mt-2 text-[10px] text-[#FFFFFF]/40">Foto pada kartu dikaburkan. Tidak ada nama atau data pribadi.</p>
      </div>
    </div>
  );
};
