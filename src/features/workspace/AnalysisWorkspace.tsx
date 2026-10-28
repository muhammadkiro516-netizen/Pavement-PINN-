/**
 * Analysis Workspace layout (wireframe L0 / mockups 1–6): fixed header, six tabs with
 * sub-labels, main work area (~70 %), indicator panel (~360 px), collapsible bottom drawer.
 * On narrow screens the panel becomes a bottom sheet and the drawer a tab strip.
 */
import React, { Suspense, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, PanelRightOpen } from 'lucide-react';
import type { WorkspaceTab } from '../../domain/workspace/types';
import { pipelineHeadline } from '../../domain/workspace/orchestrator';
import { useWsT, type WsKey } from './i18n';
import { useWorkspace } from './WorkspaceContext';
import { classLabel } from './labels';
import { StatusBadge, STAGE_TONE, UnavailableCard } from './components/shared';
import { Drawer, type DrawerTab } from './Drawer';
import { OverviewMain, OverviewPanel } from './tabs/OverviewTab';
import { WorkspaceNavContext } from './WorkspaceNav';
import { SHOW_3D } from './showAdvanced';
import { CameraMain, CameraPanel } from './tabs/CameraTab';
import { StructureMain, StructurePanel } from './tabs/StructureTab';
import { PinnMain, PinnPanel } from './tabs/PinnTab';
import { ValidationMain, ValidationPanel } from './tabs/ValidationTab';
import { DamagePanel } from './tabs/DamagePanel';

const DamageMain = React.lazy(() => import('./tabs/DamageTab'));

const ALL_TABS: Array<{ id: WorkspaceTab; label: WsKey; sub: WsKey; drawer: DrawerTab }> = [
  { id: 'overview', label: 'tabOverview', sub: 'tabOverviewSub', drawer: 'timeline' },
  { id: 'camera', label: 'tabCamera', sub: 'tabCameraSub', drawer: 'photos' },
  { id: '3d', label: 'tab3d', sub: 'tab3dSub', drawer: 'measurements' },
  { id: 'structure', label: 'tabStructure', sub: 'tabStructureSub', drawer: 'corrections' },
  { id: 'pinn', label: 'tabPinn', sub: 'tabPinnSub', drawer: 'simlog' },
  { id: 'validation', label: 'tabValidation', sub: 'tabValidationSub', drawer: 'corrections' }
];
const TABS = SHOW_3D ? ALL_TABS : ALL_TABS.filter((x) => x.id !== '3d' && x.id !== 'validation');

