import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useWsT } from '../i18n';
import { useWorkspace } from '../WorkspaceContext';
import { ActionButton, MeasuredValue, Row, SectionTitle, StatusBadge, turbo } from '../components/shared';
import { CorrectionDialog, Modal, PolygonEditor } from '../components/dialogs';
import { latestRuns } from '../../../domain/workspace/rerun';
import { verdictFor } from '../../../domain/workspace/metrics';
import type { SurfaceGrid } from '../../../domain/workspace/types';

/** Top view of the depth grid as an image, for drawing contours and placing measure points. */
const DepthImage: React.FC<{ g: SurfaceGrid }> = ({ g }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    c.width = g.cols;
    c.height = g.rows;
    let max = 0;
    for (const row of g.depth) for (const d of row) if (d !== null && d > max) max = d;
    for (let r = 0; r < g.rows; r++)
      for (let k = 0; k < g.cols; k++) {
        const d = g.depth[r][k];
        ctx.fillStyle = d === null ? '#333' : turbo(0.15 + 0.85 * (Math.max(0, d) / (max || 1)));
        ctx.fillRect(k, r, 1, 1);
      }
  }, [g]);
  return <canvas ref={ref} className="h-full w-full" style={{ imageRendering: 'pixelated' }} />;
};

export const DamagePanel: React.FC = () => {
  const t = useWsT();
  const { workspace: w, activeObject: o, isFieldEngineer, isOpsManager, run, reportId } = useWorkspace();
  const [dialog, setDialog] = useState<null | 'contour' | 'plane' | 'point' | 'rerun'>(null);
  const surface = w?.surfaces.find((s) => s.objectId === o?.objectId) ?? null;
  const [poly, setPoly] = useState<Array<[number, number]>>([]);
  const [pt, setPt] = useState<{ x: number; y: number; ref: string; tool: string }>({ x: 0, y: 0, ref: '', tool: 'jangka sorong + mistar lurus' });
  const [err, setErr] = useState<string | null>(null);
  const locked = isFieldEngineer ? null : t('feOnly');
  const simplified = useMemo(() => (surface ? (surface.contour as Array<[number, number]>).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 32)) === 0) : []), [surface]);
  if (!w || !o) return null;
  const m = o.measurements;
  const scale = o.quality.scaleStatus;
  const q = o.quality;
  const latest = latestRuns(w.stageRuns);
  const gt = w.groundTruth.filter((p) => p.objectId === o.objectId);
  const passed = gt.filter((p) => verdictFor(p) === 'PASS').length;

  return (
    <div>
      <SectionTitle>Metrik geometri (mm)</SectionTitle>
      <Row label="Panjang × lebar">
        <span className="flex flex-col items-end gap-0.5">
          <MeasuredValue m={m.lengthMm} scale={scale} digits={0} />
          <MeasuredValue m={m.widthMaxMm} scale={scale} digits={0} />
        </span>
      </Row>
      <Row label="Luas"><MeasuredValue m={m.areaM2} scale={scale} digits={3} /></Row>
      <Row label="Kedalaman maks"><MeasuredValue m={m.depthMaxMm} scale={scale} /></Row>
      <Row label="Kedalaman rata-rata"><MeasuredValue m={m.depthMeanMm} scale={scale} /></Row>
      <Row label="Volume (integrasi defisit)"><MeasuredValue m={m.volumeL} scale={scale} digits={2} /></Row>
      <Row label="Keparahan">{o.severity.value ?? <span className="italic text-[#8B9BB0]">{o.severity.rule}</span>}</Row>
      <SectionTitle>{t('sourceQuality')}</SectionTitle>
      <Row label="Skala">{scale === 'valid' ? `penanda · ± ${q.scaleUncertaintyMm ?? '?'} mm` : <span className="italic text-[#8B9BB0]">{scale === 'relative_only' ? 'relatif saja' : 'tidak ada penanda'}</span>}</Row>
      <Row label="Reprojection error">{q.reprojErrorPx != null ? `${q.reprojErrorPx.toFixed(2)} px` : <span className="italic text-[#8B9BB0]">tidak tersedia (tanpa SfM)</span>}</Row>
      <Row label="Coverage">{q.coveragePct != null ? `${q.coveragePct.toFixed(0)} %` : <span className="italic text-[#8B9BB0]">—</span>}</Row>
      <Row label="Residual bidang">{q.planeRmsMm != null ? `${q.planeRmsMm.toFixed(2)} mm RMS` : <span className="italic text-[#8B9BB0]">—</span>}</Row>
      <SectionTitle>{t('validationStatus')}</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        <StatusBadge tone={scale === 'valid' ? 'green' : 'grey'}>{scale === 'valid' ? 'Skala valid' : 'Tanpa skala'}</StatusBadge>
        <StatusBadge tone={gt.length ? (passed === gt.length ? 'green' : 'amber') : 'grey'}>{gt.length ? `Validasi lapangan ${passed}/${gt.length} titik` : t('validationUnavailable')}</StatusBadge>
        {latest.T5_quantify && <StatusBadge tone={latest.T5_quantify.status === 'completed' ? 'green' : 'amber'}>T5 {latest.T5_quantify.status}</StatusBadge>}
      </div>
      <SectionTitle>{isOpsManager ? t('omActions') : t('feActions')}</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <ActionButton locked={locked ?? (surface ? null : t('no3d'))} onClick={() => setDialog('plane')}>Ganti bidang referensi</ActionButton>
        <ActionButton testId="edit-contour" locked={locked ?? (surface ? null : t('no3d'))} onClick={() => { setPoly(simplified); setDialog('contour'); }}>Sunting kontur</ActionButton>
        <ActionButton testId="add-point" locked={locked ?? (surface ? null : t('no3d'))} onClick={() => setDialog('point')}>Tambah titik ukur</ActionButton>
        <ActionButton primary locked={locked ?? (surface ? null : t('no3d'))} onClick={() => setDialog('rerun')}>Rerun T4–T6</ActionButton>
      </div>

      {surface && dialog === 'contour' && (
        <CorrectionDialog title={`Sunting kontur · ${o.objectId}`} kind="contour" field="contour" objectId={o.objectId} newValue={poly} valid={poly.length >= 3} onClose={() => setDialog(null)}>
          <p className="mb-2 text-[11px] text-[#9AA8BC]">Tampak atas peta kedalaman. Klik untuk menambah titik, seret untuk memindah, klik kanan untuk menghapus.</p>
          <div className="mx-auto max-w-[420px]">
            <PolygonEditor width={surface.cols * surface.cellSize} height={surface.rows * surface.cellSize} value={poly} onChange={setPoly} background={<DepthImage g={surface} />} />
          </div>
        </CorrectionDialog>
      )}
      {surface && dialog === 'rerun' && (
        <CorrectionDialog title="Jalankan ulang T4–T6 dengan kontur saat ini" kind="contour" field="contour" objectId={o.objectId} newValue={surface.contour} onClose={() => setDialog(null)} />
      )}
      {surface && dialog === 'plane' && (
        <CorrectionDialog title="Ganti bidang referensi" kind="reference_plane" field="quality.referencePlane" objectId={o.objectId} newValue={{ method: 'ring', ringMarginCells: 3 }} onClose={() => setDialog(null)}>
          <p className="text-[12px] text-[#9AA8BC]">Bidang referensi dihitung ulang dari cincin di sekitar kerusakan (RANSAC + kuadrat terkecil), sesuai spesifikasi T4.</p>
        </CorrectionDialog>
      )}
      {surface && dialog === 'point' && (
        <Modal title={`Tambah titik ukur · ${o.objectId}`} onClose={() => setDialog(null)}>
          <p className="mb-2 text-[11px] text-[#9AA8BC]">Klik peta untuk posisi titik. Nilai sistem dibaca server dari permukaan tersimpan.</p>
          <div className="relative mx-auto max-w-[320px]" style={{ aspectRatio: '1 / 1' }} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPt((p) => ({ ...p, x: Math.round(((e.clientX - r.left) / r.width) * surface.cols * surface.cellSize), y: Math.round(((e.clientY - r.top) / r.height) * surface.rows * surface.cellSize) })); }}>
            <DepthImage g={surface} />
            <span className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#FFD60A]" style={{ left: `${(pt.x / (surface.cols * surface.cellSize)) * 100}%`, top: `${(pt.y / (surface.rows * surface.cellSize)) * 100}%` }} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
            <label>x (mm)<input type="number" value={pt.x} onChange={(e) => setPt({ ...pt, x: Number(e.target.value) })} className="w-full rounded border border-[#273244] bg-[#0A0F14] p-1" /></label>
            <label>y (mm)<input type="number" value={pt.y} onChange={(e) => setPt({ ...pt, y: Number(e.target.value) })} className="w-full rounded border border-[#273244] bg-[#0A0F14] p-1" /></label>
            <label>Referensi manual (mm) *<input data-testid="gt-ref" type="number" value={pt.ref} onChange={(e) => setPt({ ...pt, ref: e.target.value })} className="w-full rounded border border-[#273244] bg-[#0A0F14] p-1" /></label>
            <label>Alat<input value={pt.tool} onChange={(e) => setPt({ ...pt, tool: e.target.value })} className="w-full rounded border border-[#273244] bg-[#0A0F14] p-1" /></label>
          </div>
          {err && <p className="mt-2 text-[12px] text-[#F59AA3]">{err}</p>}
          <div className="mt-3 flex justify-end">
            <button type="button" data-testid="gt-submit" disabled={pt.ref === '' || !Number.isFinite(Number(pt.ref))} onClick={async () => { const r = await run((g) => g.groundTruth(reportId, { objectId: o.objectId, xMm: pt.x, yMm: pt.y, referenceMm: Number(pt.ref), tool: pt.tool })); if ('message' in r) setErr(r.message); else setDialog(null); }} className="rounded-lg bg-[#FFD60A] px-3 py-1.5 text-[12px] font-semibold text-[#0A0F14] disabled:opacity-40">OK</button>
          </div>
        </Modal>
      )}
    </div>
  );
};
