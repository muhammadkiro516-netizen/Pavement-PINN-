import React, { Suspense, useState } from 'react';
import { useWsT } from '../i18n';
import { useWorkspace } from '../WorkspaceContext';
import { ActionButton, SectionTitle, SOURCE_TONE, StatusBadge } from '../components/shared';
import { Modal } from '../components/dialogs';
import type { InputSource, Layer } from '../../../domain/workspace/types';

const Pavement3D = React.lazy(() => import('../components/Pavement3D'));

const LAYER_FILL: Record<string, string> = { AC: '#2B2F36', Base: '#6B5A45', Subbase: '#8E7D63', Subgrade: '#5E4632' };
/** A "measured" layer whose value came from a simulated core/DCP must not read as verified. */
export function layerSourceLabel(l: Layer): string {
  if (l.source === 'MISSING') return 'Tidak ada data';
  const simulated = [l.thicknessMm, l.modulusMPa].some((m) => /SIMULASI/i.test(m.source.method));
  if ((l.source === 'MEASURED' || l.source === 'DOCUMENT') && simulated) return 'Terukur (simulasi)';
  return SOURCE_LABEL[l.source];
}

const SOURCE_LABEL: Record<InputSource, string> = { MEASURED: 'Verified', DOCUMENT: 'Dokumen', DEFAULT: 'Default', ASSUMED: 'Assumed', MISSING: 'Missing' };

