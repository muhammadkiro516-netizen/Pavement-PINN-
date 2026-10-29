import React, { useState } from 'react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useWsT } from '../i18n';
import { useWorkspace } from '../WorkspaceContext';
import { ActionButton, Row, SectionTitle, StatusBadge, UnavailableCard } from '../components/shared';
import { CorrectionDialog, Modal, PolygonEditor } from '../components/dialogs';
import { SHARPNESS_THRESHOLD, useFrameQc } from '../frameQc';
import { DAMAGE_CLASSES, type DamageClass, type DamageObject } from '../../../domain/workspace/types';
import { latestRuns } from '../../../domain/workspace/rerun';
import { CLASS_HIERARCHY, classLabel, classPath } from '../labels';

type Mode = 'original' | 'mask' | 'overlay' | 'tracking';
const FRAME_W = 600;
const FRAME_H = 600;

/** Guided capture slots (reference L1 for cracks; spec/01 T0 for potholes). */
export const CAPTURE_SLOTS: Record<'crack' | 'pothole', Array<[string, string]>> = {
  crack: [
    ['Foto A', 'seluruh panjang crack dari atas'],
    ['Foto B–D', 'beberapa foto overlap sepanjang crack'],
    ['Foto E', 'close-up bagian terlebar/terjelas'],
    ['Foto F', 'ujung crack dan permukaan normal di sekitarnya'],
    ['Skala', 'penanda sebidang dengan crack, tidak menutupi kerusakan']
  ],
  pothole: [
    ['konteks', 'foto konteks lajur dan sekitar'],
    ['nadir', 'tegak lurus dari atas lubang'],
    ['sekuens memutar', '15–30 foto memutar, overlap 60–80 %'],
    ['penanda skala', 'kartu 85,6 mm atau ArUco sebidang']
  ]
};

const slotsFor = (o: DamageObject | null) => (o?.class.value.startsWith('crack') ? CAPTURE_SLOTS.crack : CAPTURE_SLOTS.pothole);

function useActiveFrame() {
  const { workspace: w, activeObject } = useWorkspace();
  const frames = w?.frames ?? [];
  const objectFrames = activeObject ? frames.filter((f) => activeObject.geometryRefs.frameIds.includes(f.frameId)) : frames;
  return { frames, objectFrames, first: objectFrames[0] ?? frames[0] ?? null };
}

