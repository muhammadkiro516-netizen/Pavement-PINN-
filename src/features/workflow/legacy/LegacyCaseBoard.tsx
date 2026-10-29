/**
 * "Tim & Tugas" (M.O) and "Tugas Saya" (F.E) in the layout of the original PAVEMENT-PINN
 * screens: status tabs, report cards with one clear action, and the SPK / evidence /
 * quality-verification modals. Every button runs a command of the shared server workflow
 * (stateMachine.ts), so the old look keeps the new rules: identity-based assignment,
 * server RBAC, evidence photos, M.O verification and the audited history.
 */
import { byPriority, priorityOf } from '../../../domain/workflow/priority';
import React, { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ClipboardCheck, ClipboardList, Eye, HardHat, Layers, MapPin, Navigation, RefreshCw, RotateCcw, ShieldCheck, Camera, X, Inbox, History } from 'lucide-react';
import type { ReportCase, WorkflowAction, WorkflowState } from '../../../domain/workflow/model';
import type { WorkflowCommand } from '../../../domain/workflow/stateMachine';
import type { EngineerSummary, GatewayMode, ReportView } from '../../../services/api/workflowClient';
import type { ReportMutationOutcome } from '../../../types/reports';
import { samePerson } from '../../../domain/identity/people';
import { operationsQueue } from '../queues';
import { ACTION_LABEL, WORKFLOW_STATE_LABEL } from '../workflowLabels';
import { ReportWorkflowPanel, actorName } from '../ReportWorkflowPanel';
import type { RoadSegment } from '../../../types';
import { TaskNavigation } from './TaskNavigation';
import { GuidedInspection } from './GuidedInspection';
import { InspectionCaseSummary, ReporterAngles } from './InspectionCaseSummary';
import { RepairResult } from './RepairResult';
import { friendlyError } from '../friendlyError';
import { fieldStage } from '../../work-orders/fieldStages';
import { BeforeAfterSlider } from '../../../components/ui/BeforeAfterSlider';
import { AccountContext, type AccountInfo } from './AccountContext';
import { isOverdue } from '../queues';
import { apiUrl } from '../../../services/api/client';
import {
  canonicalStatusOf,
  CANONICAL_STATUS_LIST,
  CANONICAL_STATUS_META,
  CanonicalStatusKey
} from '../../../domain/workflow/canonicalStatus';

type Role = 'OPS' | 'FE';
export type Tab = CanonicalStatusKey | 'ALL';

const tabOf = (c: ReportCase, _role?: Role): CanonicalStatusKey => canonicalStatusOf(c);

/** What the user just did, in words, once the server confirmed it. */
function doneText(action: WorkflowAction, c: ReportCase): string {
  switch (action) {
    case 'REQUEST_INSPECTION':
      return `SPK ${c.assignment?.id ?? ''} diterbitkan untuk ${c.assignment ? actorName(c.assignment.engineerId) : 'F.E'}`;
    case 'REVIEW_ACCEPT':
      return 'Laporan diterima dan divalidasi';
    case 'SUBMIT_INSPECTION':
      return 'Hasil inspeksi terkirim · menunggu verifikasi M.O';
    case 'VERIFY_INSPECTION':
      return 'Hasil inspeksi diverifikasi';
    case 'REQUEST_REINSPECTION':
      return 'Inspeksi dikembalikan ke F.E dengan alasan';
    case 'COMPLETE_WORK_ORDER':
      return 'Bukti perbaikan terkirim · menunggu verifikasi M.O';
    case 'REQUEST_REWORK':
      return 'Perbaikan dikembalikan ke F.E dengan alasan revisi';
    case 'RESOLVE':
      return 'Perbaikan diverifikasi — laporan selesai dan pelapor diberi notifikasi';
    default:
      return `${ACTION_LABEL[action]} tersimpan`;
  }
}

const TAB_LABEL = (t: Tab) => (t === 'ALL' ? 'Semua' : CANONICAL_STATUS_META[t]?.label ?? t);

const BTN = 'inline-flex items-center justify-center gap-2 rounded-control px-3.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD60A]/60 disabled:opacity-50';
const BTN_BRAND = `${BTN} bg-[#FFD60A] text-slate-950 hover:bg-[#FFD60A] shadow-sm cursor-pointer`;
const BTN_GOOD = `${BTN} bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm cursor-pointer`;
const BTN_GHOST = `${BTN} border border-line-subtle bg-card text-ink hover:bg-raised cursor-pointer`;
const BTN_DANGER = `${BTN} border border-rose-500/50 text-rose-300 hover:bg-rose-500/10 cursor-pointer`;
const INPUT = 'w-full rounded-control border border-line-subtle bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:border-[#FFD60A]';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-ink-3 mb-1.5';

