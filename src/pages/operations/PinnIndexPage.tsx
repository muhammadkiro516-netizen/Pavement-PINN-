/**
 * /operations/pinn/ — index of analysis workspaces in the Ops shell style (amber accent,
 * cards like "Laporan warga"). KPIs come from real workspaces; DATA CONTOH is excluded.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Layers, Search } from 'lucide-react';
import { useRouter } from '../../app/router';
import { useWsT } from '../../features/workspace/i18n';
import { useWorkspaceDeps } from './useWorkspaceDeps';
import { WorkspaceApiError, type WorkspaceSummary } from '../../features/workspace/api';
import { StatusBadge, STAGE_TONE, UnavailableCard } from '../../features/workspace/components/shared';
import { classLabel } from '../../features/workspace/labels';
import type { PortfolioKpi } from '../../domain/workspace/metrics';
import { STAGE_IDS } from '../../domain/workspace/types';

const STAGE_BG: Record<string, string> = { green: 'bg-[#22C55E]', amber: 'bg-[#F5C451]', red: 'bg-[#EF4444]', grey: 'bg-[#334155]', violet: 'bg-[#A78BFA]', blue: 'bg-[#3B82F6]' };

export const PinnIndexPage: React.FC = () => {
  const t = useWsT();
  const { navigateTo } = useRouter();
  const { gateway, actor } = useWorkspaceDeps();
  const [data, setData] = useState<{ items: WorkspaceSummary[]; kpi: PortfolioKpi } | null>(null);
  const [error, setError] = useState<WorkspaceApiError | null>(null);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [type, setType] = useState('');
  const [sev, setSev] = useState('');

  useEffect(() => {
    gateway.list().then(setData, (e) => setError(e instanceof WorkspaceApiError ? e : new WorkspaceApiError(0, 'ERROR', String(e))));
  }, [gateway, actor.id]);

  const items = useMemo(() => {
    const list = data?.items ?? [];
    return list.filter(
      (i) =>
        (!q || `${i.reportId} ${i.segment} ${i.primaryObject?.objectId ?? ''}`.toLowerCase().includes(q.toLowerCase())) &&
        (!stage || i.stages.find((s) => s.stage.startsWith(stage))?.status !== 'completed') &&
        (!type || i.primaryObject?.class === type) &&
        (!sev || i.primaryObject?.citizenSeverity === sev)
    );
  }, [data, q, stage, type, sev]);

  if (error) return <div className="p-6"><UnavailableCard reason={error.status === 403 ? t('forbidden') : `${t('error')}: ${error.message}`} /></div>;
  const pending = (data?.items ?? []).flatMap((i) => i.pendingVersions.map((v) => ({ ...v, reportId: i.reportId, demo: i.demo })));

  return (
    <div className="h-full overflow-auto bg-[#0A0F14] p-4 text-[#E6EDF3] md:p-6" data-testid="pinn-index">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-semibold"><Layers className="h-5 w-5 text-[#E8B52B]" /> {t('appTitle')}</h1>
          <p className="mt-1 text-[13px] text-[#9AA8BC]">{t('appSubtitle')}</p>
        </div>
        {gateway.mode === 'OFFLINE_DEMO' && <StatusBadge tone="grey">{t('offlineBadge')}</StatusBadge>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="pinn-kpis">
        {[
          [t('inAnalysis'), data?.kpi.inAnalysis],
          [t('kpiReview'), data?.kpi.needsFeReview],
          [t('awaitingYou'), data?.kpi.awaitingApproval],
          [t('kpiValidated'), data?.kpi.fieldValidated]
        ].map(([label, v]) => (
          <div key={String(label)} className="rounded-xl border border-[#202B3B] bg-[#0F1720] p-3">
            <div className="text-[12px] text-[#9AA8BC]">{label}</div>
            <div className="mt-1 text-[26px] font-bold tabular-nums text-[#E8B52B]">{v ?? '…'}</div>
          </div>
        ))}
      </div>
      {data && data.kpi.excludedDemo > 0 && <p className="mt-2 text-[11px] text-[#C7B3FF]">{data.kpi.excludedDemo} {t('demoExcluded')}.</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-[#202B3B] bg-[#0F1720] px-3 py-1.5">
          <Search className="h-4 w-4 text-[#6B7A90]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} className="w-full bg-transparent text-[13px] outline-none" />
        </label>
        <select value={stage} onChange={(e) => setStage(e.target.value)} className="rounded-lg border border-[#202B3B] bg-[#0F1720] px-2 py-1.5 text-[12px]">
          <option value="">{t('allStages')}</option>
          {STAGE_IDS.map((s) => <option key={s} value={s.slice(0, 2)}>{s.slice(0, 2)} belum selesai</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-[#202B3B] bg-[#0F1720] px-2 py-1.5 text-[12px]">
          <option value="">{t('allTypes')}</option>
          {['pothole', 'crack_longitudinal', 'crack_alligator', 'unclassified'].map((c) => <option key={c} value={c}>{classLabel(c)}</option>)}
        </select>
        <select value={sev} onChange={(e) => setSev(e.target.value)} className="rounded-lg border border-[#202B3B] bg-[#0F1720] px-2 py-1.5 text-[12px]">
          <option value="">{t('allSeverities')} ({t('citizenReported')})</option>
          {['LIGHT', 'MODERATE', 'SEVERE', 'CRITICAL'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-2">
          {!data && <p className="text-[13px] text-[#9AA8BC]">{t('loading')}</p>}
          {items.map((i) => (
            <div key={i.reportId} className="rounded-xl border border-[#202B3B] bg-[#0F1720] p-3" data-testid={`pinn-row-${i.reportId}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-[#18243A] px-2 py-0.5 font-mono text-[12px] text-[#E8B52B]">{i.reportId}</span>
                {i.demo && <StatusBadge tone="violet">{t('demoBadge')}</StatusBadge>}
                <span className="truncate text-[13px] text-[#C9D4E3]">{i.segment}</span>
                <button type="button" onClick={() => navigateTo('analysisWorkspace', { reportId: i.reportId })} className="ml-auto rounded-lg bg-[#E8B52B] px-3 py-1.5 text-[12px] font-semibold text-[#0A0F14]" data-testid={`open-${i.reportId}`}>
                  {t('openWorkspace')}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-[#9AA8BC]">
                <span>{i.primaryObject ? `${i.primaryObject.objectId} · ${classLabel(i.primaryObject.class)}` : '—'}</span>
                {i.primaryObject?.citizenSeverity && <StatusBadge tone="grey" title="Perkiraan pelapor, belum diverifikasi">{i.primaryObject.citizenSeverity} · {t('citizenReported')}</StatusBadge>}
                <StatusBadge tone={i.primaryObject?.scaleStatus === 'valid' ? 'green' : 'grey'}>{i.primaryObject?.scaleStatus === 'valid' ? '3D berskala' : 'tanpa 3D berskala'}</StatusBadge>
                <span title="Modul F belum diimplementasikan">Prioritas: —</span>
              </div>
              <div className="mt-2 flex gap-1" aria-label="Progres T0–T7">
                {i.stages.slice(0, 8).map((s) => (
                  <span key={s.stage} title={`${s.stage}: ${s.status ?? 'belum'}`} className={`h-1.5 flex-1 rounded ${STAGE_BG[STAGE_TONE[(s.status as keyof typeof STAGE_TONE) ?? 'not_started'] ?? 'grey']}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <aside className="h-fit rounded-xl border border-[#202B3B] bg-[#0F1720] p-3" data-testid="approval-queue">
          <h2 className="text-[14px] font-semibold">{t('approvalQueue')}</h2>
          {pending.length === 0 && <p className="mt-2 text-[12px] text-[#9AA8BC]">{t('noPending')}</p>}
          {pending.map((p) => (
            <button key={`${p.reportId}-${p.version}`} type="button" onClick={() => navigateTo('analysisWorkspace', { reportId: p.reportId })} className="mt-2 block w-full rounded-lg border border-[#273244] p-2 text-left text-[12px] hover:border-[#E8B52B]/60">
              <div className="flex items-center justify-between gap-2"><span className="font-mono text-[#E8B52B]">{p.reportId} · v{p.version}</span>{p.demo && <StatusBadge tone="violet">{t('demoBadge')}</StatusBadge>}</div>
              <div className="mt-1 text-[#C9D4E3]">{p.changeSummaryPublic}</div>
            </button>
          ))}
        </aside>
      </div>
    </div>
  );
};
