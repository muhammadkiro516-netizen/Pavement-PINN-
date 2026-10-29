/**
 * F.E "Inspeksi terpandu": photograph the damage from fixed angles (inspectionViews.ts), each
 * photo analysed by the real CV service, then tape-measure it. One SUBMIT_INSPECTION sends the
 * views, measurements and verdict; the server re-reads every AI result from its own store.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CheckCircle2, Loader2, Ruler, X } from 'lucide-react';
import type { ReportCase } from '../../../domain/workflow/model';
import type { WorkflowCommand } from '../../../domain/workflow/stateMachine';
import type { ReportMutationOutcome } from '../../../types/reports';
import type { CvAnalysis } from '../../../types/cv';
import { ANGLE_GUIDE, ANGLE_MEASURES, INSPECTION_ANGLES, MEASURE_LABEL, REQUIRED_ANGLES, areaFromDimensions, combineMeasurements, measureFromMarks, summarizeViews, volumeFromDimensions, type InspectionAngle, type InspectionView, type MeasureKind, type PhotoMarks } from '../../../domain/workflow/inspectionViews';
import { MarksOverlay, PhotoMeasure } from './PhotoMeasure';
import { normalizePhoto, runCvAnalysis } from '../../community-reports/cvClient';
import { friendlyError } from '../friendlyError';

type Shot = { photoUrl: string; takenAt: string; state: 'analysing' | 'done' | 'error'; analysis: CvAnalysis | null; error?: string; marks?: PhotoMarks | null };

const SEV_LABEL = { LIGHT: 'Ringan', MODERATE: 'Sedang', SEVERE: 'Berat', CRITICAL: 'Kritis' } as const;
const INPUT = 'w-full rounded-xl border border-white/10 bg-[#0B0D10] px-3 py-2.5 text-sm text-white outline-none focus:border-[#FFD60A]';

/** Decode any photo the browser (or the server converter) can read; JPEG, long side <= 1280 px. */
async function toJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = fail;
      i.src = url;
    }).catch(async () => {
      const i = new Image();
      i.src = await normalizePhoto(file);
      await i.decode();
      return i;
    });
    const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const viewAi = (a: CvAnalysis | null): InspectionView['ai'] =>
  a && {
    analysisId: a.analysisId,
    status: a.status,
    primaryLabel: a.primary?.label ?? null,
    primaryType: a.primary?.damageType ?? null,
    confidence: a.primary?.confidence ?? null,
    detections: a.detections?.length ?? 0,
    severity: a.overallSeverity ?? 'unknown',
    surfaceIndex: typeof a.surfaceIndex === 'number' ? a.surfaceIndex : null,
    flooded: !!a.hazards?.includes('GENANGAN')
  };