const PRIORITY = { HIGH: 'Tinggi', MEDIUM: 'Sedang', LOW: 'Rendah' } as const;
const PRIORITY_OF: Record<string, keyof typeof PRIORITY> = { CRITICAL: 'HIGH', SEVERE: 'HIGH', MODERATE: 'MEDIUM', LIGHT: 'LOW' };
const fmt = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export interface LegacyCaseBoardProps {
  role: Role;
  views: ReportView[];
  /** Server actor id of this tab (F.E: whose tasks to show). */
  me: string;
  mode: GatewayMode;
  engineers: EngineerSummary[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onRun: (caseId: string, command: WorkflowCommand) => Promise<ReportMutationOutcome>;
  onShowOnMap?: (c: ReportCase) => void;
  /** Opens the PINN analysis workspace for the report (route layer decides the URL). */
  onOpenAnalysis?: (c: ReportCase) => void;
  onStartNavigation?: (c: ReportCase) => void;
  /** Road network for the task navigation map. */
  roadSegments?: RoadSegment[];
  /** Signed-in account, for the account context header. */
  account?: AccountInfo | null;
  /** Set from the workflow guide: open this tab and scroll the list into view. */
  focus?: { tab: Tab; nonce: number } | null;
}

type Dialog = { kind: 'SPK' | 'EVIDENCE' | 'VERIFY' | 'WORK_DONE' | 'WORK_VERIFY' | 'NAV' | 'RESULT'; caseId: string } | { kind: 'PANEL'; caseId: string; action: WorkflowAction | null } | { kind: 'PHOTO'; src: string; alt: string };

export const LegacyCaseBoard: React.FC<LegacyCaseBoardProps> = ({ role, views, me, mode, engineers, loading, error, onRefresh, onRun, onShowOnMap, onOpenAnalysis, onStartNavigation, roadSegments = [], account = null, focus = null }) => {
  const [tab, setTab] = useState<Tab>(role === 'OPS' ? 'MENUNGGU_PENINJAUAN' : 'MENUNGGU_FE');
  const listTop = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focus || focus.nonce === 0) return;
    setTab(focus.tab);
    listTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus]);
  // After a server-confirmed action: say what happened and, if the case now belongs to
  // another tab, follow it there and highlight it.
  const [notice, setNotice] = useState<{ id: string; text: string; to: Tab | null } | null>(null);
  const follow = useRef<{ id: string; action: WorkflowAction; version: number } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // When the server data last arrived in this browser (polling or after an action).
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  useEffect(() => {
    if (views.length) setSyncedAt(new Date().toISOString());
  }, [views]);

  const staff = useMemo(() => views.filter((v): v is Extract<ReportView, { audience: 'STAFF' }> => v.audience === 'STAFF'), [views]);
  const mine = useMemo(() => (role === 'FE' ? staff.filter((v) => samePerson(v.case.assignment?.engineerId, me)) : staff), [staff, role, me]);
  const byId = useMemo(() => new Map(mine.map((v) => [v.case.id, v])), [mine]);

  // Canonical status grouping: ordered 1..8 sequentially, followed by 'ALL'
  const groups = useMemo(() => {
    const inTab = (c: ReportCase) => tab === 'ALL' || canonicalStatusOf(c) === tab;
    const filtered = mine.map((v) => v.case).filter(inTab);

    if (tab !== 'ALL') {
      const meta = CANONICAL_STATUS_META[tab as CanonicalStatusKey];
      return [
        {
          title: meta?.label ?? '',
          hint: meta?.operationalMeaning ?? '',
          items: filtered.sort((a, b) => byPriority(a, b))
        }
      ].filter((g) => g.items.length > 0);
    }

    return CANONICAL_STATUS_LIST.map((key) => {
      const meta = CANONICAL_STATUS_META[key];
      const items = filtered
        .filter((c) => canonicalStatusOf(c) === key)
        .sort((a, b) => byPriority(a, b));
      return {
        title: meta.label,
        hint: meta.operationalMeaning,
        items
      };
    }).filter((g) => g.items.length > 0);
  }, [mine, tab]);

  const count = (t: Tab) => mine.filter((v) => t === 'ALL' || canonicalStatusOf(v.case) === t).length;

  const tabs: { key: Tab; label: string; dot: string }[] = [
    { key: 'MENUNGGU_PENINJAUAN', label: 'Menunggu Peninjauan', dot: 'bg-amber-400' },
    { key: 'PERLU_VERIFIKASI', label: 'Perlu Verifikasi', dot: 'bg-orange-400' },
    { key: 'BELUM_DITUGASKAN', label: 'Belum Ditugaskan', dot: 'bg-slate-400' },
    { key: 'MENUNGGU_FE', label: 'Menunggu F.E', dot: 'bg-blue-400' },
    { key: 'SEDANG_DIKERJAKAN', label: 'Sedang Dikerjakan', dot: 'bg-sky-400' },
    { key: 'MENUNGGU_VERIFIKASI', label: 'Menunggu Verifikasi', dot: 'bg-indigo-400' },
    { key: 'PERLU_REVISI', label: 'Perlu Revisi', dot: 'bg-rose-400' },
    { key: 'SELESAI', label: 'Selesai', dot: 'bg-emerald-400' },
    { key: 'ALL', label: 'Semua', dot: 'bg-slate-400' }
  ];

  const open = dialog && 'caseId' in dialog ? byId.get(dialog.caseId) ?? null : null;
  const run = async (command: WorkflowCommand) => {
    const c = open!.case;
    const out = await onRun(c.id, command);
    if (out.ok) follow.current = { id: c.id, action: command.action as WorkflowAction, version: c.version };
    return out;
  };

  // Runs once the refreshed case (newer version) is in the list: compute its tab from the
  // server data, not from a guess.
  useEffect(() => {
    const f = follow.current;
    if (!f) return;
    const c = byId.get(f.id)?.case;
    if (!c || c.version <= f.version) return;
    follow.current = null;
    const next = canonicalStatusOf(c);
    const moves = tab !== 'ALL' && next !== tab;
    if (moves) setTab(next);
    setNotice({ id: c.id, text: doneText(f.action, c), to: moves ? next : null });
  }, [byId, tab]);

  return (
    <div className="w-full min-w-0 px-4 sm:px-5 py-5 pb-8 space-y-4 text-fg">
      {role === 'FE' ? (
        <header className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold">
                <ClipboardList className="h-6 w-6 text-brand" /> Tugas Saya
                <span className="rounded-full bg-status-good/15 px-2 py-0.5 text-xs font-bold text-emerald-300">{mine.length} Tugas</span>
              </h1>
              <p className="mt-1 text-sm text-fg-muted">Kasus yang ditugaskan koordinator kepada Anda.</p>
            </div>
            <RefreshButton loading={loading} onRefresh={onRefresh} />
          </div>
          {!focus && <AccountContext role="FE" account={account} cases={mine.map((v) => v.case)} mode={mode} syncedAt={syncedAt} onTab={setTab} />}
        </header>
      ) : (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Tim &amp; Tugas</h1>
            <p className="mt-1 text-sm text-fg-muted">
              Semua laporan warga dan penugasan petugas. AI menyaring; keputusan di tangan Anda.
            </p>
          </div>
          <RefreshButton loading={loading} onRefresh={onRefresh} />
        </header>
      )}
      {role === 'OPS' && !focus && <AccountContext role="OPS" account={account} cases={mine.map((v) => v.case)} mode={mode} syncedAt={syncedAt} onTab={setTab} />}

      <div ref={listTop} className="scroll-mt-4" />
      <nav className="flex items-center gap-2 overflow-x-auto no-scrollbar rounded-panel border border-line-subtle bg-panel p-2" aria-label="Filter status">
        {tabs.map((t) => {
          const isSelected = tab === t.key;
          const cCount = count(t.key);
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={isSelected}
              className={`inline-flex shrink-0 items-center gap-2 rounded-control px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
                isSelected
                  ? 'bg-[#FFD60A] text-slate-950 shadow-sm ring-1 ring-[#FFD60A]/40'
                  : 'text-ink-2 hover:bg-raised hover:text-ink'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${isSelected ? 'bg-slate-950' : t.dot}`} />
              <span>{t.label}</span>
              <span className={`rounded-md px-1.5 py-0.2 text-[10px] font-mono tabular-nums ${isSelected ? 'bg-slate-950/20 text-slate-950' : 'bg-card text-ink-2 border border-line-subtle'}`}>
                {cCount}
              </span>
            </button>
          );
        })}
      </nav>

      {notice && (
        <p role="status" className="flex items-center justify-between gap-3 rounded-lg border border-info/40 bg-info/10 px-4 py-2.5 text-sm text-fg">
          <span>
            <b>{notice.text}</b> — <span className="font-mono">{notice.id}</span>
            {notice.to && <> dipindahkan ke tab <b>{TAB_LABEL(notice.to)}</b>.</>}
          </span>
          <button type="button" className="text-xs text-fg-muted underline cursor-pointer" onClick={() => setNotice(null)}>Tutup</button>
        </p>
      )}
      {error && <p role="alert" className="rounded-lg border border-status-heavy/40 bg-status-heavy/10 px-4 py-3 text-sm text-rose-200">Gagal memuat data dari server: {error}</p>}

      {groups.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line-subtle bg-panel p-10 text-center">
          <Inbox className="mx-auto h-8 w-8 text-slate-500" />
          <p className="mt-3 font-semibold text-slate-200">Tidak ada laporan di kategori ini</p>
          <p className="mt-1 text-sm text-slate-400">
            {role === 'FE' ? 'Tugas baru muncul setelah O.M menerbitkan SPK kepada Anda. Pilih tab lain untuk melihat riwayat.' : 'Pilih tab lain untuk melihat laporan pada status berbeda.'}
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.title || 'list'} className="space-y-3">
            {g.title && (
              <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1">
                <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <span>{g.title}</span>
                  <span className="rounded-md bg-[#FFD60A]/15 px-2 py-0.5 text-xs text-[#FFD60A] tabular-nums font-mono">
                    {g.items.length}
                  </span>
                </h2>
                <span className="text-xs text-slate-400">{g.hint}</span>
              </div>
            )}
            {g.items.map((c, ci) => (
              <div key={c.id} className="pp-rise" style={{ animationDelay: `${Math.min(ci, 8) * 60}ms` }}>
              <CaseCard
                key={c.id}
                c={c}
                role={role}
                highlight={notice?.id === c.id}
                actions={byId.get(c.id)?.availableActions ?? []}
                onDialog={setDialog}
                onShowOnMap={onShowOnMap}
                onOpenAnalysis={onOpenAnalysis}
                onStartNavigation={onStartNavigation}
                onFastAccept={async () => {
                  await run({ action: 'REVIEW_ACCEPT', reason: 'Laporan divalidasi dan siap ditugaskan' });
                }}
              />
              </div>
            ))}
          </section>
        ))
      )}

      {dialog?.kind === 'PHOTO' && (
        <Modal title={dialog.alt} onClose={() => setDialog(null)} wide>
          <img src={dialog.src} alt={dialog.alt} className="max-h-[75vh] w-full rounded-lg object-contain bg-canvas" />
        </Modal>
      )}
      {open && dialog?.kind === 'SPK' && <SpkModal c={open.case} engineers={engineers} onRun={run} onClose={() => setDialog(null)} />}
      {open && dialog?.kind === 'EVIDENCE' && <GuidedInspection c={open.case} onRun={run} onClose={() => setDialog(null)} />}
      {open && dialog?.kind === 'VERIFY' && <VerifyModal c={open.case} onRun={run} onClose={() => setDialog(null)} />}
      {open && dialog?.kind === 'WORK_DONE' && <WorkDoneModal c={open.case} onRun={run} onClose={() => setDialog(null)} />}
      {open && dialog?.kind === 'WORK_VERIFY' && <WorkVerifyModal c={open.case} onRun={run} onClose={() => setDialog(null)} />}
      {open && dialog?.kind === 'NAV' && (
        <TaskNavigation
          c={open.case}
          roadSegments={roadSegments}
          onBack={() => setDialog(null)}
          onStartLiveNavigation={onStartNavigation ? () => { setDialog(null); onStartNavigation(open.case); } : undefined}
        />
      )}
      {open && dialog?.kind === 'RESULT' && (
        <Modal title="Hasil laporan perbaikan jalan (Before & After)" subtitle={<>Laporan <span className="text-brand">{open.case.id}</span></>} icon={<CheckCircle2 className="h-5 w-5" />} onClose={() => setDialog(null)} wide>
          <RepairResult c={open.case} />
          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <button type="button" className={BTN_GHOST} onClick={() => setDialog({ kind: 'PANEL', caseId: open.case.id, action: null })}>
              <History className="h-4 w-4" /> Detail lengkap
            </button>
            <button type="button" className={BTN_GOOD} onClick={() => setDialog(null)}>Tutup hasil laporan</button>
          </div>
        </Modal>
      )}
      {open && dialog?.kind === 'PANEL' && (
        <ReportWorkflowPanel
          view={open}
          mode={mode}
          engineers={engineers}
          onRun={run}
          initialAction={dialog.action}
          onShowOnMap={onShowOnMap ? () => onShowOnMap(open.case) : undefined}
          onClose={() => setDialog(null)}
          isModal={true}
        />
      )}
    </div>
  );
};