export const StructureMain: React.FC = () => {
  const { workspace: w, activeObject: o } = useWorkspace();
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [moisture, setMoisture] = useState<'kering' | 'lembap' | 'basah'>('lembap');
  if (!w) return null;
  const surface = w.surfaces.find((s) => s.objectId === o?.objectId);
  const depthMax = o?.quality.scaleStatus === 'valid' ? o.measurements.depthMaxMm.value : null;
  // Drawing scale: known thicknesses to scale; a layer without data gets a fixed visual band
  // labelled "TIDAK ADA DATA" (its height carries no meaning).
  const H = 380;
  const bands = w.layers.map((l) => ({ l, h: l.thicknessMm.value ?? (l.name === 'Subgrade' ? 140 : 120), known: l.thicknessMm.value !== null }));
  const total = bands.reduce((s, b) => s + b.h, 0);
  let y = 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {w.layers.map((l) => (
          <button key={l.name} type="button" onClick={() => setHidden((h) => ({ ...h, [l.name]: !h[l.name] }))} className={`rounded-md px-2.5 py-1 text-[12px] ${hidden[l.name] ? 'bg-[#16202C] text-[#6B7A90]' : 'bg-[#1D4573] text-white'}`}>
            {l.name}
          </button>
        ))}
        <span className="rounded-md bg-[#1D4573] px-2.5 py-1 text-[12px] text-white">Bidang potong @ {o?.objectId ?? '—'}</span>
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-[#9AA8BC]" title="Preset visual saja; kondisi tanah sebenarnya hanya dari data investigasi">
          Tampilan subgrade
          <select value={moisture} onChange={(e) => setMoisture(e.target.value as typeof moisture)} className="rounded border border-[#273244] bg-[#0A0F14] px-1.5 py-0.5">
            <option value="kering">kering</option>
            <option value="lembap">lembap</option>
            <option value="basah">basah</option>
          </select>
          <span className="text-[10px] text-[#6B7A90]">(visual)</span>
        </label>
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px]">
        <Suspense fallback={<div className="h-[420px] rounded-xl bg-[#0B121A]" />}>
          <Pavement3D mode="structure" layers={w.layers} surface={surface ?? null} hidden={hidden} moisture={moisture} />
        </Suspense>
        <ul className="space-y-2 text-[12px]" data-testid="layer-legend">
          {w.layers.map((l) => (
            <li key={l.name} className="flex items-start gap-2">
              <span className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm ${l.thicknessMm.value === null ? 'border border-dashed border-[#9AA8BC]' : ''}`} style={{ background: LAYER_FILL[l.name] }} />
              <span>
                <b>{l.name}</b> {l.name === 'Subgrade' ? '∞' : l.thicknessMm.value !== null ? `${l.thicknessMm.value} mm` : 'tebal tidak diketahui'}
                {l.modulusMPa.value !== null ? ` · E ${l.modulusMPa.value} MPa` : ''}
                <span className="block text-[11px] text-[#8B9BB0]">{layerSourceLabel(l)} — {l.thicknessMm.source.method}</span>
              </span>
            </li>
          ))}
          <li className="pt-1 text-[11px] text-[#6B7A90]">
            {surface
              ? "Lubang dipotong dari grid kedalaman tersimpan (vertikal ×2). Bidang biru = penampang A–A'. Putar/geser/zoom dengan mouse."
              : 'Belum ada geometri lubang: perlu sekuens foto 3D. Tebal lapis yang belum diisi digambar sebagai pita visual tanpa arti ukuran.'}
          </li>
        </ul>
      </div>
      <svg viewBox={`0 0 700 ${H + 30}`} className="w-full rounded-xl bg-[#0B121A]" data-testid="layer-section">
        <text x={360} y={16} fill="#8CC4FF" fontSize={12}>A–A' {o?.location.chainage ?? ''}</text>
        {bands.map(({ l, h, known }) => {
          const top = 24 + (y / total) * H;
          const height = (h / total) * H;
          y += h;
          if (hidden[l.name]) return null;
          const label = `${l.name}${known ? ` ${l.thicknessMm.value} mm` : ''} · ${layerSourceLabel(l).toUpperCase()}`;
          return (
            <g key={l.name}>
              <rect x={10} y={top} width={680} height={height} fill={LAYER_FILL[l.name]} stroke={known ? 'none' : '#9AA8BC'} strokeDasharray={known ? undefined : '6 4'} opacity={l.source === 'MISSING' ? 0.55 : 1} />
              <text x={20} y={top + 20} fill="#F1F5F9" fontSize={13}>{label}</text>
            </g>
          );
        })}
        {depthMax !== null && surface && w.layers[0].thicknessMm.value !== null && (
          // The pothole notch is drawn to scale only with a metric depth and a known AC thickness.
          <path d={`M 290 24 Q 360 ${24 + (depthMax / total) * H * 2} 430 24 Z`} fill="#0B121A" />
        )}
        <line x1={360} y1={20} x2={360} y2={H + 24} stroke="#38BDF8" strokeDasharray="4 4" />
      </svg>
      <p className="text-[11px] text-[#8B9BB0]">Penampang skematis melalui objek aktif. Lapis tanpa data digambar putus-putus dengan tinggi visual tetap (tidak bermakna). Foto permukaan tidak dapat memastikan struktur bawah.</p>
    </div>
  );
};

export const StructurePanel: React.FC = () => {
  const t = useWsT();
  const { workspace: w, isFieldEngineer, isOpsManager, run, reportId } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ layer: 0, thickness: '', modulus: '', poisson: '', reason: '', evidence: '' });
  const [err, setErr] = useState<string | null>(null);
  const locked = isFieldEngineer ? null : t('feOnly');
  if (!w) return null;
  const measured = w.layers.filter((l) => l.source === 'MEASURED' || l.source === 'DOCUMENT').length;

  const save = async () => {
    const changes: Array<[keyof Layer, string]> = [['thicknessMm', form.thickness], ['modulusMPa', form.modulus], ['poisson', form.poisson]];
    for (const [prop, v] of changes) {
      if (v === '') continue;
      const r = await run((g) => g.correct(reportId, { kind: 'layers', field: `layers.${form.layer}.${prop}.value`, newValue: Number(v), reason: form.reason, evidence: form.evidence.split(',').map((s) => s.trim()).filter(Boolean) }));
      if ('message' in r) return setErr(r.message);
    }
    setOpen(false);
  };

  return (
    <div>
      <SectionTitle>Properti lapisan</SectionTitle>
      <table className="w-full text-[12px]" data-testid="layer-table">
        <thead className="text-left text-[#8B9BB0]"><tr><th className="py-1">Lapis</th><th>Tebal</th><th>E (MPa)</th><th>ν</th><th>Sumber</th></tr></thead>
        <tbody>
          {w.layers.map((l) => (
            <tr key={l.name} className="border-b border-[#1A2430]">
              <td className="py-1.5">{l.name}</td>
              <td>{l.name === 'Subgrade' ? '∞' : l.thicknessMm.value ?? '—'}</td>
              <td>{l.modulusMPa.value ?? '—'}</td>
              <td>{l.poisson.value ?? '—'}</td>
              <td><StatusBadge tone={layerSourceLabel(l) === 'Terukur (simulasi)' ? 'violet' : SOURCE_TONE[l.source]}>{layerSourceLabel(l)}</StatusBadge></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[12px] text-[#9AA8BC]">Foto permukaan tidak dapat memastikan struktur bawah. Isi dari core, DCP, GPR atau FWD.</p>
      <SectionTitle>{t('validationStatus')}</SectionTitle>
      <StatusBadge tone={measured === w.layers.length ? 'green' : measured ? 'amber' : 'red'}>{measured} dari {w.layers.length} lapis terukur</StatusBadge>
      <SectionTitle>{isOpsManager ? t('omActions') : t('feActions')}</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <ActionButton primary locked={locked} testId="fill-core" onClick={() => setOpen(true)}>Isi data core/DCP/as-built</ActionButton>
      </div>
      {open && (
        <Modal title="Isi data lapisan (core/DCP/FWD/as-built)" onClose={() => setOpen(false)}>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <label className="col-span-2">Lapis
              <select value={form.layer} onChange={(e) => setForm({ ...form, layer: Number(e.target.value) })} className="w-full rounded border border-[#273244] bg-[#0A0F14] p-1.5">
                {w.layers.map((l, i) => <option key={l.name} value={i}>{l.name}</option>)}
              </select>
            </label>
            <label>Tebal (mm)<input data-testid="layer-thickness" type="number" value={form.thickness} onChange={(e) => setForm({ ...form, thickness: e.target.value })} className="w-full rounded border border-[#273244] bg-[#0A0F14] p-1.5" /></label>
            <label>Modulus E (MPa)<input type="number" value={form.modulus} onChange={(e) => setForm({ ...form, modulus: e.target.value })} className="w-full rounded border border-[#273244] bg-[#0A0F14] p-1.5" /></label>
            <label>Poisson ν<input type="number" step="0.01" value={form.poisson} onChange={(e) => setForm({ ...form, poisson: e.target.value })} className="w-full rounded border border-[#273244] bg-[#0A0F14] p-1.5" /></label>
            <label>Bukti (ID core/foto)<input value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} className="w-full rounded border border-[#273244] bg-[#0A0F14] p-1.5" /></label>
            <label className="col-span-2">{t('reason')} *<textarea data-testid="layer-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} className="w-full rounded border border-[#273244] bg-[#0A0F14] p-1.5" /></label>
          </div>
          <p className="mt-2 text-[11px] text-[#8B9BB0]">Jalankan ulang: T7_structural (run lama menjadi stale).</p>
          {err && <p className="mt-2 text-[12px] text-[#F59AA3]">{err}</p>}
          <div className="mt-3 flex justify-end">
            <button type="button" data-testid="layer-save" disabled={form.reason.trim().length < 5 || (form.thickness === '' && form.modulus === '' && form.poisson === '')} onClick={save} className="rounded-lg bg-[#E8B52B] px-3 py-1.5 text-[12px] font-semibold text-[#0A0F14] disabled:opacity-40">{t('submit')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
};
