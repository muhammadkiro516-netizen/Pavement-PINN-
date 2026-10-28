import React, { useState } from 'react';
import { useWsT } from '../i18n';
import { useWorkspace } from '../WorkspaceContext';
import { ActionButton, Row, SectionTitle, StatusBadge, STAGE_TONE, UnavailableCard } from '../components/shared';
import { MiniMap } from '../components/MiniMap';
import { VersionActions } from '../components/VersionActions';
import { Modal } from '../components/dialogs';
import { workspaceKpi } from '../../../domain/workspace/metrics';
import { latestRuns } from '../../../domain/workspace/rerun';
import { STAGE_IDS, TAB_FOR_STAGE } from '../../../domain/workspace/types';
import { classLabel } from '../labels';
import { WorkspaceNavContext } from '../WorkspaceNav';

const STAGE_NAME: Record<string, string> = { T0: 'Foto', T1: '3D', T2: 'Grid', T3: 'Deteksi', T4: 'Permukaan', T5: 'Ukur', T6: 'Validasi', T7: 'Struktur', T8: 'Final' };

const Kpi: React.FC<{ label: string; value: string | null; empty: string; testId: string }> = ({ label, value, empty, testId }) => (
  <div className="rounded-xl border border-[#1A2430] bg-[#0B121A] p-3" data-testid={testId}>
    <div className="text-[13px] text-[#C9D4E3]">{label}</div>
    {value === null ? <div className="mt-1 text-[13px] italic text-[#8B9BB0]">{empty}</div> : <div className="mt-0.5 text-[26px] font-bold tabular-nums text-white">{value}</div>}
  </div>
);

