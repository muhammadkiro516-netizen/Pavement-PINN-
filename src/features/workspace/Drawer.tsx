import React, { useState } from 'react';
import { useWsT, type WsKey } from './i18n';
import { useWorkspace } from './WorkspaceContext';
import { StatusBadge, STAGE_TONE, VERDICT_TONE } from './components/shared';
import { verdictFor } from '../../domain/workspace/metrics';

export type DrawerTab = 'timeline' | 'photos' | 'measurements' | 'corrections' | 'simlog';
const TABS: Array<[DrawerTab, WsKey]> = [
  ['timeline', 'drawerTimeline'],
  ['photos', 'drawerPhotos'],
  ['measurements', 'drawerMeasurements'],
  ['corrections', 'drawerCorrections'],
  ['simlog', 'drawerSimLog']
];

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const num = (v: number | null) => (v === null ? '—' : v.toLocaleString('id-ID', { maximumFractionDigits: 1 }));

export const Drawer: React.FC<{ initial: DrawerTab; open: boolean }> = ({ initial, open }) => {
  const t = useWsT();
  const [tab, setTab] = useState<DrawerTab>(initial);
  const { workspace: w, activeObject } = useWorkspace();
  if (!w) return null;
  return (
    <div className="px-4 pb-3" data-testid="drawer">
      <div role="tablist" className="flex gap-5 overflow-x-auto border-b border-[#1A2430]">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`whitespace-nowrap pb-2 text-[13px] ${tab === id ? 'border-b-2 border-[#FFD60A] text-white' : 'text-[#8B9BB0]'}`}>
            {t(label)}
          </button>
        ))}
      </div>
      {open && (
        <div className="max-h-64 overflow-auto pt-2 text-[12px]">
          {tab === 'timeline' && (
            <table className="w-full">
              <tbody>
                {[...w.stageRuns.map((r) => ({ at: r.finishedAt ?? r.createdAt, label: `${r.stage} · ${r.reason ?? r.modelVersion ?? ''}`, status: r.status as string, stale: !!r.supersededBy })), ...w.audit.map((a) => ({ at: a.at, label: `${a.action}${a.detail ? ` · ${a.detail}` : ''}${a.reason ? ` — ${a.reason}` : ''}`, status: '', stale: false }))]
                  .sort((a, b) => (a.at < b.at ? 1 : -1))
                  .map((e, i) => (
                    <tr key={i} className="border-b border-[#1A2430]">
                      <td className="w-32 py-1.5 text-[#8B9BB0]">{fmt(e.at)}</td>
                      <td className={`py-1.5 ${e.stale ? 'text-[#6B7A90] line-through' : 'text-[#C9D4E3]'}`}>{e.label}</td>
                      <td className="py-1.5 text-right">{e.status && <StatusBadge tone={STAGE_TONE[e.status as keyof typeof STAGE_TONE] ?? 'grey'}>{e.status}</StatusBadge>}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          {tab === 'photos' && (
            <table className="w-full">
              <thead className="text-left text-[#8B9BB0]">
                <tr><th className="py-1">Frame</th><th>Slot</th><th>Status</th><th>Alasan</th></tr>
              </thead>
              <tbody>
                {w.frames.map((f) => (
                  <tr key={f.frameId} className="border-b border-[#1A2430]">
                    <td className="py-1.5">{f.frameId}</td>
                    <td className="text-[#9AA8BC]">{f.slot ?? '—'}</td>
                    <td><StatusBadge tone={f.accepted === null ? 'grey' : f.accepted ? 'green' : 'red'}>{f.accepted === null ? 'belum dinilai' : f.accepted ? 'diterima' : 'ditolak'}</StatusBadge></td>
                    <td className="text-[#C9D4E3]">{f.rejectReason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'measurements' &&
            (() => {
              const pts = w.groundTruth.filter((p) => !activeObject || p.objectId === activeObject.objectId);
              if (!pts.length) return <p className="py-2 text-[#9AA8BC]">{t('validationUnavailable')} — belum ada titik ukur lapangan untuk objek ini.</p>;
              return (
                <table className="w-full">
                  <thead className="text-left text-[#8B9BB0]"><tr><th className="py-1">Titik</th><th>Sistem (mm)</th><th>Manual (mm)</th><th>Selisih</th><th>Status</th></tr></thead>
                  <tbody>
                    {pts.map((p) => {
                      const v = verdictFor(p);
                      return (
                        <tr key={p.pointId} className="border-b border-[#1A2430]">
                          <td className="py-1.5">{p.pointId}</td>
                          <td>{num(p.systemMm)}</td>
                          <td>{num(p.referenceMm)}</td>
                          <td>{p.systemMm !== null && p.referenceMm !== null ? `${p.systemMm - p.referenceMm >= 0 ? '+' : ''}${num(p.systemMm - p.referenceMm)}` : 'belum diukur'}</td>
                          <td><StatusBadge tone={VERDICT_TONE[v]}>{v.toLowerCase()}</StatusBadge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })()}
          {tab === 'corrections' && (
            <table className="w-full">
              <tbody>
                {w.corrections.length === 0 && w.versions.length === 0 && <tr><td className="py-2 text-[#9AA8BC]">Belum ada koreksi.</td></tr>}
                {[...w.corrections].reverse().map((c) => (
                  <tr key={c.correctionId} className="border-b border-[#1A2430]">
                    <td className="w-32 py-1.5 text-[#8B9BB0]">{fmt(c.at)}</td>
                    <td className="text-[#C9D4E3]">v{c.version} · {c.kind} {c.objectId ?? ''} · {c.field}: {short(c.oldValue)} → {short(c.newValue)} — {c.reason}</td>
                    <td className="text-right text-[#9AA8BC]">rerun {c.rerunStages.map((s) => s.slice(0, 2)).join('–')}</td>
                  </tr>
                ))}
                {[...w.versions].reverse().map((v) => (
                  <tr key={`v${v.version}`} className="border-b border-[#1A2430]">
                    <td className="py-1.5 text-[#8B9BB0]">{fmt(v.approvedAt ?? v.createdAt)}</td>
                    <td className="text-[#C9D4E3]">Versi v{v.version}: {v.changeSummaryTechnical || '(draf)'}{v.rejectionReason ? ` — ditolak: ${v.rejectionReason}` : ''}</td>
                    <td className="text-right"><StatusBadge tone={v.status === 'approved' ? 'green' : v.status === 'rejected' ? 'red' : 'amber'}>{v.status}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'simlog' && (
            <table className="w-full">
              <tbody>
                {w.structuralRuns.length === 0 && <tr><td className="py-2 text-[#9AA8BC]">{t('modelNotRun')}.</td></tr>}
                {[...w.structuralRuns].reverse().map((r) => (
                  <tr key={r.runId} className="border-b border-[#1A2430]">
                    <td className="w-32 py-1.5 text-[#8B9BB0]">{fmt(r.createdAt)}</td>
                    <td className="text-[#C9D4E3]">{r.runId} · {r.engine} {r.engineVersion} · input {r.inputHash}{r.supersededBy ? ` (diganti ${r.supersededBy})` : ''}</td>
                    <td className="text-right"><StatusBadge tone={r.status === 'completed' ? 'green' : r.status === 'stale' ? 'grey' : 'red'}>{r.status}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

function short(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return `[${v.length} titik]`;
  if (typeof v === 'object') return '{…}';
  return String(v);
}
