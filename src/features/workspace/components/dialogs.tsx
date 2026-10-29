import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useWsT } from '../i18n';
import { useWorkspace } from '../WorkspaceContext';
import type { CorrectionKind } from '../../../domain/workspace/types';
import { RERUN_MATRIX } from '../../../domain/workspace/rerun';

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => (
  <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className={`max-h-[92vh] w-full overflow-auto rounded-t-2xl border border-[#273244] bg-[#0F1720] p-4 text-[#E6EDF3] shadow-2xl sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Tutup" className="rounded p-1 text-[#9AA8BC] hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

/**
 * Every F.E correction goes through here: the value comes from the caller, the reason is
 * mandatory, evidence optional; the dialog states which stages will rerun (contract §5).
 */
export const CorrectionDialog: React.FC<{
  title: string;
  kind: CorrectionKind;
  field: string;
  objectId?: string;
  newValue: unknown;
  onClose: () => void;
  children?: React.ReactNode;
  valid?: boolean;
}> = ({ title, kind, field, objectId, newValue, onClose, children, valid = true }) => {
  const t = useWsT();
  const { run, reportId } = useWorkspace();
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await run((g) => g.correct(reportId, { kind, field, objectId, newValue, reason, evidence: evidence.split(',').map((s) => s.trim()).filter(Boolean) }));
    setBusy(false);
    if ('message' in r) setError(r.message);
    else onClose();
  };
  return (
    <Modal title={title} onClose={onClose} wide={kind === 'contour' || kind === 'mask'}>
      {children}
      <label className="mt-3 block text-[12px] text-[#9AA8BC]">
        {t('reason')} *
        <textarea data-testid="correction-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-[#273244] bg-[#0A0F14] p-2 text-[13px] text-white" />
      </label>
      <label className="mt-2 block text-[12px] text-[#9AA8BC]">
        {t('evidence')}
        <input value={evidence} onChange={(e) => setEvidence(e.target.value)} className="mt-1 w-full rounded-lg border border-[#273244] bg-[#0A0F14] p-2 text-[13px] text-white" />
      </label>
      <p className="mt-2 text-[11px] text-[#8B9BB0]">Jalankan ulang: {RERUN_MATRIX[kind].join(' → ')}</p>
      {error && <p className="mt-2 text-[12px] text-[#F59AA3]">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-[#273244] px-3 py-1.5 text-[12px]">{t('cancel')}</button>
        <button type="button" data-testid="correction-submit" disabled={busy || reason.trim().length < 5 || !valid} onClick={submit} className="rounded-lg bg-[#FFD60A] px-3 py-1.5 text-[12px] font-semibold text-[#0A0F14] disabled:opacity-40" title={reason.trim().length < 5 ? t('reasonRequired') : undefined}>
          {t('submit')}
        </button>
      </div>
    </Modal>
  );
};

/**
 * Click to add vertices, drag to move, right-click a vertex to delete. Coordinates are in the
 * caller's units (`width` × `height` box), so the same editor serves photo masks (pixels) and
 * 3D contours (mm on the depth grid).
 */
export const PolygonEditor: React.FC<{
  width: number;
  height: number;
  value: Array<[number, number]>;
  onChange: (v: Array<[number, number]>) => void;
  background?: React.ReactNode;
}> = ({ width, height, value, onChange, background }) => {
  const [drag, setDrag] = useState<number | null>(null);
  const toLocal = (e: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * width, ((e.clientY - r.top) / r.height) * height];
  };
  const handle = Math.max(width, height) / 90;
  return (
    <div className="relative w-full" style={{ aspectRatio: `${width} / ${height}` }}>
      {background && <div className="absolute inset-0">{background}</div>}
      <svg
        data-testid="polygon-editor"
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
        onPointerDown={(e) => {
          if (e.button !== 0 || drag !== null) return;
          if ((e.target as Element).tagName === 'circle') return;
          onChange([...value, toLocal(e)]);
        }}
        onPointerMove={(e) => drag !== null && onChange(value.map((p, i) => (i === drag ? toLocal(e) : p)))}
        onPointerUp={() => setDrag(null)}
      >
        {value.length > 1 && <polygon points={value.map((p) => p.join(',')).join(' ')} fill="rgba(232,181,43,0.18)" stroke="#FFD60A" strokeWidth={handle / 3} />}
        {value.map((p, i) => (
          <circle
            key={i}
            cx={p[0]}
            cy={p[1]}
            r={handle}
            fill="#0A0F14"
            stroke="#FFD60A"
            strokeWidth={handle / 3}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
              setDrag(i);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onChange(value.filter((_, k) => k !== i));
            }}
          />
        ))}
      </svg>
    </div>
  );
};