export const AnalysisWorkspace: React.FC<{ onBack?: () => void; onOpenQueue?: () => void }> = ({ onBack, onOpenQueue }) => {
  const t = useWsT();
  const ws = useWorkspace();
  const [panelOpen, setPanelOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);

  if (ws.loading && !ws.workspace) return <div className="p-6 text-[13px] text-[#9AA8BC]">{t('loading')}</div>;
  if (ws.error || !ws.workspace) {
    const reason = ws.error?.status === 403 ? t('forbidden') : ws.error?.status === 404 ? t('notFound') : `${t('error')}: ${ws.error?.message ?? ''}`;
    return (
      <div className="p-6">
        <UnavailableCard reason={reason} action={{ label: t('retry'), onClick: ws.reload }} />
      </div>
    );
  }

  const w = ws.workspace;
  const tab = TABS.find((x) => x.id === ws.selection.tab) ?? TABS[0];
  const head = pipelineHeadline(w);
  const published = [...w.versions].filter((v) => v.status === 'approved').sort((a, b) => b.version - a.version)[0];
  const versionLabel = published ? `v${published.version}` : t('noVersion');

  const main: Record<WorkspaceTab, React.ReactNode> = {
    overview: <OverviewMain />,
    camera: <CameraMain />,
    '3d': (
      <Suspense fallback={<div className="p-6 text-[13px] text-[#9AA8BC]">{t('loading')}</div>}>
        <DamageMain />
      </Suspense>
    ),
    structure: <StructureMain />,
    pinn: <PinnMain />,
    validation: <ValidationMain />
  };
  const panel: Record<WorkspaceTab, React.ReactNode> = {
    overview: <OverviewPanel />,
    camera: <CameraPanel />,
    '3d': <DamagePanel />,
    structure: <StructurePanel />,
    pinn: <PinnPanel />,
    validation: <ValidationPanel />
  };

  return (
    <WorkspaceNavContext.Provider value={{ openQueue: onOpenQueue }}>
    <div className="flex h-full min-h-0 flex-col bg-[#0A0F14] text-[#E6EDF3]" data-testid="analysis-workspace">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#1A2430] px-4 py-2.5">
        {onBack && (
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-lg border border-[#273244] px-2.5 py-1 text-[12px] text-[#C9D4E3] hover:border-[#E8B52B]/60">
            <ArrowLeft className="h-3.5 w-3.5" /> {t('back')}
          </button>
        )}
        <nav aria-label="breadcrumb" className="min-w-0 truncate text-[13px] text-[#9AA8BC]">
          <span className="font-bold tracking-wide text-white">PAVEMENT-PINN</span>
          <span className="mx-2">{w.project}</span>/<span className="mx-2">{w.segment}{w.chainageRange ? ` ${w.chainageRange}` : ''}</span>/
          <span className="mx-2 text-[#E6EDF3]" data-testid="report-id">{w.reportId}</span>/<span className="mx-2">{versionLabel}</span>
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <StatusBadge tone={head.stage ? STAGE_TONE[head.status] : 'green'} title={t('pipeline')}>
            {head.stage ? `${head.stage.slice(0, 2)} ${head.status} · ${head.done}/${head.total}` : t('pipelineDone')}
          </StatusBadge>
          <StatusBadge tone="grey" title={t('activeObject')}>
            <span data-testid="active-object-chip">{ws.activeObject?.objectId ?? t('noObject')}</span>
          </StatusBadge>
          <StatusBadge tone="grey" title="Kode lacak publik untuk pelapor">
            <span data-testid="tracking-code">{w.trackingCode}</span>
          </StatusBadge>
          {w.demo && <StatusBadge tone="violet">{t('demoBadge')}</StatusBadge>}
          {ws.gateway.mode === 'OFFLINE_DEMO' && <StatusBadge tone="grey">{t('offlineBadge')}</StatusBadge>}
        </div>
      </header>

      {/* Tabs */}
      <div role="tablist" className="grid grid-cols-2 gap-2 border-b border-[#1A2430] px-4 py-2.5 md:grid-cols-4">
        {TABS.map((x) => {
          const active = x.id === tab.id;
          return (
            <button
              key={x.id}
              role="tab"
              aria-selected={active}
              data-testid={`tab-${x.id}`}
              onClick={() => ws.setTab(x.id)}
              className={`rounded-xl border px-2 py-1.5 text-center transition-colors ${active ? 'border-[#E8B52B] bg-[#E8B52B] text-[#0A0F14]' : 'border-[#1E2A38] bg-[#0F1720] text-[#C9D4E3] hover:border-[#E8B52B]/50'}`}
            >
              <div className="text-[13px] font-semibold leading-5">{t(x.label)}</div>
              <div className={`text-[11px] leading-4 ${active ? 'text-[#3A2C0B]' : 'text-[#8B9BB0]'}`}>{t(x.sub)}</div>
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <main className="min-w-0 rounded-2xl border border-[#1A2430] bg-[#0F1720] p-4" data-testid={`main-${tab.id}`}>
            {main[tab.id]}
          </main>
          {/* Indicator panel: column on desktop, bottom sheet on small screens */}
          <aside className={`rounded-2xl border border-[#1A2430] bg-[#0F1720] p-4 ${panelOpen ? 'fixed inset-x-0 bottom-0 z-40 max-h-[75vh] overflow-auto rounded-b-none lg:static lg:max-h-none lg:rounded-b-2xl' : 'hidden lg:block'}`} data-testid="indicator-panel">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">{t('indicatorPanel')}</h2>
              <button type="button" className="text-[12px] text-[#9AA8BC] lg:hidden" onClick={() => setPanelOpen(false)}>
                {t('collapse')}
              </button>
            </div>
            <ObjectCard />
            {panel[tab.id]}
          </aside>
        </div>
        <button type="button" onClick={() => setPanelOpen(true)} className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-1.5 rounded-full bg-[#E8B52B] px-3 py-2 text-[12px] font-semibold text-[#0A0F14] shadow-lg lg:hidden">
          <PanelRightOpen className="h-4 w-4" /> {t('indicatorPanel')}
        </button>

        <section className="mx-4 mb-4 rounded-2xl border border-[#1A2430] bg-[#0F1720]">
          <div className="flex items-center justify-end px-3 pt-2">
            <button type="button" onClick={() => setDrawerOpen((v) => !v)} className="inline-flex items-center gap-1 text-[12px] text-[#9AA8BC]">
              {drawerOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />} {drawerOpen ? t('collapse') : t('expand')}
            </button>
          </div>
          <Drawer key={tab.id} initial={tab.drawer} open={drawerOpen} />
        </section>
      </div>
    </div>
    </WorkspaceNavContext.Provider>
  );
};

const TAB_NAME: Record<WorkspaceTab, WsKey> = { overview: 'tabOverview', camera: 'tabCamera', '3d': 'tab3d', structure: 'tabStructure', pinn: 'tabPinn', validation: 'tabValidation' };

const ObjectCard: React.FC = () => {
  const t = useWsT();
  const { activeObject: o, selectedInTab } = useWorkspace();
  if (!o) return <div className="rounded-xl border border-[#273244] p-3 text-[13px] text-[#9AA8BC]">{t('noObject')}</div>;
  return (
    <div className="rounded-xl border border-[#2B5C99] bg-[#0D1B2C] p-3" data-testid="object-card">
      <div className="text-[14px] text-white">
        <span className="font-bold">{o.objectId}</span> · {classLabel(o.class.value)}
        {o.location.chainage ? ` · ${o.location.chainage}` : ''}
        {o.location.lane ? ` · ${o.location.lane}` : ''}
      </div>
      <div className="text-[12px] text-[#8CC4FF]">
        {selectedInTab ? `${t('selectedIn')} ${t(TAB_NAME[selectedInTab])} · ` : ''}
        {t('keptAcrossTabs')}
      </div>
    </div>
  );
};
