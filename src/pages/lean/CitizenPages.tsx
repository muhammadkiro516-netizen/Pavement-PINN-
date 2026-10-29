/**
 * Citizen tabs: Laporanku (own reports and where each one is) and Notifikasi.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pavi } from '../../components/brand/Pavi';
import { readPaviHelmet } from '../../components/brand/paviPrefs';
import { apiUrl } from '../../services/api/client';
import { RepairConfirmPrompts } from '../../features/road-intelligence/RepairHistory';
import { Hourglass } from '../../features/workflow/Hourglass';
import { Glyph } from '../../components/ui/brand';
import { Empty, Pill, SnapButton, SnapCard, SnapPage } from '../../components/ui/snap';
import { useAppState } from '../../app/providers/AppStateProvider';
import { useSession } from '../../app/providers/SessionProvider';
import { WORKFLOW_STATE_LABEL, stateTone } from '../../features/workflow/workflowLabels';
import { relativeTime, workflowNotifications } from '../../features/workflow/notifications';
import { useCameraLauncher } from '../../app/cameraLauncher';
import type { WorkflowState } from '../../domain/workflow/model';

const TONE_PILL = { neutral: 'grey', review: 'orange', active: 'blue', done: 'green', closed: 'grey' } as const;

export const StatusPill: React.FC<{ state: WorkflowState }> = ({ state }) => (
  <Pill tone={TONE_PILL[stateTone(state)]}>{WORKFLOW_STATE_LABEL[state] ?? state}</Pill>
);

/** Diterima -> Diperiksa -> Dikerjakan -> Selesai, from the workflow state. */
const STAGES = ['Diterima', 'Diperiksa', 'Dikerjakan', 'Selesai'] as const;
function stageOf(state: WorkflowState): number {
  if (state === 'RESOLVED' || state === 'CLOSED') return 3;
  if (state === 'ACTION_APPROVED' || state === 'IN_PROGRESS') return 2;
  if (state === 'FIELD_INSPECTION_REQUESTED' || state === 'INSPECTED' || state === 'INSPECTION_VERIFIED' || state === 'ACTION_RECOMMENDED') return 1;
  return 0;
}