export const GuidedInspection: React.FC<{ c: ReportCase; onRun: (cmd: WorkflowCommand) => Promise<ReportMutationOutcome>; onClose: () => void }> = ({ c, onRun, onClose }) => {
  const [shots, setShots] = useState<Partial<Record<InspectionAngle, Shot>>>({});
  const [verdict, setVerdict] = useState<'CONFIRMED' | 'NOT_CONFIRMED'>('CONFIRMED');
  const [dims, setDims] = useState({ lengthCm: '', widthCm: '', depthCm: '' });
  const [severity, setSeverity] = useState<keyof typeof SEV_LABEL | ''>('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState<InspectionAngle | null>(null);
  const abort = useRef(new AbortController());
  useEffect(() => () => abort.current.abort(), []);

  const views: InspectionView[] = INSPECTION_ANGLES.filter((a) => shots[a]).map((a) => ({ angle: a, photoUrl: shots[a]!.photoUrl, takenAt: shots[a]!.takenAt, ai: viewAi(shots[a]!.analysis), marks: shots[a]!.marks ?? null }));
  const fromPhotos = combineMeasurements(views);
  const summary = useMemo(() => summarizeViews(views), [shots]); // eslint-disable-line react-hooks/exhaustive-deps
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const d = { lengthCm: num(dims.lengthCm), widthCm: num(dims.widthCm), depthCm: num(dims.depthCm) };
  const area = areaFromDimensions(d);
  const volume = volumeFromDimensions(d);
  const effSeverity = severity || summary.suggestedSeverity || c.report.severity;
  const analysing = Object.values(shots).some((s) => s?.state === 'analysing');
  const ready = summary.missing.length === 0 && !analysing && notes.trim().length > 0 && (verdict === 'NOT_CONFIRMED' || (d.lengthCm && d.widthCm));

  const capture = async (angle: InspectionAngle, file?: File) => {
    if (!file) return;
    setErr(null);
    let photoUrl: string;
    try {
      photoUrl = await toJpeg(file);
    } catch {
      setErr('Foto tidak dapat dibaca. Ambil ulang dengan kamera.');
      return;
    }
    const takenAt = new Date().toISOString();
    setShots((s) => ({ ...s, [angle]: { photoUrl, takenAt, state: 'analysing', analysis: null, marks: null } }));
    try {
      const job = await runCvAnalysis(photoUrl, `${c.id}-${angle}-${Date.now()}`, () => undefined, abort.current.signal);
      setShots((s) => ({ ...s, [angle]: { ...s[angle]!, state: 'done', analysis: job.analysis ?? null } }));
    } catch (e) {
      setShots((s) => ({ ...s, [angle]: { ...s[angle]!, state: 'error', analysis: null, error: (e as Error).message } }));
    }
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const out = await onRun({
      action: 'SUBMIT_INSPECTION',
      verdict,
      cvReview: summary.consensusType && summary.consensusType !== c.report.damageType ? { accepted: false, correctedClass: summary.consensusType } : { accepted: true, correctedClass: null },
      measuredDepthCm: d.depthCm,
      measuredAreaM2: area,
      severity: effSeverity,
      notes: notes.trim(),
      evidencePhotoUrl: shots.TOP?.photoUrl ?? null,
      views: views.map((v) => ({ angle: v.angle, photoUrl: v.photoUrl, takenAt: v.takenAt, analysisId: v.ai?.analysisId ?? null, marks: v.marks ?? null })),
      dimensions: d
    });
    setBusy(false);
    if (out.ok === false) setErr(friendlyError((out as { code?: string }).code ?? '', (out as { error: string }).error));
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 sm:items-center" role="dialog" aria-modal="true" aria-label="Inspeksi terpandu">
      <div className="flex max-h-[96dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] bg-[#15181D] text-white sm:rounded-[28px]">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#FFD60A]">Inspeksi terpandu · {c.id}</p>
            <p className="text-lg font-extrabold">{c.report.damageTypeLabel} — {c.report.segmentName}</p>
            <p className="text-xs text-[#A1A1AA]">Ambil 3 foto wajib dari sisi berbeda. Setiap foto langsung dianalisis AI, lalu ukur dengan meteran.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="cursor-pointer rounded-full p-2 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <section>
            <p className="mb-2 text-sm font-extrabold">1 · Foto dari segala sisi</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {INSPECTION_ANGLES.map((a) => {
                const s = shots[a];
                const g = ANGLE_GUIDE[a];
                const required = REQUIRED_ANGLES.includes(a);
                return (
                  <label key={a} className={`relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border ${s ? 'border-[#2BD67B]/60' : required ? 'border-[#FFD60A]/60 border-dashed' : 'border-white/15 border-dashed'} bg-[#0B0D10]`}>
                    <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { void capture(a, e.target.files?.[0]); e.target.value = ''; }} aria-label={g.title} />
                    <div className="relative grid h-28 shrink-0 place-items-center overflow-hidden bg-black/40">
                      {s ? <img src={s.photoUrl} alt={g.title} className="absolute inset-0 h-full w-full object-cover" /> : <Camera className="h-7 w-7 text-[#FFD60A]" />}
                      {s?.marks && <MarksOverlay marks={s.marks} />}
                      {s?.state === 'analysing' && <span className="absolute inset-0 grid place-items-center bg-black/55 text-xs"><Loader2 className="mb-1 h-5 w-5 animate-spin text-[#FFD60A]" />AI menganalisis…</span>}
                    </div>
                    <div className="p-2.5">
                      <p className="text-xs font-extrabold">{g.title} {required ? <span className="text-[#FFD60A]">· wajib</span> : <span className="text-[#71717A]">· opsional</span>}</p>
                      {!s && <p className="mt-0.5 text-[11px] leading-snug text-[#A1A1AA]">{g.how}</p>}
                      {s?.state === 'done' && (
                        <p className="mt-0.5 text-[11px] leading-snug text-[#2BD67B]">
                          {s.analysis?.primary ? `${s.analysis.primary.label} ${Math.round((s.analysis.primary.confidence ?? 0) * 100)}%` : 'AI: tidak ada kerusakan yang jelas'}
                          {s.analysis?.hazards?.includes('GENANGAN') ? ' · genangan' : ''}
                        </p>
                      )}
                      {s?.state === 'error' && <p className="mt-0.5 text-[11px] text-[#FF4D5E]">AI gagal: {s.error}. Foto tetap terlampir.</p>}
                      {s && ANGLE_MEASURES[a].length > 0 && (
                        <button type="button" onClick={(e) => { e.preventDefault(); setMeasuring(a); }} className="mt-1.5 w-full cursor-pointer rounded-lg bg-[#38BDF8]/15 py-1.5 text-[11px] font-bold text-[#38BDF8]">
                          {s.marks?.items.length ? Object.entries(measureFromMarks(s.marks)).map(([k, v]) => `${MEASURE_LABEL[k as MeasureKind]} ${v} cm`).join(' · ') : `Ukur ${ANGLE_MEASURES[a].map((k) => MEASURE_LABEL[k].toLowerCase()).join(' & ')} di foto`}
                        </button>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0B0D10] p-3">
            <p className="text-sm font-extrabold">2 · Ringkasan AI dari {summary.analysed} foto</p>
            {summary.analysed === 0 ? (
              <p className="text-xs text-[#A1A1AA]">Muncul setelah foto pertama dianalisis.</p>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div><p className="text-[#A1A1AA]">Jenis (konsensus)</p><p className="font-bold">{summary.consensusLabel ?? '—'}</p><p className="text-[#71717A]">{summary.agreement.agree}/{summary.agreement.of} foto setuju</p></div>
                <div><p className="text-[#A1A1AA]">Keparahan tertinggi</p><p className="font-bold">{summary.suggestedSeverity ? SEV_LABEL[summary.suggestedSeverity] : 'Belum jelas'}</p></div>
                <div><p className="text-[#A1A1AA]">Total temuan</p><p className="font-bold">{summary.detections} area</p></div>
                <div><p className="text-[#A1A1AA]">Genangan</p><p className="font-bold">{summary.flooded ? 'Ya' : 'Tidak'}</p></div>
              </div>
            )}
            {summary.missing.length > 0 && <p className="mt-2 text-xs text-[#FFD60A]">Belum ada: {summary.missing.map((m) => ANGLE_GUIDE[m].title).join(', ')}</p>}
          </section>

          <section>
            <p className="mb-1 flex items-center gap-2 text-sm font-extrabold"><Ruler className="h-4 w-4 text-[#FFD60A]" />3 · Ukuran kerusakan</p>
            <p className="mb-2 text-[11px] text-[#A1A1AA]">Ukur langsung di foto: letakkan meteran / A4 / KTP di foto atas, berdirikan meteran di titik terdalam pada foto samping dan detail. Kedalaman dari beberapa foto dirata-rata. Atau isi dari meteran.</p>
            <div className="grid grid-cols-3 gap-2">
              {(['lengthCm', 'widthCm', 'depthCm'] as const).map((k) => (
                <label key={k} className="block text-xs text-[#A1A1AA]">
                  {k === 'lengthCm' ? 'Panjang (cm)' : k === 'widthCm' ? 'Lebar (cm)' : 'Dalam (cm)'}
                  <input type="number" inputMode="decimal" min="0" step="0.5" className={`${INPUT} mt-1`} value={dims[k]} onChange={(e) => setDims({ ...dims, [k]: e.target.value })} />
                </label>
              ))}
            </div>
            {Object.keys(fromPhotos).length > 0 && (
              <div className="mt-2 rounded-xl border border-[#38BDF8]/30 bg-[#38BDF8]/5 p-2.5 text-xs">
                <p className="font-bold text-[#38BDF8]">Terukur dari foto (skala pembanding)</p>
                {(Object.entries(fromPhotos) as Array<[MeasureKind, NonNullable<(typeof fromPhotos)[MeasureKind]>]>).map(([k, m]) => (
                  <p key={k} className="text-[#D4D4D8]">
                    {MEASURE_LABEL[k]}: <b>{m.cm} cm</b> dari {m.n} foto{m.spreadPct !== null ? ` · selisih antar-foto ${m.spreadPct}%${m.spreadPct > 20 ? ' (ukur ulang)' : ''}` : ''}
                  </p>
                ))}
                <button type="button" onClick={() => setDims({ lengthCm: String(fromPhotos.LENGTH?.cm ?? dims.lengthCm), widthCm: String(fromPhotos.WIDTH?.cm ?? dims.widthCm), depthCm: String(fromPhotos.DEPTH?.cm ?? dims.depthCm) })} className="mt-1.5 cursor-pointer rounded-lg bg-[#38BDF8] px-3 py-1.5 font-bold text-[#0B0D10]">
                  Pakai ukuran dari foto
                </button>
              </div>
            )}
            <p className="mt-2 text-xs text-[#A1A1AA]">
              Luas: <b className="text-white">{area !== null ? `${area} m²` : '—'}</b> · Volume bahan tambal: <b className="text-white">{volume !== null ? `${volume} m³` : '—'}</b>
            </p>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-[#A1A1AA]">4 · Kesimpulan
              <select className={`${INPUT} mt-1`} value={verdict} onChange={(e) => setVerdict(e.target.value as typeof verdict)}>
                <option value="CONFIRMED">Kerusakan terkonfirmasi</option>
                <option value="NOT_CONFIRMED">Tidak ditemukan kerusakan</option>
              </select>
            </label>
            <label className="block text-xs text-[#A1A1AA]">Keparahan (saran AI: {summary.suggestedSeverity ? SEV_LABEL[summary.suggestedSeverity] : '—'})
              <select className={`${INPUT} mt-1`} value={effSeverity} onChange={(e) => setSeverity(e.target.value as keyof typeof SEV_LABEL)}>
                {Object.entries(SEV_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block text-xs text-[#A1A1AA] sm:col-span-2">Catatan lapangan (wajib)
              <textarea className={`${INPUT} mt-1`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Mis. lubang di lajur kiri, tepi terkelupas, air menggenang setelah hujan, belum ada rambu." />
            </label>
          </section>
        </div>

        {measuring && shots[measuring] && (
          <PhotoMeasure
            photoUrl={shots[measuring]!.photoUrl}
            title={ANGLE_GUIDE[measuring].title}
            kinds={ANGLE_MEASURES[measuring]}
            initial={shots[measuring]!.marks}
            onClose={() => setMeasuring(null)}
            onDone={(marks) => {
              setShots((s) => ({ ...s, [measuring]: { ...s[measuring]!, marks } }));
              setMeasuring(null);
            }}
          />
        )}
        <div className="border-t border-white/10 p-4">
          {err && <p role="alert" className="mb-2 text-xs text-[#FF4D5E]">{err}</p>}
          <button type="button" disabled={!ready || busy} onClick={() => void submit()} className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#FFD60A] py-3.5 text-sm font-extrabold text-[#0B0D10] disabled:cursor-not-allowed disabled:opacity-40">
            <CheckCircle2 className="h-4 w-4" />{busy ? 'Mengirim…' : 'Kirim kasus ke Koordinator'}
          </button>
          {!ready && <p className="mt-2 text-center text-[11px] text-[#A1A1AA]">Lengkapi 3 foto wajib, ukuran panjang × lebar, dan catatan.</p>}
        </div>
      </div>
    </div>
  );
};