export const CameraMain: React.FC = () => {
  const t = useWsT();
  const { workspace: w, activeObject, setActiveObject } = useWorkspace();
  const { frames, first } = useActiveFrame();
  const [mode, setMode] = useState<Mode>('overlay');
  const [frameId, setFrameId] = useState<string | null>(null);
  const qc = useFrameQc(frames);
  const frame = frames.find((f) => f.frameId === frameId) ?? first;
  if (!w) return null;
  if (!frame) return <UnavailableCard reason="Belum ada foto untuk laporan ini." />;
  const idx = frames.indexOf(frame);

  const shapes = w.objects.flatMap((o) => {
    const box = o.geometryRefs.boxes?.[frame.frameId];
    const mask = o.geometryRefs.masks?.[frame.frameId];
    return box || mask ? [{ o, box, mask }] : [];
  });
  const chart = frames.map((f, i) => ({ i: i + 1, id: f.frameId, v: qc[f.frameId]?.sharpness ?? null, rejected: f.accepted === false }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['original', 'mask', 'overlay', 'tracking'] as Mode[]).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-md px-2.5 py-1 text-[12px] ${mode === m ? 'bg-[#1D4573] text-white' : 'bg-[#16202C] text-[#C9D4E3]'}`}>
            {{ original: 'Original', mask: 'Detection Mask', overlay: 'Overlay', tracking: 'Tracking' }[m]}
          </button>
        ))}
        <span className="rounded-md bg-[#16202C] px-2.5 py-1 text-[12px] text-[#C9D4E3]">Frame {idx + 1} / {frames.length}</span>
        {frame.slot && <StatusBadge tone="grey">{frame.slot}</StatusBadge>}
        {w.demo && <StatusBadge tone="violet">DATA CONTOH · foto referensi dataset RDD2022</StatusBadge>}
      </div>
      <div className="relative mx-auto aspect-square w-full max-w-[640px] overflow-hidden rounded-xl bg-black" data-testid="frame-viewer">
        <img src={frame.uri} alt={frame.frameId} className={`absolute inset-0 h-full w-full object-cover ${mode === 'mask' ? 'opacity-25 grayscale' : ''}`} crossOrigin="anonymous" />
        <svg viewBox={`0 0 ${FRAME_W} ${FRAME_H}`} className="absolute inset-0 h-full w-full">
          {mode !== 'original' &&
            shapes.map(({ o, box, mask }) => {
              const active = o.objectId === activeObject?.objectId;
              return (
                <g key={o.objectId} onClick={() => setActiveObject(o.objectId)} className="cursor-pointer" data-testid={`shape-${o.objectId}`}>
                  {mask && <polygon points={mask.map((p) => p.join(',')).join(' ')} fill={mode === 'mask' ? '#E94BD6' : 'rgba(233,75,214,0.45)'} />}
                  {/* Mask mode without a polygon mask: shade the annotation box, labelled as a box, not a mask. */}
                  {box && !mask && mode === 'mask' && <rect x={box[0]} y={box[1]} width={box[2] - box[0]} height={box[3] - box[1]} fill="rgba(233,75,214,0.55)" stroke="#E94BD6" strokeDasharray="8 6" strokeWidth={2} />}
                  {box && !mask && mode === 'mask' && <text x={box[0] + 4} y={box[3] + 20} fill="#F5D0FE" fontSize={16} stroke="#000" strokeWidth={3} paintOrder="stroke">area bbox (belum ada mask poligon)</text>}
                  {box && mode !== 'mask' && <rect x={box[0]} y={box[1]} width={box[2] - box[0]} height={box[3] - box[1]} fill="transparent" stroke={active ? '#FFD60A' : '#EF4444'} strokeWidth={3} />}
                  {box && mode !== 'mask' && (
                    <text x={box[0] + 4} y={box[1] - 6} fill="#fff" fontSize={18} fontWeight={700} stroke="#000" strokeWidth={3} paintOrder="stroke">
                      {o.objectId} · {classLabel(o.class.value)}{o.severity.value ? ` · ${o.severity.value}` : ''}{!mask ? ' · bbox' : ''}{o.class.confidence !== null ? ` ${o.class.confidence.toFixed(2)}` : ''}
                    </text>
                  )}
                  {mode === 'tracking' && <text x={10} y={FRAME_H - 12} fill="#8CC4FF" fontSize={16}>{o.objectId}: {o.geometryRefs.frameIds.join(' → ')}</text>}
                </g>
              );
            })}
        </svg>
        {shapes.some((x) => !x.mask) && mode === 'overlay' && <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[11px] text-[#F5C451]">Kotak = anotasi bbox dataset RDD2022 (lokasi & perkiraan area saja) — bukan mask/kontur, bukan bukti geometri 3D</div>}
        {shapes.length === 0 && mode !== 'original' && <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[11px] text-[#C9D4E3]">Belum ada deteksi/mask pada frame ini</div>}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" data-testid="thumb-strip">
        {frames.map((f) => (
          <button key={f.frameId} type="button" onClick={() => setFrameId(f.frameId)} className={`shrink-0 rounded-md border-2 px-3 py-2 text-[12px] ${f.frameId === frame.frameId ? 'border-[#3B82F6]' : f.accepted === false ? 'border-[#EF4444]' : 'border-[#273244]'} bg-[#0B121A]`}>
            {f.frameId}
          </button>
        ))}
      </div>
      <div className="h-40 w-full max-w-[520px]">
        <div className="text-[11px] text-[#9AA8BC]">Skor ketajaman per frame (varians Laplacian, ambang ASSUMED {SHARPNESS_THRESHOLD})</div>
        {chart.some((c) => c.v !== null) ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: -10 }}>
              <XAxis dataKey="i" tick={{ fill: '#8B9BB0', fontSize: 10 }} />
              <YAxis tick={{ fill: '#8B9BB0', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#0B121A', border: '1px solid #273244', fontSize: 12 }} />
              <ReferenceLine y={SHARPNESS_THRESHOLD} stroke="#F5C451" strokeDasharray="4 3" />
              <Bar dataKey="v" isAnimationActive={false}>
                {chart.map((c) => (
                  <Cell key={c.id} fill={c.rejected || (c.v !== null && c.v < SHARPNESS_THRESHOLD) ? '#EF4444' : '#38BDF8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-6 text-[12px] italic text-[#8B9BB0]">Ketajaman belum dapat dihitung: {Object.values(qc)[0]?.reason ?? 'memuat foto…'}</p>
        )}
      </div>
    </div>
  );
};

export const CameraPanel: React.FC = () => {
  const t = useWsT();
  const { workspace: w, activeObject: o, isFieldEngineer, isOpsManager, run, reportId } = useWorkspace();
  const { frames, objectFrames, first } = useActiveFrame();
  const qc = useFrameQc(frames);
  const [dialog, setDialog] = useState<null | 'wrong' | 'class' | 'mask' | 'merge' | 'split' | 'photos'>(null);
  const [cls, setCls] = useState<DamageClass>('pothole');
  const [poly, setPoly] = useState<Array<[number, number]>>([]);
  const [mergeWith, setMergeWith] = useState('');
  const [photoReason, setPhotoReason] = useState('');
  const locked = isFieldEngineer ? null : t('feOnly');
  if (!w) return null;
  const accepted = frames.filter((f) => f.accepted === true).length;
  const rejected = frames.filter((f) => f.accepted === false).length;
  const fq = first ? qc[first.frameId] : undefined;
  const t3 = latestRuns(w.stageRuns).T3_detect;
  const slots = slotsFor(o);

  return (
    <div>
      <SectionTitle>Deteksi</SectionTitle>
      <Row label="Kelas">{o ? `${classLabel(o.class.value)}${o.class.modelVersion ? ` (model ${o.class.modelVersion})` : o.class.correctedBy ? ' (koreksi F.E)' : o.class.value !== 'unclassified' ? ' (diisi manual, tanpa model)' : ''}` : '—'}</Row>
      {o && CLASS_HIERARCHY[o.class.value] && (
        <>
          <Row label="Hierarki">{classPath(o.class.value)}</Row>
          <Row label="Subjenis (definisi kelas)">{CLASS_HIERARCHY[o.class.value].subtype}</Row>
          <Row label="Keparahan">{o.severity.value ?? <span className="italic text-[#8B9BB0]">{o.severity.rule}</span>}</Row>
          <Row label="Parameter diukur">{CLASS_HIERARCHY[o.class.value].params}</Row>
        </>
      )}
      <Row label="Confidence">{o?.class.confidence !== null && o?.class.confidence !== undefined ? o.class.confidence.toFixed(2) : <span className="italic text-[#8B9BB0]">belum diklasifikasi (tanpa model)</span>}</Row>
      <Row label="Frame asal">{o ? `${o.geometryRefs.frameIds.join(', ')} (${o.geometryRefs.frameIds.length} frame)` : '—'}</Row>
      <SectionTitle>Kualitas foto (QC)</SectionTitle>
      <Row label="Diterima / ditolak">{accepted} / {rejected}</Row>
      <Row label={`Ketajaman ${first?.frameId ?? ''}`}>
        {fq?.sharpness !== null && fq?.sharpness !== undefined ? (
          <span className="inline-flex items-center gap-1.5">{fq.sharpness.toFixed(0)} <StatusBadge tone={fq.sharpness >= SHARPNESS_THRESHOLD ? 'green' : 'red'}>{fq.sharpness >= SHARPNESS_THRESHOLD ? 'ok' : 'buram'}</StatusBadge></span>
        ) : (
          <span className="italic text-[#8B9BB0]">{fq?.reason ?? 'menghitung…'}</span>
        )}
      </Row>
      <Row label="Exposure">{fq?.saturatedPct !== null && fq?.saturatedPct !== undefined ? `${fq.saturatedPct.toFixed(1)} % jenuh` : <span className="italic text-[#8B9BB0]">{fq?.reason ?? '—'}</span>}</Row>
      <Row label="Overlap"><span className="italic text-[#8B9BB0]">butuh pencocokan fitur T1</span></Row>
      <Row label="Penanda skala">{o?.quality.scaleStatus === 'valid' ? `valid ± ${o.quality.scaleUncertaintyMm ?? '?'} mm` : <span className="italic text-[#8B9BB0]">Tanpa skala: hanya geometri relatif</span>}</Row>
      <SectionTitle>{t('validationStatus')}</SectionTitle>
      <StatusBadge tone={t3?.status === 'completed' ? 'green' : 'amber'}>{t3?.status === 'completed' ? 'Deteksi ditinjau' : 'Deteksi belum ditinjau — metrik 3D provisional'}</StatusBadge>
      <SectionTitle>Checklist foto terpandu</SectionTitle>
      <ul className="space-y-1 text-[12px]" data-testid="capture-checklist">
        {slots.map(([slot, hint]) => {
          const have = objectFrames.some((f) => (f.slot ?? '').toLowerCase().startsWith(slot.toLowerCase().slice(0, 6)));
          return (
            <li key={slot} className="flex items-start gap-2">
              <span className={have ? 'text-[#6EE7A8]' : 'text-[#6B7A90]'}>{have ? '●' : '○'}</span>
              <span><b>{slot}</b>: {hint}</span>
            </li>
          );
        })}
      </ul>
      <SectionTitle>{isOpsManager ? t('omActions') : t('feActions')}</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <ActionButton locked={locked} onClick={() => setDialog('wrong')}>Tandai salah deteksi</ActionButton>
        <ActionButton locked={locked} onClick={() => setDialog('class')}>Ubah kelas</ActionButton>
        <ActionButton locked={locked} onClick={() => { setPoly(o && first ? ((o.geometryRefs.masks?.[first.frameId] ?? []) as Array<[number, number]>) : []); setDialog('mask'); }}>Sunting mask</ActionButton>
        <ActionButton locked={locked} onClick={() => setDialog('merge')}>Gabungkan</ActionButton>
        <ActionButton locked={locked} onClick={() => setDialog('split')}>Pisahkan</ActionButton>
        <ActionButton primary onClick={() => setDialog('photos')}>{t('requestPhotos')}</ActionButton>
      </div>

      {o && dialog === 'wrong' && <CorrectionDialog title="Tandai salah deteksi" kind="class" field="class.value" objectId={o.objectId} newValue="not_damage" onClose={() => setDialog(null)} />}
      {o && dialog === 'class' && (
        <CorrectionDialog title="Ubah kelas" kind="class" field="class.value" objectId={o.objectId} newValue={cls} onClose={() => setDialog(null)}>
          <select value={cls} onChange={(e) => setCls(e.target.value as DamageClass)} className="w-full rounded-lg border border-[#273244] bg-[#0A0F14] p-2 text-[13px]">
            {DAMAGE_CLASSES.map((c) => <option key={c} value={c}>{classLabel(c)}</option>)}
          </select>
        </CorrectionDialog>
      )}
      {o && first && dialog === 'mask' && (
        <CorrectionDialog title={`Sunting mask · ${first.frameId}`} kind="mask" field={`geometryRefs.masks.${first.frameId}`} objectId={o.objectId} newValue={poly} valid={poly.length >= 3} onClose={() => setDialog(null)}>
          <p className="mb-2 text-[11px] text-[#9AA8BC]">Klik untuk menambah titik, seret untuk memindah, klik kanan untuk menghapus. Minimal 3 titik.</p>
          <div className="mx-auto max-w-[420px]">
            <PolygonEditor width={FRAME_W} height={FRAME_H} value={poly} onChange={setPoly} background={<img src={first.uri} alt="" className="h-full w-full object-cover" />} />
          </div>
        </CorrectionDialog>
      )}
      {o && dialog === 'merge' && (
        <CorrectionDialog title="Gabungkan objek" kind="merge" field="mergeWith" objectId={o.objectId} newValue={mergeWith} valid={!!mergeWith} onClose={() => setDialog(null)}>
          <select value={mergeWith} onChange={(e) => setMergeWith(e.target.value)} className="w-full rounded-lg border border-[#273244] bg-[#0A0F14] p-2 text-[13px]">
            <option value="">Pilih objek…</option>
            {w.objects.filter((x) => x.objectId !== o.objectId).map((x) => <option key={x.objectId} value={x.objectId}>{x.objectId}</option>)}
          </select>
        </CorrectionDialog>
      )}
      {o && dialog === 'split' && <CorrectionDialog title="Pisahkan objek" kind="split" field="splitAt" objectId={o.objectId} newValue={{ frameId: first?.frameId ?? null }} onClose={() => setDialog(null)} />}
      {dialog === 'photos' && (
        <Modal title={t('requestPhotos')} onClose={() => setDialog(null)}>
          <p className="text-[12px] text-[#9AA8BC]">Instruksi slot foto untuk {o?.objectId ?? 'laporan'}:</p>
          <ul className="mt-1 list-disc pl-5 text-[12px] text-[#C9D4E3]">{slots.map(([s, h]) => <li key={s}><b>{s}</b>: {h}</li>)}</ul>
          <textarea value={photoReason} onChange={(e) => setPhotoReason(e.target.value)} rows={2} placeholder={t('reasonRequired')} className="mt-2 w-full rounded-lg border border-[#273244] bg-[#0A0F14] p-2 text-[13px] text-white" />
          <div className="mt-3 flex justify-end">
            <button type="button" disabled={photoReason.trim().length < 5} onClick={async () => { await run((g) => g.requestPhotos(reportId, { objectId: o?.objectId, slots: slots.map(([s]) => s), reason: photoReason })); setDialog(null); setPhotoReason(''); }} className="rounded-lg bg-[#FFD60A] px-3 py-1.5 text-[12px] font-semibold text-[#0A0F14] disabled:opacity-40">OK</button>
          </div>
        </Modal>
      )}
    </div>
  );
};