const StoryProgress: React.FC<{ state: WorkflowState; closedInvalid: boolean }> = ({ state, closedInvalid }) => {
  const at = stageOf(state);
  return (
    <div className="mt-3">
      <div className="flex gap-1.5">
        {STAGES.map((_, i) => (
          <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#FFFFFF]/10">
            <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: i <= at ? '100%' : '0%', background: closedInvalid ? '#7A8899' : i === 3 && at === 3 ? '#2BD67B' : '#FFD60A', transitionDelay: `${i * 120}ms` }} />
          </span>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-bold text-[#FFFFFF]/45">
        {STAGES.map((st, i) => <span key={st} className={i === at ? 'text-[#FFFFFF]' : ''}>{st}</span>)}
      </div>
    </div>
  );
};

interface ImpactData {
  points: number;
  level: { index: number; name: string; next: string | null; from: number; to: number | null };
  verified: number;
  repaired: number;
  repairedAreaM2: number;
  badges: Array<{ id: string; title: string; description: string; earned: boolean }>;
}

const BADGE_TONE: Record<string, string> = { first: '#FFD60A', verified5: '#4C8DFF', water: '#38BDF8', witness: '#2BD67B' };

const ImpactCard: React.FC = () => {
  const [d, setD] = useState<ImpactData | null>(null);
  useEffect(() => {
    fetch(apiUrl('/api/me/impact'), { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => j?.success && setD(j.impact))
      .catch(() => undefined);
  }, []);
  if (!d) return null;
  const pct = d.level.to ? Math.min(100, ((d.points - d.level.from) / (d.level.to - d.level.from)) * 100) : 100;
  const tiles: Array<[string, string]> = [[String(d.verified), 'dibenarkan petugas'], [String(d.repaired), 'sudah diperbaiki'], [String(d.repairedAreaM2), 'm² jalan dibantu']];
  return (
    <div className="pp-rise overflow-hidden rounded-[28px] border border-[#FFFFFF]/8 bg-gradient-to-br from-[#1E2229] to-[#15181D] p-4">
      <div className="flex items-center gap-3">
        <Pavi size={58} mood={d.points > 0 ? 'found' : 'idle'} helmet={readPaviHelmet()} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-[#FFFFFF]/50">Level</p>
          <p className="text-xl font-extrabold text-[#FFFFFF]">{d.level.name}</p>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#FFFFFF]/10">
            <div className="h-full rounded-full bg-[#FFD60A] transition-[width] duration-1000" style={{ width: `${pct}%` }} />
          </div>
          <p className="tabular mt-1 text-[11px] text-[#FFFFFF]/55">{d.points} Poin Jalan Aman{d.level.next && d.level.to !== null ? ` · ${d.level.to - d.points} lagi menuju ${d.level.next}` : ''}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {tiles.map(([v, l]) => (
          <div key={l} className="rounded-2xl bg-[#FFFFFF]/5 py-2">
            <p className="tabular text-lg font-extrabold text-[#FFFFFF]">{v}</p>
            <p className="text-[10px] font-semibold text-[#FFFFFF]/50">{l}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {d.badges.map((bd) => (
          <span key={bd.id} title={bd.description} className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-extrabold ${bd.earned ? 'text-[#0B0D10]' : 'bg-[#FFFFFF]/5 text-[#FFFFFF]/35'}`} style={bd.earned ? { background: BADGE_TONE[bd.id] } : undefined}>
            {bd.title}
          </span>
        ))}
      </div>
    </div>
  );
};

export const MyReportsPage: React.FC = () => {
  const { workflow } = useAppState();
  const openCamera = useCameraLauncher();
  const mine = useMemo(
    () =>
      Object.values(workflow.views)
        .filter((v) => v.isMine)
        .sort((x, y) => y.case.createdAt.localeCompare(x.case.createdAt)),
    [workflow.views]
  );

  return (
    <SnapPage title="Laporanku" subtitle="Laporan Anda dan sampai mana penanganannya.">
      <ImpactCard />
      {mine.length === 0 ? (
        <Empty
          icon={<Pavi size={44} mood="sleep" />}
          title="Belum ada laporan"
          text="Lihat jalan rusak? Potret saja. AI langsung mengenali kerusakannya dan laporan dikirim ke instansi yang tepat."
          action={<SnapButton variant="accent" onClick={openCamera}><Glyph name="camera" size={18} /> Lapor sekarang</SnapButton>}
        />
      ) : (
        mine.map((v) => {
          const r = v.case.report;
          const c = v.case as typeof v.case & { authority?: { name: string } | null; hazard?: unknown; history?: Array<{ action: string }> };
          const last = v.audience === 'PUBLIC' ? v.case.timeline[v.case.timeline.length - 1] : null;
          const invalid = !!c.history?.some((h) => h.action === 'CLOSE_INVALID');
          return (
            <SnapCard key={v.case.id}>
              <div className="flex gap-3">
                {r.photoUrl && <img src={r.photoUrl} alt="" className="h-20 w-20 shrink-0 rounded-2xl object-cover" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill state={v.case.state} />
                    {r.aiAnalysis?.modelStatus === 'REAL' && <Pill tone="blue">AI: {r.aiAnalysis.label}</Pill>}
                    {r.cvAssessment?.hazards?.includes('GENANGAN') && <Pill tone="blue">Genangan</Pill>}
                    {c.hazard ? <Pill tone="orange">Rambu terpasang</Pill> : null}
                  </div>
                  <p className="mt-2 truncate text-[15px] font-extrabold">{r.damageTypeLabel} · {r.segmentName}</p>
                  <p className="truncate text-xs text-[#8E8E93]">{c.authority?.name ?? 'Instansi sedang ditentukan'} · {relativeTime(v.case.createdAt)}</p>
                  {last && <p className="mt-1 text-sm text-[#D1D1D6]">{last.note}</p>}
                </div>
              </div>
              <StoryProgress state={v.case.state} closedInvalid={invalid} />
              <Hourglass c={v.case as never} allowComplaint />
            </SnapCard>
          );
        })
      )}
    </SnapPage>
  );
};

export const NotificationsPage: React.FC = () => {
  const { workflow } = useAppState();
  const { currentAccount } = useSession();
  const items = useMemo(
    () => workflowNotifications(Object.values(workflow.views), { id: workflow.actor?.id ?? currentAccount.id, role: currentAccount.role }, 50),
    [workflow.views, workflow.actor, currentAccount]
  );
  return (
    <SnapPage title="Notifikasi" subtitle="Kabar terbaru tentang laporan yang terkait dengan Anda.">
      <RepairConfirmPrompts />
      {items.length === 0 ? (
        <Empty icon={<Glyph name="bell" size={26} />} title="Belum ada kabar" text="Saat petugas memeriksa atau memperbaiki laporan Anda, kabarnya muncul di sini." />
      ) : (
        items.map((n) => (
          <SnapCard key={n.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-extrabold">{n.title}</p>
                <p className="mt-0.5 text-sm text-[#D1D1D6]">{n.description}</p>
                <p className="mt-1 text-xs text-[#6E6E73]">{n.caseId}</p>
              </div>
              <span className="shrink-0 text-xs text-[#8E8E93]">{relativeTime(n.at)}</span>
            </div>
          </SnapCard>
        ))
      )}
    </SnapPage>
  );
};
