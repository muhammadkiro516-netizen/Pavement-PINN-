/**
 * Citizen tabs: Laporanku (own reports and where each one is) and Notifikasi.
 */
import React, { useMemo } from 'react';
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

export const MyReportsPage: React.FC = () => {
  const { workflow } = useAppState();
  const openCamera = useCameraLauncher();
  const mine = useMemo(
    () =>
      Object.values(workflow.views)
        .filter((v) => v.isMine)
        .sort((a, b) => b.case.createdAt.localeCompare(a.case.createdAt)),
    [workflow.views]
  );

  return (
    <SnapPage title="Laporanku" subtitle="Semua laporan Anda dan sampai mana penanganannya.">
      {mine.length === 0 ? (
        <Empty
          icon={<Glyph name="list" size={26} />}
          title="Belum ada laporan"
          text="Lihat jalan rusak? Potret saja. AI langsung mengenali jenis kerusakannya dan laporan dikirim ke instansi yang tepat."
          action={<SnapButton variant="accent" onClick={openCamera}><Glyph name="camera" size={18} /> Lapor sekarang</SnapButton>}
        />
      ) : (
        mine.map((v) => {
          const r = v.case.report;
          const last = v.audience === 'PUBLIC' ? v.case.timeline[v.case.timeline.length - 1] : null;
          return (
            <SnapCard key={v.case.id}>
              <div className="flex gap-3">
                {r.photoUrl && <img src={r.photoUrl} alt="" className="h-20 w-20 shrink-0 rounded-2xl object-cover" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill state={v.case.state} />
                    {r.aiAnalysis?.modelStatus === 'REAL' && <Pill tone="blue">AI: {r.aiAnalysis.label}</Pill>}
                  </div>
                  <p className="mt-2 truncate text-[15px] font-extrabold">{r.damageTypeLabel} · {r.segmentName}</p>
                  <p className="text-xs text-[#7A8899]">
                    {v.case.id} · {relativeTime(v.case.createdAt)}
                  </p>
                  {last && <p className="mt-1 text-sm text-[#2A3647]">{last.note}</p>}
                </div>
              </div>
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
      {items.length === 0 ? (
        <Empty icon={<Glyph name="bell" size={26} />} title="Belum ada kabar" text="Saat petugas memeriksa atau memperbaiki laporan Anda, kabarnya muncul di sini." />
      ) : (
        items.map((n) => (
          <SnapCard key={n.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-extrabold">{n.title}</p>
                <p className="mt-0.5 text-sm text-[#3E4C5E]">{n.description}</p>
                <p className="mt-1 text-xs text-[#9AA7B8]">{n.caseId}</p>
              </div>
              <span className="shrink-0 text-xs text-[#7A8899]">{relativeTime(n.at)}</span>
            </div>
          </SnapCard>
        ))
      )}
    </SnapPage>
  );
};