export const OverviewMain: React.FC = () => {
  const t = useWsT();
  const { workspace: w, activeObject, setActiveObject, setTab } = useWorkspace();
  if (!w) return null;
  const k = workspaceKpi(w);
  const latest = latestRuns(w.stageRuns);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi testId="kpi-detected" label={t('kpiDetected')} value={k.detected === null ? null : String(k.detected)} empty={t('detectionNotRun')} />
        <Kpi testId="kpi-scaled" label={t('kpiScaled')} value={k.scaled3d ? `${k.scaled3d.scaled}/${k.scaled3d.total}` : null} empty={t('no3d')} />
        <Kpi testId="kpi-review" label={t('kpiReview')} value={String(k.needsReview)} empty="" />
        <Kpi testId="kpi-validated" label={t('kpiValidated')} value={k.validated === null ? null : `${k.validated}/${w.objects.length}`} empty={t('validationUnavailable')} />
      </div>
      {w.demo && <p className="text-[11px] text-[#C7B3FF]">DATA CONTOH — dikecualikan dari KPI portofolio.</p>}
      <MiniMap objects={w.objects} activeId={activeObject?.objectId ?? null} onSelect={setActiveObject} />
      <p className="text-[11px] text-[#8B9BB0]">Titik objek berwarna keparahan; abu-abu = keparahan belum dinilai.</p>
      <div>
        <SectionTitle>Progres pipeline</SectionTitle>
        <div className="grid grid-cols-4 gap-2 md:grid-cols-8" data-testid="pipeline-strip">
          {STAGE_IDS.slice(0, 8).map((s) => {
            const r = latest[s];
            const tone = STAGE_TONE[r?.status ?? 'not_started'];
            const cls = { green: 'bg-[#123524] text-[#6EE7A8]', amber: 'bg-[#3A2C0B] text-[#F5C451]', red: 'bg-[#3B1418] text-[#F59AA3]', grey: 'bg-[#1A2230] text-[#9AA8BC]', violet: 'bg-[#2A1C46] text-[#C7B3FF]', blue: 'bg-[#0F2A4A] text-[#8CC4FF]' }[tone];
            return (
              <button key={s} type="button" title={r?.reason ?? ''} onClick={() => setTab(TAB_FOR_STAGE[s])} className={`rounded-lg px-2 py-2 text-center text-[12px] leading-4 ${cls}`}>
                <div className="font-semibold">{s.slice(0, 2)} {STAGE_NAME[s.slice(0, 2)]}</div>
                <div className="text-[11px] opacity-90">{r?.status ?? 'belum'}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const OverviewPanel: React.FC = () => {
  const t = useWsT();
  const { openQueue } = React.useContext(WorkspaceNavContext);
  const { workspace: w, activeObject, setActiveObject, isOpsManager, isFieldEngineer, run, reportId, setTab } = useWorkspace();
  const [assign, setAssign] = useState(false);
  const [reason, setReason] = useState('');
  if (!w) return null;
  return (
    <div>
      <SectionTitle>{t('objects')}</SectionTitle>
      <table className="w-full text-[12px]" data-testid="object-table">
        <thead className="text-left text-[#8B9BB0]"><tr><th className="py-1 pr-2">ID</th><th className="pr-2">{t('type')}</th><th className="pr-2">{t('severity')}</th><th>{t('status')}</th></tr></thead>
        <tbody>
          {w.objects.map((o) => (
            <tr key={o.objectId} onClick={() => setActiveObject(o.objectId)} className={`cursor-pointer border-b border-[#1A2430] ${o.objectId === activeObject?.objectId ? 'bg-[#13243A]' : 'hover:bg-[#111C28]'}`}>
              <td className="py-1.5 font-medium">{o.objectId}</td>
              <td>{classLabel(o.class.value)}</td>
              <td>
                {o.severity.value ?? (o.reportedByCitizen?.severity ? <StatusBadge tone="grey" title="Perkiraan pelapor, bukan keparahan terverifikasi">{o.reportedByCitizen.severity} · {t('citizenReported')}</StatusBadge> : '—')}
              </td>
              <td>
                <StatusBadge tone={o.quality.scaleStatus === 'valid' ? 'green' : o.class.value === 'unclassified' ? 'red' : 'grey'}>
                  {o.quality.scaleStatus === 'valid' ? '3D berskala' : o.quality.scaleStatus === 'relative_only' ? '2D/relatif' : 'tanpa skala'}
                </StatusBadge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <SectionTitle>{t('priority')}</SectionTitle>
      <p className="text-[12px] italic text-[#8B9BB0]" data-testid="priority-unavailable">{t('priorityUnavailable')}</p>
      <SectionTitle>{t('validationStatus')}</SectionTitle>
      <Row label="T6">{(() => { const r = latestRuns(w.stageRuns).T6_validate; return <StatusBadge tone={STAGE_TONE[r?.status ?? 'not_started']}>{r?.reason ?? r?.status ?? '—'}</StatusBadge>; })()}</Row>
      <SectionTitle>{isOpsManager ? t('omActions') : t('feActions')}</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <ActionButton onClick={() => setTab('camera')}>Tinjau objek</ActionButton>
        {/* Assigning an engineer is a workflow decision (REQUEST_INSPECTION in Antrian); here we only log a photo request. */}
        {isOpsManager && openQueue && <ActionButton primary onClick={openQueue}>Tugaskan inspeksi (Antrian)</ActionButton>}
        {(isOpsManager || isFieldEngineer) && <ActionButton onClick={() => setAssign(true)}>{t('requestPhotos')}</ActionButton>}
      </div>
      <div className="mt-3"><VersionActions /></div>
      {assign && (
        <Modal title={t('requestPhotos')} onClose={() => setAssign(false)}>
          <p className="text-[12px] text-[#9AA8BC]">Permintaan dicatat di riwayat audit laporan. Objek: {activeObject?.objectId ?? '—'}. Instruksi slot: konteks, nadir, sekuens memutar 15–30 foto overlap 60–80 %, penanda skala sebidang.</p>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={t('reasonRequired')} className="mt-2 w-full rounded-lg border border-[#273244] bg-[#0A0F14] p-2 text-[13px] text-white" />
          <div className="mt-3 flex justify-end">
            <button type="button" disabled={reason.trim().length < 5} onClick={async () => { await run((g) => g.requestPhotos(reportId, { objectId: activeObject?.objectId, slots: ['konteks', 'nadir', 'sekuens memutar', 'penanda skala'], reason })); setAssign(false); setReason(''); }} className="rounded-lg bg-[#E8B52B] px-3 py-1.5 text-[12px] font-semibold text-[#0A0F14] disabled:opacity-40">OK</button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export const NoSequenceCard: React.FC<{ reason: string }> = ({ reason }) => {
  const t = useWsT();
  const { isOpsManager, isFieldEngineer, run, reportId, activeObject } = useWorkspace();
  return (
    <UnavailableCard
      reason={reason}
      action={{
        label: t('assignFeSequence'),
        disabled: !(isOpsManager || isFieldEngineer),
        onClick: () => run((g) => g.requestPhotos(reportId, { objectId: activeObject?.objectId, slots: ['konteks', 'nadir', 'sekuens memutar 15–30 foto', 'penanda skala'], reason: 'Butuh sekuens foto 3D untuk analisis geometri' }))
      }}
    />
  );
};