const RefreshButton: React.FC<{ loading: boolean; onRefresh: () => void }> = ({ loading, onRefresh }) => (
  <button type="button" onClick={onRefresh} className={BTN_GHOST}>
    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Muat ulang
  </button>
);

/** One report card, unified under canonical 8-stage workflow */
const CaseCard: React.FC<{
  highlight?: boolean;
  c: ReportCase;
  role: Role;
  actions: WorkflowAction[];
  onDialog: (d: Dialog) => void;
  onShowOnMap?: (c: ReportCase) => void;
  onOpenAnalysis?: (c: ReportCase) => void;
  onStartNavigation?: (c: ReportCase) => void;
  onFastAccept?: () => Promise<void>;
}> = ({ c, role, actions, onDialog, onShowOnMap, onOpenAnalysis, onStartNavigation, onFastAccept, highlight }) => {
  const r = c.report;
  const priority = priorityOf(c);
  const statusKey = canonicalStatusOf(c);
  const statusMeta = CANONICAL_STATUS_META[statusKey];
  const lastReview = c.inspectionReviews?.at(-1);
  const returned = c.state === 'FIELD_INSPECTION_REQUESTED' && lastReview?.decision === 'REINSPECTION_REQUESTED' ? lastReview : null;
  const done = statusKey === 'SELESAI';
  const lastWork = c.workOrder?.submissions?.at(-1);
  const rework = (statusKey === 'PERLU_REVISI' && lastWork?.decision === 'REWORK_REQUESTED') ? lastWork : null;
  const wo = c.workOrder;
  const beforePhoto = r.photoUrl;
  const afterPhoto = wo?.completionPhotoUrl || c.inspection?.evidencePhotoUrl || r.repairDetails?.afterPhotoUrl;

  // Primary action button based on role & canonical status
  let primary: React.ReactNode = null;
  // The step that needs a person now, by real workflow state: inspection -> case summary ->
  // recommendation -> approval -> SPK. The canonical tabs below cover the repair steps.
  const can = (a: WorkflowAction) => actions.includes(a);
  const workDone = wo?.status === 'COMPLETED' || !!wo?.completedAt;
  const waitNote = (text: string) => <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-center text-xs font-semibold text-sky-200">{text}</div>;
  let stateFirst: React.ReactNode = null;
  if (role === 'FE') {
    if (c.state === 'FIELD_INSPECTION_REQUESTED' && can('SUBMIT_INSPECTION')) {
      stateFirst = (
        <button type="button" className={BTN_BRAND} onClick={() => onDialog({ kind: 'EVIDENCE', caseId: c.id })}>
          <Camera className="h-4 w-4" /> {returned ? 'Inspeksi ulang (foto 3–5 sisi)' : 'Mulai inspeksi terpandu (foto 3–5 sisi)'}
        </button>
      );
    } else if (c.state === 'INSPECTED' && !workDone) stateFirst = waitNote('Ringkasan kasus terkirim · menunggu koordinator');
    else if (c.state === 'INSPECTION_VERIFIED' && can('RECOMMEND_ACTION')) {
      stateFirst = (
        <button type="button" className={BTN_BRAND} onClick={() => onDialog({ kind: 'PANEL', caseId: c.id, action: 'RECOMMEND_ACTION' })}>
          <ClipboardList className="h-4 w-4" /> Susun rekomendasi penanganan
        </button>
      );
    } else if (c.state === 'ACTION_RECOMMENDED' || c.state === 'ACTION_APPROVED') stateFirst = waitNote(c.state === 'ACTION_RECOMMENDED' ? 'Rekomendasi menunggu persetujuan koordinator' : 'Disetujui · menunggu SPK perbaikan');
  } else {
    if (c.state === 'INSPECTED' && !workDone && can('VERIFY_INSPECTION')) {
      stateFirst = (
        <button type="button" className={BTN_BRAND} onClick={() => onDialog({ kind: 'VERIFY', caseId: c.id })}>
          <ShieldCheck className="h-4 w-4" /> Cek ringkasan kasus dari lapangan
        </button>
      );
    } else if (c.state === 'FIELD_INSPECTION_REQUESTED') stateFirst = waitNote('Petugas sedang inspeksi di lapangan');
    else if (c.state === 'INSPECTION_VERIFIED') stateFirst = waitNote('Menunggu rekomendasi petugas (analisis PINN)');
    else if (c.state === 'ACTION_RECOMMENDED' && can('APPROVE_ACTION')) {
      stateFirst = (
        <button type="button" className={BTN_BRAND} onClick={() => onDialog({ kind: 'PANEL', caseId: c.id, action: 'APPROVE_ACTION' })}>
          <ClipboardCheck className="h-4 w-4" /> Tinjau & setujui rekomendasi
        </button>
      );
    } else if (c.state === 'ACTION_APPROVED' && can('START_WORK')) {
      stateFirst = (
        <button type="button" className={BTN_BRAND} onClick={() => onDialog({ kind: 'PANEL', caseId: c.id, action: 'START_WORK' })}>
          <HardHat className="h-4 w-4" /> Terbitkan SPK perbaikan
        </button>
      );
    }
  }
  if (stateFirst) {
    primary = stateFirst;
  } else if (role === 'OPS') {
    switch (statusKey) {
      case 'MENUNGGU_PENINJAUAN':
      case 'BELUM_DITUGASKAN':
        primary = (
          <button type="button" className={BTN_BRAND} onClick={() => onDialog({ kind: 'SPK', caseId: c.id })}>
            <HardHat className="h-4 w-4" /> Terima & tugaskan inspeksi
          </button>
        );
        break;
      case 'PERLU_VERIFIKASI':
        primary = (
          <button type="button" className={BTN_BRAND} onClick={() => onDialog({ kind: 'PANEL', caseId: c.id, action: null })}>
            <Eye className="h-4 w-4" /> Periksa Kelengkapan Data
          </button>
        );
        break;
      case 'MENUNGGU_VERIFIKASI':
        primary = (
          <button type="button" className={BTN_BRAND} onClick={() => onDialog({ kind: 'WORK_VERIFY', caseId: c.id })}>
            <ShieldCheck className="h-4 w-4" /> Verifikasi
          </button>
        );
        break;
      case 'SELESAI':
        primary = (
          <button type="button" className={`${BTN_GHOST} border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10`} onClick={() => onDialog({ kind: 'RESULT', caseId: c.id })}>
            <Eye className="h-4 w-4 text-emerald-400" /> Lihat Hasil (Before &amp; After)
          </button>
        );
        break;
      default:
        break;
    }
  } else {
    // FE role
    switch (statusKey) {
      case 'MENUNGGU_FE':
      case 'SEDANG_DIKERJAKAN':
        primary = (
          <button type="button" className={BTN_GOOD} onClick={() => onDialog({ kind: 'WORK_DONE', caseId: c.id })}>
            <CheckCircle2 className="h-4 w-4" /> Sudah Selesai (Kirim Bukti Selesai)
          </button>
        );
        break;
      case 'PERLU_REVISI':
        primary = (
          <button type="button" className={BTN_GOOD} onClick={() => onDialog({ kind: 'WORK_DONE', caseId: c.id })}>
            <CheckCircle2 className="h-4 w-4" /> Perbaiki &amp; Kirim Ulang Bukti
          </button>
        );
        break;
      case 'MENUNGGU_VERIFIKASI':
        primary = (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-center text-xs font-semibold text-emerald-300">
            ✓ Bukti Perbaikan Berhasil Dikirim
          </div>
        );
        break;
      case 'SELESAI':
        primary = (
          <button type="button" className={`${BTN_GHOST} border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10`} onClick={() => onDialog({ kind: 'RESULT', caseId: c.id })}>
            <Eye className="h-4 w-4 text-emerald-400" /> Lihat Hasil Terverifikasi
          </button>
        );
        break;
      default:
        break;
    }
  }

  const waitingNotice = !primary && !done ? (
    role === 'OPS' ? (
      statusKey === 'MENUNGGU_FE' ? (
        <span className="text-slate-400 text-xs">SPK diterbitkan · Menunggu F.E</span>
      ) : statusKey === 'SEDANG_DIKERJAKAN' ? (
        <span className="text-sky-300 text-xs">Sedang dikerjakan oleh F.E</span>
      ) : statusKey === 'PERLU_REVISI' ? (
        <span className="text-rose-300 text-xs">Perbaikan diulang oleh F.E</span>
      ) : null
    ) : (
      statusKey === 'MENUNGGU_VERIFIKASI' ? (
        <span className="text-amber-300 text-xs">Menunggu verifikasi O.M</span>
      ) : null
    )
  ) : null;

  return (
    <article className={`rounded-card border ${statusMeta.borderAccent} bg-panel hover:border-line-active transition-all p-4 sm:p-5 shadow-sm ${highlight ? 'ring-2 ring-sky-500/60' : ''}`}>
      <div className="flex flex-col gap-4 md:flex-row">
        {/* THUMBNAIL / EVIDENCE COLUMN (LEFT) */}
        <div className="shrink-0 w-full md:w-36 flex flex-col gap-1.5">
          {afterPhoto ? (
            <div className="grid grid-cols-2 gap-1.5 h-28 sm:h-32">
              <button
                type="button"
                onClick={() => beforePhoto && onDialog({ kind: 'PHOTO', src: beforePhoto, alt: `Foto sebelum ${c.id}` })}
                className="relative rounded-control overflow-hidden border border-line-subtle bg-card hover:border-line-active transition-colors cursor-pointer"
                title="Perbesar foto sebelum"
              >
                <img src={beforePhoto} alt="Sebelum" className="w-full h-full object-cover" />
                <span className="absolute bottom-1 left-1 rounded bg-black/80 px-1 py-0.2 text-[9px] font-bold text-rose-300">
                  Sebelum
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDialog({ kind: 'PHOTO', src: afterPhoto, alt: `Foto sesudah ${c.id}` })}
                className="relative rounded-control overflow-hidden border border-emerald-500/40 bg-card hover:border-emerald-400 transition-colors cursor-pointer"
                title="Perbesar foto sesudah"
              >
                <img src={afterPhoto} alt="Sesudah" className="w-full h-full object-cover" />
                <span className="absolute bottom-1 left-1 rounded bg-emerald-950/90 px-1 py-0.2 text-[9px] font-bold text-emerald-300">
                  Sesudah
                </span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => beforePhoto && onDialog({ kind: 'PHOTO', src: beforePhoto, alt: `Foto laporan ${c.id}` })}
              className="relative h-28 sm:h-32 w-full rounded-lg overflow-hidden border border-line-subtle bg-card hover:border-line-active transition-colors cursor-pointer"
              title="Perbesar foto laporan"
            >
              {beforePhoto ? (
                <img src={beforePhoto} alt={`Laporan ${c.id}`} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full grid place-items-center text-xs text-slate-500">Tanpa foto</div>
              )}
              <span className="absolute left-1.5 top-1.5 max-w-[90%] truncate rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                {c.id}
              </span>
            </button>
          )}
          {afterPhoto && (
            <span className="text-[10px] font-mono text-center text-slate-500 block truncate">
              {c.id} · Before/After
            </span>
          )}
        </div>

        {/* DETAILS COLUMN (MIDDLE) */}
        <div className="min-w-0 flex-1 space-y-1.5">
          {role === 'OPS' && !done && (
            <p className="text-[12px] text-ink-2" title="Skor prioritas AI: kerusakan + dukungan warga + lama menunggu. Koordinator tetap bebas memutuskan.">
              <span className="mr-1.5 rounded-full bg-[#FFE14D] px-2 py-0.5 text-[11px] font-extrabold text-black">Prioritas {priority.score}</span>
              {priority.reasons.join(' · ')}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusMeta.badgeClass}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotColor}`} /> {statusMeta.label}
            </span>
            <span className="rounded border border-line-subtle bg-card px-1.5 py-0.5 font-mono text-[10px] text-ink-2">{r.damageType}</span>
            <span className="text-[11px] font-semibold text-slate-400">
              · {c.inspection?.severity ?? r.severity} <span className="font-normal text-slate-500">({c.inspection ? 'terukur F.E' : 'estimasi pelapor'})</span>
            </span>
            {isOverdue(c) && <span className="rounded-full border border-rose-500/50 bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-300">Lewat tenggat</span>}
            {c.dataStatus === 'SYNTHETIC' && <span className="rounded border border-amber-500/30 px-1.5 text-[10px] text-amber-200">data contoh</span>}
          </div>

          <h3 className="text-sm font-bold text-slate-100 leading-snug">{r.damageTypeLabel} — {r.segmentName}</h3>
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-500" /> {r.corridor}
            <span className="font-mono text-slate-400">({r.coordinates[0].toFixed(4)}, {r.coordinates[1].toFixed(4)})</span>
          </p>
          <p className="line-clamp-2 text-xs text-slate-300 italic">“{r.description}”</p>
          <p className="text-[11px] text-slate-500">
            Estimasi pelapor: {r.estimatedDepthCm} cm · {r.estimatedAreaM2} m²
            {c.inspection && <> · Terukur F.E: {c.inspection.measuredDepthCm ?? '—'} cm · {c.inspection.measuredAreaM2 ?? '—'} m²</>}
          </p>

          {c.assignment && (
            <div className="mt-2 rounded-lg border border-line-subtle bg-card p-2.5 text-xs text-ink-2">
              <div className="flex flex-wrap justify-between gap-2">
                <span>
                  <b>SPK {c.assignment.id}</b> · Petugas: <b>{actorName(c.assignment.engineerId)}</b> · Prioritas:{' '}
                  <b className="text-[#FFD60A]">{PRIORITY[PRIORITY_OF[r.severity] ?? 'MEDIUM']}</b>
                </span>
                <span className={isOverdue(c) ? 'font-bold text-rose-300' : 'text-slate-400'}>Batas: {fmt(c.assignment.dueAt)}</span>
              </div>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Instruksi Lapangan</p>
              <p className="text-slate-300 line-clamp-2">{c.assignment.instructions}</p>
            </div>
          )}

          {rework && (
            <p role="status" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
              <b>Alasan perbaikan ulang dari O.M:</b> {rework.reason}
            </p>
          )}

          {statusKey === 'MENUNGGU_VERIFIKASI' && wo && (
            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-2 text-xs text-indigo-200">
              <b>Catatan F.E ({actorName(wo.completedBy || '')}):</b> “{wo.completionNote || 'Pekerjaan perbaikan selesai'}” · {wo.completedAt ? fmt(wo.completedAt) : ''}
            </div>
          )}

          {done && (
            <p className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Selesai &amp; terverifikasi Operations Manager
            </p>
          )}

          {returned && (
            <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
              <b>O.M meminta inspeksi ulang:</b> {returned.reason}
            </p>
          )}

          <p className="text-[11px] text-slate-500">
            Pelapor: <span className="text-slate-400">{r.reporterName}</span> · {fmt(c.createdAt)} · v{c.version}
          </p>
        </div>

        {/* ACTIONS COLUMN (RIGHT) */}
        <div className="flex shrink-0 flex-col gap-2 md:w-60 justify-center">
          {primary}

          {/* Special secondary fast validation for O.M in Menunggu Peninjauan */}
          {role === 'OPS' && statusKey === 'MENUNGGU_PENINJAUAN' && onFastAccept && (
            <button
              type="button"
              className={BTN_GHOST}
              onClick={onFastAccept}
              title="Validasi laporan ini agar berpindah ke Belum Ditugaskan"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Validasi Laporan
            </button>
          )}

          {waitingNotice && (
            <div className="rounded-lg border border-[#202B3B] bg-[#0A101D] px-3 py-2 text-center text-xs text-slate-400">
              {waitingNotice}
            </div>
          )}

          {role === 'FE' && !done && (
            <button
              type="button"
              className={`${BTN_GHOST} hover:border-sky-500/50 hover:text-sky-300 transition-colors cursor-pointer`}
              onClick={() => {
                if (onStartNavigation) {
                  onStartNavigation(c);
                } else {
                  onDialog({ kind: 'NAV', caseId: c.id });
                }
              }}
              title="Buka Navigasi Rute Langsung di Tab Peta Sistem"
            >
              <Navigation className="h-4 w-4 text-cyan-400 animate-pulse" /> Navigasi ke Lokasi
            </button>
          )}

          {onOpenAnalysis && (
            <button type="button" className={BTN_GHOST} data-testid={`pinn-link-${c.id}`} onClick={() => onOpenAnalysis(c)} title="Buka workspace analisis PINN untuk laporan ini">
              <Layers className="h-4 w-4" /> <span>Analisis PINN</span>
            </button>
          )}

          <button
            type="button"
            className={done ? `${BTN_GHOST} border-emerald-500/40 text-emerald-200` : BTN_GHOST}
            onClick={() => onDialog(done ? { kind: 'RESULT', caseId: c.id } : { kind: 'PANEL', caseId: c.id, action: null })}
          >
            {done ? <Eye className="h-4 w-4 text-emerald-400" /> : <History className="h-4 w-4" />}
            <span>{done ? (role === 'FE' ? 'Lihat Hasil Terverifikasi' : 'Lihat Transparansi Mutu') : 'Detail & Riwayat'}</span>
          </button>
        </div>
      </div>
    </article>
  );
};

/** Lets "Batal" inside a modal go through the same discard check as Escape and the close button. */
const ModalClose = createContext<(() => void) | null>(null);

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog shell. Focus moves into the dialog (first field, else first button), Tab stays inside,
 * and focus returns to where it was on close. With `dirty`, closing (Escape, backdrop, ×, Batal)
 * first asks before throwing away unsent input; with `busy`, it cannot close mid-request.
 */
const Modal: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  maxWidthClass?: string;
  dirty?: boolean;
  busy?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, icon, onClose, wide, maxWidthClass, dirty = false, busy = false, footer, children }) => {
  const panel = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const requestClose = () => {
    if (busy) return;
    if (dirty && !confirming) return setConfirming(true);
    onClose();
  };
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const root = panel.current;
    const first = root?.querySelector<HTMLElement>('input:not([type="file"]):not([disabled]), select, textarea') ?? root?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab' && root) {
        const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const [head, tail] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === head) {
          e.preventDefault();
          tail.focus();
        } else if (!e.shiftKey && document.activeElement === tail) {
          e.preventDefault();
          head.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (before && document.contains(before)) before.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/75 p-3 sm:p-5 backdrop-blur-sm" onClick={requestClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`max-h-[min(88vh,820px)] w-full ${maxWidthClass ?? (wide ? 'max-w-3xl' : 'max-w-xl')} flex flex-col overflow-hidden rounded-2xl border border-line bg-surface text-fg shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Fixed & Pinned */}
        <div className="shrink-0 flex items-center justify-between gap-3 border-b border-line px-5 sm:px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <span className="rounded-xl border border-brand/40 bg-brand/10 p-2 text-brand shrink-0">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="text-sm font-bold uppercase tracking-wide truncate">
                {title}
              </h2>
              {subtitle && <p className="mt-0.5 font-mono text-[11px] text-fg-muted truncate">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            className="rounded-full p-1.5 text-fg-muted hover:bg-white/[0.06] hover:text-fg disabled:opacity-40 transition-colors cursor-pointer shrink-0"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {confirming && (
          <div role="alertdialog" aria-label="Buang isian?" className="shrink-0 mx-5 sm:mx-6 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand/50 bg-brand/10 px-3 py-2.5 text-sm">
            <span>Isian di formulir ini belum dikirim dan akan hilang. Buang isian?</span>
            <span className="flex gap-2">
              <button type="button" className={BTN_GHOST} onClick={() => setConfirming(false)}>Lanjut mengisi</button>
              <button type="button" className={BTN_DANGER} onClick={onClose}>Buang &amp; tutup</button>
            </span>
          </div>
        )}

        {/* Modal Body - Scrollable only if needed */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5 sm:p-6">
          <ModalClose.Provider value={requestClose}>{children}</ModalClose.Provider>
        </div>

        {/* Pinned Footer (if provided as prop) */}
        {footer && (
          <div className="shrink-0 border-t border-line bg-surface px-5 sm:px-6 py-3.5">
            <ModalClose.Provider value={requestClose}>{footer}</ModalClose.Provider>
          </div>
        )}
      </div>
    </div>
  );
};

