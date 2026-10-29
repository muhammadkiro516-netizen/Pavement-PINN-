/**
 * Measure on a photo with an in-picture scale: tap both ends of a reference of known length
 * (tape, A4 sheet, ID card), then both ends of what to measure. cm = pixels x (ref cm / ref px),
 * valid in the plane of the reference (lay the tape on the surface for length/width, stand it in
 * the deepest point for depth). Points are kept so the coordinator can audit every measurement.
 */
import React, { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { MEASURE_LABEL, measureFromMarks, type MeasureKind, type PhotoMarks, type Pt } from '../../../domain/workflow/inspectionViews';

const REFS = [
  { label: 'Meteran 10 cm', cm: 10 },
  { label: 'Meteran 20 cm', cm: 20 },
  { label: 'Kertas A4 (lebar)', cm: 21 },
  { label: 'KTP (panjang)', cm: 8.56 }
];

/** Lines of a measurement drawn over the photo (normalised 0..1 coordinates). */
export const MarksOverlay: React.FC<{ marks: PhotoMarks; draft?: Pt[] }> = ({ marks, draft = [] }) => (
  <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
    {marks.ref && <line x1={marks.ref[0][0]} y1={marks.ref[0][1]} x2={marks.ref[1][0]} y2={marks.ref[1][1]} stroke="#38BDF8" strokeWidth="0.006" />}
    {marks.items.map((it, i) => (
      <line key={i} x1={it.pts[0][0]} y1={it.pts[0][1]} x2={it.pts[1][0]} y2={it.pts[1][1]} stroke={it.what === 'DEPTH' ? '#FF4D5E' : '#FFD60A'} strokeWidth="0.006" />
    ))}
    {[...(marks.ref ?? []), ...marks.items.flatMap((i) => i.pts), ...draft].map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="0.012" fill="#FFFFFF" stroke="#0B0D10" strokeWidth="0.004" />)}
  </svg>
);

export const PhotoMeasure: React.FC<{
  photoUrl: string;
  title: string;
  kinds: MeasureKind[];
  initial?: PhotoMarks | null;
  onDone: (marks: PhotoMarks) => void;
  onClose: () => void;
}> = ({ photoUrl, title, kinds, initial, onDone, onClose }) => {
  const img = useRef<HTMLImageElement | null>(null);
  const [marks, setMarks] = useState<PhotoMarks>(initial ?? { refCm: 10, ref: null, items: [], aspect: 1 });
  const [draft, setDraft] = useState<Pt[]>([]);
  const [kind, setKind] = useState<MeasureKind | 'REF'>(initial?.ref ? kinds[0] : 'REF');

  const tap = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p: Pt = [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    const pts = [...draft, p];
    if (pts.length < 2) return setDraft(pts);
    const pair = [pts[0], pts[1]] as [Pt, Pt];
    const aspect = img.current ? img.current.naturalWidth / img.current.naturalHeight : 1;
    setDraft([]);
    if (kind === 'REF') {
      setMarks((m) => ({ ...m, ref: pair, aspect }));
      setKind(kinds[0]);
    } else {
      setMarks((m) => ({ ...m, aspect, items: [...m.items.filter((i) => i.what !== kind), { what: kind, pts: pair }] }));
      const next = kinds.find((k) => k !== kind && !marks.items.some((i) => i.what === k));
      if (next) setKind(next);
    }
  };
  const values = measureFromMarks(marks);

  return (
    <div className="fixed inset-0 z-[140] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={`Ukur di ${title}`}>
      <div className="flex items-center justify-between gap-2 p-3">
        <div>
          <p className="text-sm font-extrabold">Ukur di foto · {title}</p>
          <p className="text-xs text-[#A1A1AA]">
            {kind === 'REF' ? 'Langkah 1: ketuk dua ujung benda pembanding (garis biru).' : `Ketuk dua ujung ${MEASURE_LABEL[kind].toLowerCase()} (${kind === 'DEPTH' ? 'permukaan jalan → titik terdalam' : 'tepi ke tepi'}).`}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Tutup" className="cursor-pointer rounded-full p-2 hover:bg-white/10"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-2">
        <div className="relative max-h-full cursor-crosshair touch-none select-none" onClick={tap}>
          <img ref={img} src={photoUrl} alt={title} className="block max-h-[62dvh] max-w-full" draggable={false} />
          <MarksOverlay marks={marks} draft={draft} />
        </div>
      </div>
      <div className="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[#A1A1AA]">Pembanding:</span>
          {REFS.map((r) => (
            <button key={r.label} type="button" onClick={() => setMarks((m) => ({ ...m, refCm: r.cm }))} className={`cursor-pointer rounded-full px-3 py-1.5 font-bold ${marks.refCm === r.cm ? 'bg-[#38BDF8] text-[#0B0D10]' : 'bg-white/10'}`}>{r.label}</button>
          ))}
          <label className="flex items-center gap-1">
            <input type="number" min="1" step="0.5" value={marks.refCm} onChange={(e) => setMarks((m) => ({ ...m, refCm: Number(e.target.value) || m.refCm }))} className="w-16 rounded-lg border border-white/15 bg-[#0B0D10] px-2 py-1" aria-label="Panjang pembanding (cm)" /> cm
          </label>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="button" onClick={() => { setKind('REF'); setDraft([]); }} className={`cursor-pointer rounded-full px-3 py-1.5 font-bold ${kind === 'REF' ? 'bg-[#38BDF8] text-[#0B0D10]' : marks.ref ? 'bg-[#38BDF8]/20 text-[#38BDF8]' : 'bg-white/10'}`}>1 · Pembanding {marks.ref ? '✓' : ''}</button>
          {kinds.map((k, i) => (
            <button key={k} type="button" disabled={!marks.ref} onClick={() => { setKind(k); setDraft([]); }} className={`cursor-pointer rounded-full px-3 py-1.5 font-bold disabled:opacity-40 ${kind === k ? 'bg-[#FFD60A] text-[#0B0D10]' : 'bg-white/10'}`}>
              {i + 2} · {MEASURE_LABEL[k]} {values[k] != null ? `${values[k]} cm` : ''}
            </button>
          ))}
        </div>
        <button type="button" disabled={!marks.ref || marks.items.length === 0} onClick={() => onDone(marks)} className="w-full cursor-pointer rounded-2xl bg-[#FFD60A] py-3 text-sm font-extrabold text-[#0B0D10] disabled:opacity-40">
          Simpan ukuran
        </button>
      </div>
    </div>
  );
};