const Summary: React.FC<{ c: ReportCase }> = ({ c }) => (
  <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 rounded-xl border border-line bg-canvas/60 p-3 text-xs">
    <dt className="font-mono text-fg-subtle">JENIS KERUSAKAN</dt><dd className="text-right font-semibold text-brand">{c.report.damageTypeLabel}</dd>
    <dt className="font-mono text-fg-subtle">LOKASI</dt><dd className="truncate text-right">{c.report.segmentName} ({c.report.coordinates[0].toFixed(4)}, {c.report.coordinates[1].toFixed(4)})</dd>
    <dt className="font-mono text-fg-subtle">DESKRIPSI WARGA</dt><dd className="truncate text-right italic">“{c.report.description}”</dd>
  </dl>
);

const SpkSummary: React.FC<{ c: ReportCase }> = ({ c }) => {
  const coords = c.report.coordinates;
  const coordsStr = coords && coords.length >= 2 ? `(${coords[0].toFixed(4)}, ${coords[1].toFixed(4)})` : '';

  return (
    <div className="rounded-xl border border-line bg-canvas/60 p-3.5 text-xs">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-2.5 border-b border-line/60">
        <div className="sm:w-[32%] shrink-0">
          <span className="block font-mono text-[10px] uppercase tracking-wider text-fg-subtle">Jenis Kerusakan</span>
          <span className="mt-1 inline-block font-bold text-brand text-sm tracking-wide">
            {c.report.damageTypeLabel}
          </span>
        </div>
        <div className="sm:flex-1 min-w-0">
          <span className="block font-mono text-[10px] uppercase tracking-wider text-fg-subtle">Lokasi &amp; Ruas Jalan</span>
          <p className="mt-1 text-fg/90 font-medium leading-relaxed truncate sm:whitespace-normal" title={c.report.segmentName}>
            {c.report.segmentName}
            {c.report.corridor && <span className="text-fg-muted font-normal"> · {c.report.corridor}</span>}
            {coordsStr && (
              <span className="font-mono text-[11px] text-fg-subtle ml-1.5 tabular-nums">
                {coordsStr}
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="pt-2.5">
        <span className="block font-mono text-[10px] uppercase tracking-wider text-fg-subtle mb-1">Deskripsi Warga</span>
        <p className="italic text-fg-muted text-xs leading-relaxed">
          &ldquo;{c.report.description || 'Laporan kerusakan jalan dari warga.'}&rdquo;
        </p>
      </div>
    </div>
  );
};

const useSubmit = (onClose: () => void) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (steps: (() => Promise<ReportMutationOutcome>)[], after?: () => void) => {
    setBusy(true);
    setErr(null);
    for (const [i, step] of steps.entries()) {
      const out = await step();
      if (out.ok === false) {
        const text = friendlyError(out.code, out.error);
        setErr(i > 0 ? `Sebagian tersimpan (${i} dari ${steps.length} langkah); langkah berikutnya gagal: ${text}` : text);
        setBusy(false);
        return;
      }
    }
    after?.();
    setBusy(false);
    onClose();
  };
  return { busy, err, submit };
};

const Footer: React.FC<{ err: string | null; children: React.ReactNode; onClose: () => void }> = ({ err, children, onClose }) => {
  const requestClose = useContext(ModalClose) ?? onClose;
  return (
  <>
    {err && <p role="alert" className="mt-3 rounded-lg border border-status-heavy/40 bg-status-heavy/10 px-3 py-2 text-xs text-rose-200">{err}</p>}
    <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
      <button type="button" className={BTN_GHOST} onClick={requestClose}>Batal</button>
      {children}
    </div>
  </>
  );
};

/** M.O: accept the report (if still in review) and assign the field inspection — two audited steps. */
const SpkModal: React.FC<{ c: ReportCase; engineers: EngineerSummary[]; onRun: (cmd: WorkflowCommand) => Promise<ReportMutationOutcome>; onClose: () => void }> = ({ c, engineers, onRun, onClose }) => {
  const [priority, setPriority] = useState<keyof typeof PRIORITY>(PRIORITY_OF[c.report.severity] ?? 'MEDIUM');
  const [taskType, setTaskType] = useState('Survei Kerusakan');
  const [method, setMethod] = useState('Visual + Instrumen');
  const [hours, setHours] = useState('2');
  const [due, setDue] = useState(() => new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10));
  const [engineerId, setEngineerId] = useState(engineers[0]?.id ?? '');
  const [instructions, setInstructions] = useState('');
  const [reason, setReason] = useState('');
  const { busy, err, submit } = useSubmit(onClose);
  const ready = engineerId && instructions.trim() && reason.trim() && due && Number(hours) > 0;

  const go = () => {
    const steps: (() => Promise<ReportMutationOutcome>)[] = [];
    if (c.state === 'NEEDS_REVIEW') steps.push(() => onRun({ action: 'REVIEW_ACCEPT', reason: reason.trim() }));
    steps.push(() =>
      onRun({
        action: 'REQUEST_INSPECTION',
        reason: reason.trim(),
        engineerId,
        dueAt: new Date(`${due}T23:59:00`).toISOString(),
        instructions: `[${taskType} · ${method} · Prioritas ${PRIORITY[priority]} · Estimasi ${hours} jam] ${instructions.trim()}`
      })
    );
    void submit(steps);
  };

  return (
    <Modal
      title="Terbitkan Surat Perintah Kerja (SPK)"
      subtitle={<>Disposisi laporan: <span className="text-brand font-mono">{c.id}</span></>}
      icon={<HardHat className="h-5 w-5" />}
      onClose={onClose}
      maxWidthClass="max-w-[960px]"
      busy={busy}
      dirty={!!(instructions.trim() || reason.trim())}
      footer={
        <div>
          {err && (
            <p role="alert" className="mb-3 rounded-lg border border-status-heavy/40 bg-status-heavy/10 px-3 py-2 text-xs text-rose-200">
              {err}
            </p>
          )}
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              className="h-9 px-4 rounded-lg border border-line bg-elevated hover:bg-white/[0.06] text-fg text-xs font-semibold transition-colors cursor-pointer"
              onClick={onClose}
            >
              Batal
            </button>
            <button
              type="button"
              className="h-9 px-4 rounded-lg bg-brand hover:bg-brand-hover text-navy font-bold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              disabled={!ready || busy}
              onClick={go}
            >
              <HardHat className="h-4 w-4" />
              <span>{busy ? 'Mengirim…' : 'Terbitkan SPK & Tugaskan F.E'}</span>
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* SECTION 1 — INFORMASI LAPORAN */}
        <SpkSummary c={c} />
        <ReporterAngles c={c} />
        {c.state === 'NEEDS_REVIEW' && (
          <p className="text-xs text-fg-muted -mt-1">
            Laporan ini akan <b className="text-fg">diterima</b> lalu <b className="text-fg">ditugaskan</b>; keduanya tercatat di riwayat dengan alasan di bawah.
          </p>
        )}

        {/* SECTION 2 — FORM PENUGASAN (DUA KOLOM VERTIKAL) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
          {/* KOLOM KIRI — PRIORITAS DAN PENANGANAN */}
          <div className="space-y-3.5">
            {/* 1. Tingkat Prioritas */}
            <div>
              <span className={LABEL}>Tingkat Prioritas</span>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(PRIORITY) as (keyof typeof PRIORITY)[]).map((p) => {
                  const isSelected = priority === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      aria-pressed={isSelected}
                      className={`h-[38px] rounded-lg border px-3 py-2 text-xs font-bold transition-all cursor-pointer ${
                        isSelected
                          ? 'border-brand bg-brand/15 text-brand shadow-sm ring-1 ring-brand/40'
                          : 'border-line bg-canvas text-fg-muted hover:border-line-active hover:text-fg'
                      }`}
                    >
                      {PRIORITY[p]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Metode */}
            <label className="block">
              <span className={LABEL}>Metode</span>
              <select className={INPUT} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option>Visual + Instrumen</option>
                <option>Visual</option>
                <option>Instrumen</option>
              </select>
            </label>

            {/* 3. Petugas Field Engineer */}
            <label className="block">
              <span className={LABEL}>Petugas Field Engineer (F.E)</span>
              <select className={INPUT} value={engineerId} onChange={(e) => setEngineerId(e.target.value)}>
                {engineers.length === 0 && <option value="">Tidak ada F.E terdaftar</option>}
                {engineers.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {e.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* KOLOM KANAN — PEKERJAAN DAN JADWAL */}
          <div className="space-y-3.5">
            {/* 1. Jenis Tugas */}
            <label className="block">
              <span className={LABEL}>Jenis Tugas</span>
              <select className={INPUT} value={taskType} onChange={(e) => setTaskType(e.target.value)}>
                <option>Survei Kerusakan</option>
                <option>Pengukuran Detail</option>
                <option>Uji Defleksi (FWD)</option>
              </select>
            </label>

            {/* 2. Estimasi Waktu Kerja */}
            <label className="block">
              <span className={LABEL}>Estimasi Waktu Kerja (Jam)</span>
              <input
                type="number"
                min="0.5"
                step="0.5"
                className={INPUT}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="2"
              />
            </label>

            {/* 3. Batas Waktu Inspeksi */}
            <label className="block">
              <span className={LABEL}>Batas Waktu Inspeksi</span>
              <input
                type="date"
                className={INPUT}
                value={due}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
          </div>
        </div>

        {/* SECTION 3 — CATATAN TEKNIS DAN ALASAN PENUGASAN */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
          {/* Kolom Kiri — Instruksi Teknis & Catatan Lapangan */}
          <label className="block">
            <span className={LABEL}>Instruksi Teknis &amp; Catatan Lapangan</span>
            <textarea
              className={`${INPUT} min-h-[84px] max-h-36 resize-y`}
              rows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Contoh: ukur kedalaman dan luas, foto tepi lubang."
            />
          </label>

          {/* Kolom Kanan — Alasan Penugasan */}
          <label className="block">
            <span className={LABEL}>Alasan Penugasan (Tercatat di Riwayat)</span>
            <textarea
              className={`${INPUT} min-h-[84px] max-h-36 resize-y`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: foto dan lokasi jelas, koridor prioritas."
            />
          </label>
        </div>
      </div>
    </Modal>
  );
};

const BeforeAfter: React.FC<{ before?: string | null; after?: string | null; afterSlot?: React.ReactNode; afterAlt?: string }> = ({ before, after, afterSlot, afterAlt = 'Foto bukti inspeksi (F.E)' }) => (
  <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-canvas/60 p-3">
    <figure>
      <figcaption className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase text-rose-300"><span className="h-2 w-2 rounded-full bg-status-heavy" /> Foto sebelum (warga)</figcaption>
      {before ? <img src={before} alt="Foto laporan warga (R.E)" className="h-36 w-full rounded-lg border border-line object-cover" /> : <div className="grid h-36 place-items-center rounded-lg border border-line text-xs text-fg-subtle">Tanpa foto</div>}
    </figure>
    <figure>
      <figcaption className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase text-emerald-300"><span className="h-2 w-2 rounded-full bg-status-good" /> Foto bukti F.E</figcaption>
      {afterSlot ?? (after ? <img src={after} alt={afterAlt} className="h-36 w-full rounded-lg border border-line object-cover" /> : <div className="grid h-36 place-items-center rounded-lg border border-line text-xs text-fg-subtle">Belum ada foto bukti dari F.E.</div>)}
    </figure>
  </div>
);

/** F.E: inspection result + evidence photo, sent to M.O for verification (not a final status). */
/** M.O: compare citizen photo with F.E evidence, then verify or send back with a reason. */
const VerifyModal: React.FC<{ c: ReportCase; onRun: (cmd: WorkflowCommand) => Promise<ReportMutationOutcome>; onClose: () => void }> = ({ c, onRun, onClose }) => {
  const [reason, setReason] = useState('');
  const { busy, err, submit } = useSubmit(onClose);
  const i = c.inspection;
  return (
    <Modal title="Verifikasi mutu hasil inspeksi oleh M.O" subtitle={<>Laporan: <span className="text-brand">{c.id}</span>{c.assignment && <> · Penugasan {c.assignment.id}</>}</>} icon={<ShieldCheck className="h-5 w-5" />} onClose={onClose} wide busy={busy} dirty={!!reason.trim()}>
      <div className="space-y-4">
        <BeforeAfter before={c.report.photoUrl} after={i?.evidencePhotoUrl} />
        <ReporterAngles c={c} />
        <InspectionCaseSummary c={c} />
        {i && (
          <div className="space-y-2 rounded-xl border border-line bg-canvas/60 p-3 text-xs">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-mono text-fg-subtle">FIELD ENGINEER PELAKSANA</span>
              <span className="font-semibold text-emerald-300">● {actorName(i.engineerId)}</span>
            </div>
            <p>
              Hasil: <b>{i.verdict === 'CONFIRMED' ? 'Kerusakan terkonfirmasi' : 'Tidak ditemukan kerusakan'}</b> · Keparahan <b>{i.severity}</b> · Kedalaman <b>{i.measuredDepthCm ?? '—'} cm</b> · Luas <b>{i.measuredAreaM2 ?? '—'} m²</b>
            </p>
            <p className="rounded-lg bg-surface p-2.5 italic">“{i.notes}”</p>
            <p className="text-fg-muted">Dikirim {fmt(i.inspectedAt)}</p>
          </div>
        )}
        <label className="block"><span className={LABEL}>Alasan keputusan (wajib, tercatat di riwayat)</span>
          <textarea className={INPUT} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Contoh: foto dan ukuran lengkap / ukur ulang luas, foto tepi kurang jelas." />
        </label>
      </div>
      <Footer err={err} onClose={onClose}>
        <button type="button" className={BTN_DANGER} disabled={!reason.trim() || busy} onClick={() => void submit([() => onRun({ action: 'REQUEST_REINSPECTION', reason: reason.trim() })])}>
          <RotateCcw className="h-4 w-4" /> Minta Inspeksi Ulang
        </button>
        <button type="button" className={BTN_GOOD} disabled={!reason.trim() || busy} onClick={() => void submit([() => onRun({ action: 'VERIFY_INSPECTION', reason: reason.trim() })])}>
          <ShieldCheck className="h-4 w-4" /> Verifikasi Hasil Inspeksi
        </button>
      </Footer>
    </Modal>
  );
};

const usePhoto = () => {
  const [photo, setPhoto] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pick = (file?: File) => {
    setErr(null);
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setErr('Gunakan foto JPEG, PNG atau WebP.');
    if (file.size > 5 * 1024 * 1024) return setErr('Foto lebih dari 5 MB.');
    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result));
    reader.onerror = () => setErr('Foto tidak dapat dibaca.');
    reader.readAsDataURL(file);
  };
  return { photo, setPhoto, err, pick };
};

/** F.E: repair finished — a new "after" photo and notes go to M.O; the case stays open until M.O verifies. */
const WorkDoneModal: React.FC<{ c: ReportCase; onRun: (cmd: WorkflowCommand) => Promise<ReportMutationOutcome>; onClose: () => void }> = ({ c, onRun, onClose }) => {
  const { photo, setPhoto, err: photoErr, pick } = usePhoto();
  const [note, setNote] = useState('');
  // SPEC M2.1: what was actually done; required so repair life can be compared per method.
  const [repair, setRepair] = useState({ method: '', materialId: '', thicknessCm: '', areaM2: String(c.inspection?.measuredAreaM2 ?? ''), compactor: '', category: '', valueIdr: '' });
  const [materials, setMaterials] = useState<Array<{ id: string; name: string; minThicknessCm: number | null }>>([]);
  useEffect(() => {
    fetch(apiUrl('/api/materials'), { credentials: 'same-origin' }).then((r) => r.json()).then((j) => setMaterials(j?.materials ?? [])).catch(() => undefined);
  }, []);
  const mat = materials.find((m) => m.id === repair.materialId);
  const thinner = !!mat?.minThicknessCm && Number(repair.thicknessCm) > 0 && Number(repair.thicknessCm) < mat.minThicknessCm;
  const repairOk = !!(repair.method && repair.materialId && Number(repair.thicknessCm) > 0 && Number(repair.areaM2) > 0 && repair.compactor && repair.category);
  const { busy, err, submit } = useSubmit(onClose);
  const sameAsBefore = !!photo && photo === c.report.photoUrl;
  const last = c.workOrder?.submissions?.at(-1);
  const rework = last?.decision === 'REWORK_REQUESTED' ? last : null;
  return (
    <Modal busy={busy} dirty={!!photo || !!note.trim()} title="Kirim bukti perbaikan selesai" subtitle={<>Dikirim ke <span className="text-brand">Operations Manager</span> untuk diverifikasi · {c.id}{c.workOrder && ` · ${c.workOrder.id}`}</>} icon={<Camera className="h-5 w-5" />} onClose={onClose}>
      <div className="space-y-4">
        {rework && <p className="rounded-lg border border-status-heavy/40 bg-status-heavy/10 p-2.5 text-xs text-rose-100"><b>Alasan perbaikan ulang dari M.O:</b> {rework.reason}</p>}
        <BeforeAfter
          before={c.report.photoUrl}
          afterSlot={
            <label htmlFor={`wd-${c.id}`} className="grid h-36 cursor-pointer place-items-center overflow-hidden rounded-lg border border-dashed border-brand/50 text-center text-xs text-amber-200 hover:bg-brand/5">
              {photo ? <img src={photo} alt="Pratinjau foto sesudah perbaikan" className="h-full w-full object-cover" /> : <span><Camera className="mx-auto mb-1 h-5 w-5" /> Wajib lampirkan foto sesudah<br /><span className="text-fg-muted">Klik untuk kamera / unggah</span></span>}
            </label>
          }
        />
        <input id={`wd-${c.id}`} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" aria-label="Foto sesudah perbaikan" onChange={(e) => pick(e.target.files?.[0])} />
        <div className="flex items-center justify-between text-xs">
          <span className={photo && !sameAsBefore ? 'text-emerald-300' : 'text-rose-300'}>{sameAsBefore ? '⚠ Ini foto laporan warga, bukan foto sesudah' : photo ? '✓ Foto sesudah terlampir' : '⚠ Foto sesudah belum diunggah'}</span>
          {photo && <button type="button" className="text-fg-muted underline" onClick={() => setPhoto(null)}>Ganti / hapus foto</button>}
        </div>
        {photoErr && <p role="alert" className="text-xs text-rose-300">{photoErr}</p>}
        <fieldset className="grid grid-cols-2 gap-2 rounded-lg border border-line-subtle p-2.5 text-xs">
          <legend className="px-1 font-semibold text-fg">Data perbaikan (wajib)</legend>
          <label className="col-span-2"><span className={LABEL}>Metode</span>
            <select className={INPUT} value={repair.method} onChange={(e) => setRepair({ ...repair, method: e.target.value })}>
              <option value="">Pilih metode…</option>
              <option value="TAMBAL_DINGIN">Tambal dingin (cold mix / TCM)</option>
              <option value="TAMBAL_PANAS">Tambal panas (hot mix)</option>
              <option value="PATCHING_DALAM">Patching dalam (potong–bongkar–padat)</option>
              <option value="OVERLAY">Overlay (lapis ulang)</option>
              <option value="REKONSTRUKSI">Rekonstruksi</option>
            </select>
          </label>
          <label className="col-span-2"><span className={LABEL}>Material (katalog)</span>
            <select className={INPUT} value={repair.materialId} onChange={(e) => setRepair({ ...repair, materialId: e.target.value })}>
              <option value="">Pilih material…</option>
              {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label><span className={LABEL}>Tebal (cm)</span><input className={INPUT} type="number" min={0} step="0.5" inputMode="decimal" value={repair.thicknessCm} onChange={(e) => setRepair({ ...repair, thicknessCm: e.target.value })} /></label>
          <label><span className={LABEL}>Luas (m²)</span><input className={INPUT} type="number" min={0} step="0.1" inputMode="decimal" value={repair.areaM2} onChange={(e) => setRepair({ ...repair, areaM2: e.target.value })} /></label>
          <label><span className={LABEL}>Alat pemadat</span>
            <select className={INPUT} value={repair.compactor} onChange={(e) => setRepair({ ...repair, compactor: e.target.value })}>
              <option value="">Pilih…</option>
              <option value="STAMPER">Stamper</option>
              <option value="ROLLER">Roller</option>
              <option value="TIDAK_ADA">Tidak ada alat pemadat</option>
            </select>
          </label>
          <label><span className={LABEL}>Kategori</span>
            <select className={INPUT} value={repair.category} onChange={(e) => setRepair({ ...repair, category: e.target.value })}>
              <option value="">Pilih…</option>
              <option value="SEMENTARA">Sementara</option>
              <option value="PERMANEN">Permanen</option>
            </select>
          </label>
          <label className="col-span-2"><span className={LABEL}>Nilai pekerjaan (Rp, opsional)</span><input className={INPUT} inputMode="numeric" value={repair.valueIdr} onChange={(e) => setRepair({ ...repair, valueIdr: e.target.value.replace(/\D/g, '') })} /></label>
          {thinner && <p className="col-span-2 text-amber-300">Tebal di bawah minimum spesifikasi {mat!.name} ({mat!.minThicknessCm} cm). Tetap bisa dikirim; catat alasannya.</p>}
        </fieldset>
        <label className="block"><span className={LABEL}>Catatan penyelesaian &amp; spesifikasi perbaikan</span>
          <textarea id="textarea-fe-completion-note" className={INPUT} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: patching AC-WC 5 cm, dipadatkan, tepi dirapikan." />
        </label>
        <p className="font-mono text-[11px] text-fg-muted">
          Lokasi laporan: {c.report.coordinates[0].toFixed(5)}, {c.report.coordinates[1].toFixed(5)} · Waktu kirim dicatat server. Lokasi foto tidak diverifikasi otomatis.
        </p>
      </div>
      <Footer err={err} onClose={onClose}>
        <button id="btn-fe-kirim-bukti-selesai" type="button" className={BTN_GOOD} disabled={!photo || sameAsBefore || !note.trim() || !repairOk || busy} onClick={() => void submit([() => onRun({ action: 'COMPLETE_WORK_ORDER', reason: note.trim(), completionPhotoUrl: photo!, repair: { method: repair.method as never, materialId: repair.materialId, thicknessCm: Number(repair.thicknessCm), areaM2: Number(repair.areaM2), compactor: repair.compactor as never, category: repair.category as 'SEMENTARA' | 'PERMANEN', valueIdr: repair.valueIdr ? Number(repair.valueIdr) : null } })])}>
          {busy ? 'Mengirim…' : 'Kirim Bukti Perbaikan ke M.O'}
        </button>
      </Footer>
    </Modal>
  );
};

/** M.O: compare before with the F.E repair photo, complete checklist, then verify or ask for rework. */
/** AI second opinion on the after-photo. Advisory: the O.M still compares the photos and decides. */
const RepairCheckCard: React.FC<{ check: NonNullable<ReportCase['workOrder']>['repairCheck'] }> = ({ check }) => {
  if (!check) return null;
  if (!check.ran) return <p className="rounded-xl border border-line-subtle bg-panel p-3 text-xs text-slate-300">Cek AI foto perbaikan tidak berjalan: {check.reason}</p>;
  const still = check.damageStillDetected;
  const tone = check.isRoad === false ? '#FFB020' : still ? '#FF4D5E' : '#2BD67B';
  const headline = check.isRoad === false ? 'Foto sesudah tampaknya bukan permukaan jalan' : still ? `AI masih melihat ${check.detections} titik kerusakan` : 'AI tidak menemukan kerusakan di foto sesudah';
  return (
    <div className="rounded-xl border p-3 text-xs" style={{ borderColor: `${tone}66`, background: `${tone}14` }}>
      <p className="font-bold" style={{ color: tone }}>{headline}</p>
      <div className="mt-2 flex items-center gap-3 text-slate-300">
        <span>Indeks kerusakan visual</span>
        <b className="tabular text-white">{check.indexBefore ?? '—'}</b>
        <span aria-hidden>→</span>
        <b className="tabular text-white">{check.indexAfter ?? '—'}</b>
        <span className="text-slate-500">(0–100, relatif terhadap foto)</span>
      </div>
      <p className="mt-1 text-slate-500">Saran AI saja, bukan keputusan. Bandingkan kedua foto sebelum memverifikasi. Model: {check.modelId ?? '—'}</p>
    </div>
  );
};

const WorkVerifyModal: React.FC<{ c: ReportCase; onRun: (cmd: WorkflowCommand) => Promise<ReportMutationOutcome>; onClose: () => void }> = ({ c, onRun, onClose }) => {
  const [reason, setReason] = useState('');
  const [checklist, setChecklist] = useState({
    treatment: false,
    elevation: false,
    siteClean: false,
  });
  const allChecked = checklist.treatment && checklist.elevation && checklist.siteClean;
  const { busy, err, submit } = useSubmit(onClose);
  const wo = c.workOrder;
  const subs = wo?.submissions ?? [];
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);

  return (
    <Modal busy={busy} dirty={!!reason.trim()} title="Verifikasi Mutu Perbaikan oleh O.M" subtitle={<>Laporan: <span className="text-[#FFD60A] font-mono">{c.id}</span>{wo && <> · Perintah Kerja <span className="font-mono">{wo.id}</span></>}</>} icon={<ShieldCheck className="h-5 w-5 text-[#FFD60A]" />} onClose={onClose} wide>
      <div className="space-y-4">
        {/* 1. INFORMASI TUGAS */}
        <div className="rounded-xl border border-line-subtle bg-card p-3 text-xs space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-white text-sm">{c.report.damageTypeLabel} — {c.report.segmentName}</span>
            <span className="font-mono text-slate-400">({c.report.coordinates[0].toFixed(5)}, {c.report.coordinates[1].toFixed(5)})</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-300">
            <span>Petugas Pelaksana: <b className="text-emerald-400">{wo?.completedBy ? actorName(wo.completedBy) : (c.assignment?.engineerId ? actorName(c.assignment.engineerId) : '—')}</b></span>
            {c.recommendation && <span>Metode SPK: <b className="text-slate-100">{c.recommendation.treatment}</b></span>}
            {c.recommendation && <span>Urgensi: <b className="text-[#FFD60A]">{({ ROUTINE: 'Rutin', PRIORITY: 'Prioritas', URGENT: 'Mendesak' } as Record<string, string>)[c.recommendation.urgency] ?? c.recommendation.urgency}</b></span>}
            {wo?.contractor && <span>Pelaksana: <b className="text-slate-100">{wo.contractor}</b></span>}
          </div>
          {c.assignment?.instructions && (
            <p className="text-slate-400 pt-0.5 border-t border-[#202B3B]/60 mt-1">
              <span className="font-semibold text-slate-300">Instruksi Awal:</span> {c.assignment.instructions}
            </p>
          )}
        </div>

        {/* 2. PERBANDINGAN BUKTI (BEFORE & AFTER SLIDER) */}
        <BeforeAfterSlider
          before={c.report.photoUrl}
          after={wo?.completionPhotoUrl}
          beforeAlt="Foto laporan warga (R.E)"
          afterAlt="Foto sesudah perbaikan (F.E)"
          afterBadge="Menunggu verifikasi O.M"
          onZoom={(src, alt) => setZoom({ src, alt })}
        />
        <RepairCheckCard check={wo?.repairCheck ?? null} />
        {zoom && (
          <button type="button" className="fixed inset-0 z-[1300] grid place-items-center bg-black/85 p-4" onClick={() => setZoom(null)} aria-label="Tutup foto">
            <img src={zoom.src} alt={zoom.alt} className="max-h-[90vh] max-w-full rounded-lg object-contain" />
          </button>
        )}

        {/* 3. CATATAN PELAKSANAAN F.E */}
        <div className="space-y-1.5 rounded-xl border border-line-subtle bg-panel p-3 text-xs">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="font-mono text-ink-3">CATATAN PENYELESAIAN F.E</span>
            <span className="text-ink-3">Dikirim {wo?.completedAt ? fmt(wo.completedAt) : '—'}</span>
          </div>
          <p className="rounded-lg bg-card border border-line-subtle p-2.5 italic text-ink">“{wo?.completionNote ?? 'Pekerjaan perbaikan selesai.'}”</p>
        </div>

        {subs.length > 1 && (
          <details className="rounded-xl border border-[#202B3B] bg-[#0A101D] p-3 text-xs">
            <summary className="cursor-pointer font-semibold text-slate-300">Riwayat bukti ({subs.length} pengiriman)</summary>
            <ol className="mt-2 space-y-2">
              {subs.map((s, i) => (
                <li key={s.at} className="flex gap-3">
                  <img src={s.photoUrl} alt={`Bukti perbaikan ke-${i + 1}`} className="h-12 w-16 rounded object-cover" />
                  <span>
                    {fmt(s.at)} · {s.decision === 'REWORK_REQUESTED' ? `diminta revisi: ${s.reason}` : s.decision === 'VERIFIED' ? 'terverifikasi' : 'menunggu keputusan'}
                    <br />
                    <span className="text-slate-400">{s.note}</span>
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}

        {/* 4. CHECKLIST VERIFIKASI MUTU LAPANGAN */}
        <div className="space-y-2 rounded-xl border border-line-subtle bg-card p-3 text-xs">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-200 flex items-center gap-1.5">
              <ClipboardCheck className="h-4 w-4 text-[#FFD60A]" /> Checklist Verifikasi Mutu Lapangan
            </p>
            <button
              type="button"
              id="btn-verify-all-checklist"
              onClick={() => setChecklist({ treatment: true, elevation: true, siteClean: true })}
              className="text-[11px] text-amber-300 hover:text-amber-200 underline cursor-pointer"
            >
              ✓ Centang Semua Kriteria Mutu
            </button>
          </div>
          <p className="text-[11px] text-slate-400">Centang seluruh kriteria hasil pemeriksaan bukti sebelum menyetujui:</p>
          <div className="space-y-2 pt-1">
            <label className="flex items-start gap-2.5 cursor-pointer text-slate-200 hover:text-white">
              <input
                type="checkbox"
                id="checkbox-verify-treatment"
                className="mt-0.5 rounded border-slate-600 text-amber-500 focus:ring-amber-400"
                checked={checklist.treatment}
                onChange={(e) => setChecklist((prev) => ({ ...prev, treatment: e.target.checked }))}
              />
              <span>Pekerjaan perbaikan sesuai metode instruksi SPK ({c.recommendation?.treatment || 'Standar Teknis Aspal'})</span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer text-slate-200 hover:text-white">
              <input
                type="checkbox"
                id="checkbox-verify-elevation"
                className="mt-0.5 rounded border-slate-600 text-amber-500 focus:ring-amber-400"
                checked={checklist.elevation}
                onChange={(e) => setChecklist((prev) => ({ ...prev, elevation: e.target.checked }))}
              />
              <span>Elevasi permukaan perbaikan rata dan menyatu rapi tanpa tonjolan atau cekungan tajam</span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer text-slate-200 hover:text-white">
              <input
                type="checkbox"
                id="checkbox-verify-site-clean"
                className="mt-0.5 rounded border-slate-600 text-amber-500 focus:ring-amber-400"
                checked={checklist.siteClean}
                onChange={(e) => setChecklist((prev) => ({ ...prev, siteClean: e.target.checked }))}
              />
              <span>Area kerja telah dibersihkan dari sisa puing/material agregat &amp; jalur aman dilalui kendaraan</span>
            </label>
          </div>
        </div>

        {/* 5. ALASAN KEPUTUSAN */}
        <label className="block">
          <span className={LABEL}>Alasan Keputusan / Catatan Verifikasi (Wajib jika Minta Revisi)</span>
          <textarea
            id="textarea-verify-reason"
            className={INPUT}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: Permukaan tambalan rata rapi, sambungan aspal rapat. / Tepi perbaikan masih bergelombang, mohon dipadatkan ulang."
          />
        </label>
      </div>
      <Footer err={err} onClose={onClose}>
        <button
          type="button"
          id="btn-om-minta-revisi"
          className={BTN_DANGER}
          disabled={!reason.trim() || busy}
          title={!reason.trim() ? 'Wajib isi alasan revisi' : undefined}
          onClick={() => void submit([() => onRun({ action: 'REQUEST_REWORK', reason: reason.trim() })])}
        >
          <RotateCcw className="h-4 w-4" /> Minta Revisi
        </button>
        <button
          type="button"
          id="btn-om-setujui-verifikasi"
          className={BTN_GOOD}
          disabled={!allChecked || busy}
          title={!allChecked ? 'Lengkapi seluruh checklist verifikasi terlebih dahulu' : undefined}
          onClick={() =>
            void submit([
              () =>
                onRun({
                  action: 'RESOLVE',
                  reason: reason.trim() || 'Pekerjaan perbaikan telah diperiksa dan disetujui sesuai standar operasional.'
                })
            ])
          }
        >
          <ShieldCheck className="h-4 w-4" /> Setujui Verifikasi
        </button>
      </Footer>
    </Modal>
  );
};
