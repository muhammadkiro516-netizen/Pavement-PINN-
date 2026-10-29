/**
 * The report's workflow, as each role should see it: current state, the evidence that
 * matters for the next decision, the history, and only the actions this actor may take.
 * Redesigned into a Horizontal Master Layout with 3 Vertical Content Columns:
 * - Kolom A: Laporan & Bukti
 * - Kolom B: Analisis & Hasil Pemeriksaan
 * - Kolom C: Tindakan & Riwayat
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  MapPin,
  Maximize2,
  X,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  ShieldCheck,
  HardHat,
  ChevronRight,
  ExternalLink,
  Calendar,
  User,
  Activity,
  History
} from 'lucide-react';
import { loadDraft, saveDraft } from '../work-orders/inspectionDraft';
import { apiUrl } from '../../services/api/client';
import { PENDING_CODES, PENDING_LABEL, type PendingCode } from '../../domain/workflow/escalation';
import type { WorkflowAction, WorkflowState, ReportCase } from '../../domain/workflow/model';
import type { PublicReportView } from '../../domain/workflow/projections';
import type { WorkflowCommand } from '../../domain/workflow/stateMachine';
import type { EngineerSummary, GatewayMode, ReportView } from '../../services/api/workflowClient';
import type { ReportMutationOutcome } from '../../types';
import { USER_ACCOUNTS } from '../../data/reference/demoAccounts';
import { ACTION_LABEL, ROLE_SHORT, stateTone, TONE_CLASS, TONE_CLASS_LIGHT, WORKFLOW_STATE_LABEL } from './workflowLabels';

export type PanelTone = 'dark' | 'light';

export interface ReportWorkflowPanelProps {
  view: ReportView | null;
  mode: GatewayMode;
  engineers: EngineerSummary[];
  onRun: (command: WorkflowCommand) => Promise<ReportMutationOutcome>;
  /** Optional: jump to the report's road on the map. */
  onShowOnMap?: () => void;
  /** Smaller paddings for use inside the map bottom sheet. */
  compact?: boolean;
  /** Surface the panel sits on. Dark by default (map sheets, queues). */
  tone?: PanelTone;
  /** Open this action's form immediately (e.g. "Mulai Tugas" opens the inspection form). */
  initialAction?: WorkflowAction | null;
  /** Close dialog callback if rendered in modal dialog */
  onClose?: () => void;
  /** If true, renders the complete workspace modal with overlay, sticky header & sticky footer */
  isModal?: boolean;
}

/** One class set per surface, so both themes use the same brand yellow and muted status colours. */
const SKIN = {
  dark: {
    section: 'border-line-subtle bg-card text-ink',
    column: 'bg-panel border-line-subtle',
    card: 'bg-white/[0.02] border-white/10',
    strong: 'text-slate-100',
    body: 'text-slate-300',
    muted: 'text-[#A6A8AE]',
    label: 'text-slate-300',
    form: 'border-white/10 bg-slate-950/70',
    input: 'bg-slate-900/90 border-white/15 text-slate-100 placeholder:text-slate-500',
    ghost: 'text-slate-300 hover:bg-white/5',
    chip: 'bg-white/[0.04] border-white/15 text-slate-100 hover:bg-white/[0.08]',
    chipOn: 'bg-brand/15 border-brand/60 text-brand-hover',
    link: 'text-[#FFD60A] hover:text-[#FFD60A]/80',
    line: 'border-white/10',
    ok: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
    err: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
    tagDemo: 'border-amber-500/40 text-amber-200 bg-amber-500/10',
    tagObserved: 'border-emerald-500/40 text-emerald-200 bg-emerald-500/10',
    tagNeutral: 'border-slate-500/40 text-slate-300 bg-slate-700/30',
    note: 'text-amber-200'
  },
  light: {
    section: 'border-slate-200 bg-white text-slate-800',
    column: 'bg-slate-50 border-slate-200',
    card: 'bg-white border-slate-200',
    strong: 'text-slate-900',
    body: 'text-slate-700',
    muted: 'text-slate-500',
    label: 'text-slate-600',
    form: 'border-slate-200 bg-slate-50',
    input: 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400',
    ghost: 'text-slate-600 hover:bg-slate-100',
    chip: 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50',
    chipOn: 'bg-amber-50 border-amber-500 text-amber-800',
    link: 'text-amber-700 hover:text-amber-800',
    line: 'border-slate-200',
    ok: 'text-emerald-800 bg-emerald-50 border-emerald-200',
    err: 'text-rose-800 bg-rose-50 border-rose-200',
    tagDemo: 'border-amber-300 text-amber-800 bg-amber-50',
    tagObserved: 'border-emerald-200 text-emerald-800 bg-emerald-50',
    tagNeutral: 'border-slate-300 text-slate-600 bg-slate-100',
    note: 'text-amber-800'
  }
} as const;
type Skin = (typeof SKIN)[PanelTone];

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70';

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
};

const inDays = (days: number) => {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
};

/** Display name for an actor id, with the role in short form (R.E, M.O, F.E, D.M). */
export function actorName(id: string): string {
  if (id.startsWith('system')) return 'Sistem';
  const account = USER_ACCOUNTS.find((a) => a.id === id);
  return account ? `${account.name} (${ROLE_SHORT[account.role] ?? account.role})` : id;
}

export const StateBadge: React.FC<{ state: WorkflowState | string; tone?: PanelTone }> = ({ state, tone = 'dark' }) => (
  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${(tone === 'light' ? TONE_CLASS_LIGHT : TONE_CLASS)[stateTone(state)]}`}>
    <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
    {WORKFLOW_STATE_LABEL[state as WorkflowState] ?? state}
  </span>
);

const DataTag: React.FC<{ children: React.ReactNode; tone?: 'demo' | 'observed' | 'neutral'; skin: Skin }> = ({ children, tone = 'neutral', skin }) => (
  <span className={`inline-block px-2 py-0.5 rounded text-[10.5px] font-bold tracking-wide border ${tone === 'demo' ? skin.tagDemo : tone === 'observed' ? skin.tagObserved : skin.tagNeutral}`}>{children}</span>
);

const Field: React.FC<{ label: string; htmlFor: string; children: React.ReactNode; hint?: string; skin: Skin }> = ({ label, htmlFor, children, hint, skin }) => (
  <div className="space-y-1">
    <label htmlFor={htmlFor} className={`block text-[11px] font-semibold ${skin.label}`}>
      {label}
    </label>
    {children}
    {hint && <p className={`text-[10.5px] ${skin.muted}`}>{hint}</p>}
  </div>
);

/** Compact horizontal key-value row for editorial operational scanning with responsive wrapping */
const InfoRow: React.FC<{
  label: string;
  value: React.ReactNode;
  border?: boolean;
  valueClass?: string;
  mono?: boolean;
}> = ({ label, value, border = true, valueClass = 'text-slate-100 font-semibold', mono = false }) => (
  <div className={`flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-0.5 py-1.5 text-xs min-w-0 ${border ? 'border-b border-white/5' : ''}`}>
    <span className="text-[#A6A8AE] font-normal shrink-0">{label}</span>
    <span className={`${valueClass} ${mono ? 'font-mono' : ''} text-right min-w-0 break-words flex-1`}>{value}</span>
  </div>
);

/** Inline form for one action; builds the command and calls onRun. */
const ActionForm: React.FC<{
  action: WorkflowAction;
  engineers: EngineerSummary[];
  caseData: ReportCase;
  busy: boolean;
  skin: Skin;
  onSubmit: (command: WorkflowCommand) => void;
  onCancel: () => void;
}> = ({ action, engineers, caseData, busy, skin, onSubmit, onCancel }) => {
  const id = (name: string) => `wf-${caseData.id}-${action}-${name}`;
  const inputClass = `w-full rounded-lg border px-3 py-2 text-xs transition-shadow ${skin.input} ${FOCUS}`;
  const [reason, setReason] = useState('');
  const [engineerId, setEngineerId] = useState(engineers[0]?.id ?? '');
  const [dueAt, setDueAt] = useState(inDays(3));
  const [instructions, setInstructions] = useState('');
  // Inspection progress is restored from this browser after a refresh (see inspectionDraft.ts).
  const [draft] = useState(() => (action === 'SUBMIT_INSPECTION' ? loadDraft(caseData) : null));
  const [verdict, setVerdict] = useState<'CONFIRMED' | 'NOT_CONFIRMED'>(draft?.verdict ?? 'CONFIRMED');
  const [cvAccepted, setCvAccepted] = useState(draft?.cvAccepted ?? true);
  const [correctedClass, setCorrectedClass] = useState(draft?.correctedClass ?? '');
  const [depth, setDepth] = useState(draft?.depth ?? '');
  const [area, setArea] = useState(draft?.area ?? '');
  const [severity, setSeverity] = useState<'LIGHT' | 'MODERATE' | 'SEVERE' | 'CRITICAL'>(draft?.severity ?? caseData.inspection?.severity ?? caseData.report.severity);
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [evidence, setEvidence] = useState<string | null>(draft?.evidencePhotoUrl ?? null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const pickEvidence = (file: File | undefined) => {
    setEvidenceError(null);
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setEvidenceError('Gunakan foto JPEG, PNG atau WebP.');
    if (file.size > 5 * 1024 * 1024) return setEvidenceError('Foto lebih dari 5 MB.');
    const reader = new FileReader();
    reader.onload = () => setEvidence(String(reader.result));
    reader.onerror = () => setEvidenceError('Foto tidak dapat dibaca.');
    reader.readAsDataURL(file);
  };
  const [savedAt, setSavedAt] = useState<string | null>(draft?.savedAt ?? null);
  useEffect(() => {
    if (action !== 'SUBMIT_INSPECTION' || caseData.state !== 'FIELD_INSPECTION_REQUESTED') return;
    const touched = depth || area || notes || correctedClass || evidence || verdict !== 'CONFIRMED' || !cvAccepted;
    if (!touched) return;
    const at = new Date().toISOString();
    saveDraft(caseData.id, { version: caseData.version, savedAt: at, verdict, cvAccepted, correctedClass, depth, area, severity, notes, evidencePhotoUrl: evidence });
    setSavedAt(at);
  }, [action, caseData.id, caseData.version, caseData.state, verdict, cvAccepted, correctedClass, depth, area, severity, notes, evidence]);
  const [treatment, setTreatment] = useState('');
  const [urgency, setUrgency] = useState<'ROUTINE' | 'PRIORITY' | 'URGENT'>('PRIORITY');
  const [rationale, setRationale] = useState('');
  const [contractorNote, setContractorNote] = useState('');
  // SPK (surat perintah kerja) details for START_WORK: who does the work, for how much, until when.
  const [contractor, setContractor] = useState('');
  const [contractValue, setContractValue] = useState('');
  const [targetDate, setTargetDate] = useState(inDays(14));
  const [supervisor, setSupervisor] = useState('');
  const [maintenanceMonths, setMaintenanceMonths] = useState('');
  const [pendingCode, setPendingCode] = useState<PendingCode>('MENUNGGU_JADWAL');
  const [pendingUntil, setPendingUntil] = useState(inDays(30));
  // Disposisi: agencies come from the server registry, never typed in.
  const [agencies, setAgencies] = useState<Array<{ id: string; name: string; level: string; parent: string }>>([]);
  const [agencyId, setAgencyId] = useState('');
  useEffect(() => {
    if (action !== 'TRANSFER_AUTHORITY') return;
    fetch(apiUrl('/api/agencies'), { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => {
        const items = (j?.items ?? []).filter((a: { id: string }) => a.id !== caseData.authority?.agencyId);
        setAgencies(items);
        setAgencyId(items[0]?.id ?? '');
      })
      .catch(() => undefined);
  }, [action, caseData.authority?.agencyId]);

  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    switch (action) {
      case 'REQUEST_INSPECTION':
        return onSubmit({ action, reason, engineerId, dueAt: new Date(`${dueAt}T17:00:00`).toISOString(), instructions });
      case 'SUBMIT_INSPECTION':
        return onSubmit({
          action,
          verdict,
          cvReview: { accepted: cvAccepted, correctedClass: cvAccepted ? null : correctedClass },
          measuredDepthCm: num(depth),
          measuredAreaM2: num(area),
          severity,
          notes,
          evidencePhotoUrl: evidence
        });
      case 'RECOMMEND_ACTION':
        return onSubmit({ action, treatment, urgency, rationale, assessmentId: null });
      case 'START_WORK':
        return onSubmit({
          action,
          reason,
          contractorNote,
          contractor,
          contractValueIdr: contractValue.trim() === '' ? null : Number(contractValue.replace(/\D/g, '')),
          targetDate: targetDate ? new Date(`${targetDate}T17:00:00`).toISOString() : null,
          supervisor,
          maintenanceMonths: maintenanceMonths.trim() === '' ? null : Number(maintenanceMonths)
        });
      case 'TRANSFER_AUTHORITY':
        // Name and level are filled from the registry by the server.
        return onSubmit({ action, reason, agencyId, agencyName: '', level: 'KABUPATEN' });
      case 'SET_PENDING':
        return onSubmit({ action, reason, code: pendingCode, until: new Date(`${pendingUntil}T17:00:00`).toISOString() });
      case 'MARK_HAZARD':
        if (!evidence) return setEvidenceError('Foto rambu di lokasi wajib dilampirkan.');
        return onSubmit({ action, reason, photoUrl: evidence, note: notes });
      default:
        return onSubmit({ action, reason } as WorkflowCommand);
    }
  };

  const needsReason = !['SUBMIT_INSPECTION', 'RECOMMEND_ACTION'].includes(action);

  return (
    <form onSubmit={submit} className={`space-y-2 rounded-xl border p-3.5 bg-black/40 border-white/10 ${skin.form}`}>
      <div className="flex items-center justify-between pb-1 border-b border-white/10">
        <p className={`text-xs font-bold text-[#FFD60A]`}>{ACTION_LABEL[action]}</p>
        <span className="text-[10px] text-[#A6A8AE]">Form Tindakan</span>
      </div>

      {action === 'REQUEST_INSPECTION' && (
        <>
          <Field skin={skin} label="Insinyur lapangan (F.E)" htmlFor={id('eng')}>
            <select id={id('eng')} className={inputClass} value={engineerId} onChange={(e) => setEngineerId(e.target.value)} required>
              {engineers.map((en) => (
                <option key={en.id} value={en.id} className="bg-slate-900 text-white">
                  {en.name} — {en.agencyCode} ({en.id})
                </option>
              ))}
            </select>
          </Field>
          <Field skin={skin} label="Batas waktu inspeksi" htmlFor={id('due')}>
            <input id={id('due')} type="date" className={inputClass} value={dueAt} min={inDays(1)} onChange={(e) => setDueAt(e.target.value)} required />
          </Field>
          <Field skin={skin} label="Instruksi untuk insinyur" htmlFor={id('ins')}>
            <textarea id={id('ins')} className={inputClass} rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Mis. ukur kedalaman & luas, foto tepi lubang" />
          </Field>
        </>
      )}

      {action === 'SUBMIT_INSPECTION' && (
        <>
          <Field skin={skin} label="Hasil pemeriksaan" htmlFor={id('verdict')}>
            <select id={id('verdict')} className={inputClass} value={verdict} onChange={(e) => setVerdict(e.target.value as typeof verdict)}>
              <option value="CONFIRMED">Kerusakan terkonfirmasi</option>
              <option value="NOT_CONFIRMED">Tidak ditemukan kerusakan</option>
            </select>
          </Field>
          <div className="flex items-center gap-2 pt-1">
            <input id={id('cv')} type="checkbox" checked={cvAccepted} onChange={(e) => setCvAccepted(e.target.checked)} className="accent-amber-500 rounded" />
            <label htmlFor={id('cv')} className={`text-xs ${skin.label}`}>
              Jenis kerusakan pada laporan sudah benar ({caseData.report.damageTypeLabel})
            </label>
          </div>
          {!cvAccepted && (
            <Field skin={skin} label="Koreksi jenis kerusakan" htmlFor={id('cls')}>
              <input id={id('cls')} className={inputClass} value={correctedClass} onChange={(e) => setCorrectedClass(e.target.value)} required placeholder="Mis. ALLIGATOR_CRACK" />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field skin={skin} label="Kedalaman terukur (cm)" htmlFor={id('depth')}>
              <input id={id('depth')} type="number" min={0} step="0.1" inputMode="decimal" className={inputClass} value={depth} onChange={(e) => setDepth(e.target.value)} placeholder={`laporan: ${caseData.report.estimatedDepthCm}`} />
            </Field>
            <Field skin={skin} label="Luas terukur (m²)" htmlFor={id('area')}>
              <input id={id('area')} type="number" min={0} step="0.1" inputMode="decimal" className={inputClass} value={area} onChange={(e) => setArea(e.target.value)} placeholder={`laporan: ${caseData.report.estimatedAreaM2}`} />
            </Field>
          </div>
          <Field skin={skin} label="Tingkat keparahan" htmlFor={id('sev')}>
            <select id={id('sev')} className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
              <option value="LIGHT">Ringan</option>
              <option value="MODERATE">Sedang</option>
              <option value="SEVERE">Berat</option>
              <option value="CRITICAL">Kritis</option>
            </select>
          </Field>
          <Field skin={skin} label="Catatan inspeksi" htmlFor={id('notes')}>
            <textarea id={id('notes')} className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} required placeholder="Kondisi yang diamati di lapangan" />
          </Field>
          <Field skin={skin} label="Foto bukti inspeksi (opsional)" htmlFor={id('evidence')}>
            <input id={id('evidence')} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className={inputClass} onChange={(e) => pickEvidence(e.target.files?.[0])} />
          </Field>
          {evidenceError && <p role="alert" className="text-xs text-red-300">{evidenceError}</p>}
          {evidence && (
            <div className="flex items-start gap-2 pt-1">
              <img src={evidence} alt="Pratinjau foto bukti inspeksi" className="w-28 h-20 object-cover rounded-lg border border-line" />
              <button type="button" onClick={() => setEvidence(null)} className={`text-xs underline text-rose-400`}>
                Hapus foto
              </button>
            </div>
          )}
          <p className={`text-[11px] ${skin.muted}`} role="status">
            {savedAt
              ? `Draf tersimpan di perangkat ini · ${new Date(savedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.`
              : 'Isian disimpan otomatis sebagai draf di perangkat ini.'}
          </p>
        </>
      )}

      {action === 'RECOMMEND_ACTION' && (
        <>
          <Field skin={skin} label="Penanganan yang direkomendasikan" htmlFor={id('tr')}>
            <input id={id('tr')} className={inputClass} value={treatment} onChange={(e) => setTreatment(e.target.value)} required placeholder="Mis. patching + overlay tipis AC-WC" />
          </Field>
          <Field skin={skin} label="Urgensi" htmlFor={id('urg')}>
            <select id={id('urg')} className={inputClass} value={urgency} onChange={(e) => setUrgency(e.target.value as typeof urgency)}>
              <option value="ROUTINE">Rutin</option>
              <option value="PRIORITY">Prioritas</option>
              <option value="URGENT">Mendesak</option>
            </select>
          </Field>
          <Field skin={skin} label="Alasan teknis" htmlFor={id('rat')} hint="Penilaian ruas dilampirkan otomatis saat disimpan.">
            <textarea id={id('rat')} className={inputClass} rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} required />
          </Field>
        </>
      )}

      {action === 'START_WORK' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field skin={skin} label="Pelaksana" htmlFor={id('ctr')}>
              <input id={id('ctr')} className={inputClass} value={contractor} onChange={(e) => setContractor(e.target.value)} required placeholder="Mis. Swakelola UPT / CV Jaya Aspal" />
            </Field>
            <Field skin={skin} label="Pengawas" htmlFor={id('sup')}>
              <input id={id('sup')} className={inputClass} value={supervisor} onChange={(e) => setSupervisor(e.target.value)} placeholder="Nama pengawas lapangan" />
            </Field>
            <Field skin={skin} label="Nilai pekerjaan (Rp)" htmlFor={id('val')}>
              <input id={id('val')} inputMode="numeric" className={inputClass} value={contractValue} onChange={(e) => setContractValue(e.target.value)} placeholder="Kosongkan jika swakelola" />
            </Field>
            <Field skin={skin} label="Masa pemeliharaan (bulan)" htmlFor={id('mm')} hint="Sesuai kontrak; kosongkan bila tidak tahu.">
              <input id={id('mm')} type="number" min={0} max={120} inputMode="numeric" className={inputClass} value={maintenanceMonths} onChange={(e) => setMaintenanceMonths(e.target.value)} />
            </Field>
            <Field skin={skin} label="Target selesai" htmlFor={id('tgt')}>
              <input id={id('tgt')} type="date" className={inputClass} value={targetDate} min={inDays(0)} onChange={(e) => setTargetDate(e.target.value)} />
            </Field>
          </div>
          <Field skin={skin} label="Catatan pelaksana" htmlFor={id('con')} hint="Perintah kerja internal sistem — nomor SPK resmi tetap dari instansi.">
            <input id={id('con')} className={inputClass} value={contractorNote} onChange={(e) => setContractorNote(e.target.value)} placeholder="Mis. nomor SPK, volume, metode" />
          </Field>
        </>
      )}

      {action === 'TRANSFER_AUTHORITY' && (
        <>
          <p className={`text-[11px] ${skin.muted}`}>
            Saat ini: <b className="text-white">{caseData.authority?.name ?? 'belum ditentukan'}</b>
            {caseData.authority?.basis ? ` — ${caseData.authority.basis}` : ''}
          </p>
          <Field skin={skin} label="Alihkan ke instansi" htmlFor={id('agency')}>
            <select id={id('agency')} className={inputClass} value={agencyId} onChange={(e) => setAgencyId(e.target.value)} required>
              {agencies.map((a) => (
                <option key={a.id} value={a.id} className="bg-slate-900 text-white">
                  {a.name} · {a.level}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      {action === 'SET_PENDING' && (
        <>
          <p className={`text-[11px] ${skin.muted}`}>Alasan dan perkiraan tanggal tampil di halaman publik. Eskalasi berhenti sampai tanggal itu, lalu dihitung ulang dari tanggal tersebut.</p>
          <Field skin={skin} label="Alasan tertunda" htmlFor={id('pc')}>
            <select id={id('pc')} className={inputClass} value={pendingCode} onChange={(e) => setPendingCode(e.target.value as PendingCode)}>
              {PENDING_CODES.map((c) => <option key={c} value={c} className="bg-slate-900 text-white">{PENDING_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field skin={skin} label="Perkiraan mulai ditangani" htmlFor={id('pu')}>
            <input id={id('pu')} type="date" className={inputClass} value={pendingUntil} min={inDays(1)} max={inDays(365)} onChange={(e) => setPendingUntil(e.target.value)} required />
          </Field>
        </>
      )}

      {action === 'MARK_HAZARD' && (
        <>
          <p className={`text-[11px] ${skin.muted}`}>UU 22/2009 Ps. 24 ayat 2: selama belum diperbaiki, kerusakan wajib diberi tanda atau rambu. Rambu tampil di peta publik.</p>
          <Field skin={skin} label="Foto rambu terpasang" htmlFor={id('hz')}>
            <input id={id('hz')} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className={inputClass} onChange={(e) => pickEvidence(e.target.files?.[0])} />
          </Field>
          {evidenceError && <p role="alert" className="text-xs text-red-300">{evidenceError}</p>}
          {evidence && <img src={evidence} alt="Pratinjau foto rambu" className="w-28 h-20 object-cover rounded-lg border border-line" />}
          <Field skin={skin} label="Jenis rambu / catatan" htmlFor={id('hzn')}>
            <input id={id('hzn')} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Mis. kerucut + garis polisi 10 m" />
          </Field>
        </>
      )}

      {needsReason && (
        <Field skin={skin} label="Alasan (tercatat di audit trail)" htmlFor={id('reason')}>
          <textarea id={id('reason')} className={inputClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="Tulis alasan keputusan untuk riwayat audit" />
        </Field>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
        <button type="button" onClick={onCancel} disabled={busy} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${skin.ghost} ${FOCUS}`}>
          Batal
        </button>
        <button type="submit" disabled={busy} aria-busy={busy} className={`px-3 py-1.5 rounded-lg text-xs font-bold bg-[#FFD60A] text-black hover:bg-[#FFD60A]/90 disabled:opacity-60 transition-colors ${FOCUS}`}>
          {busy ? 'Menyimpan…' : 'Simpan & Kirim'}
        </button>
      </div>
    </form>
  );
};

export const ReportWorkflowPanel: React.FC<ReportWorkflowPanelProps> = ({
  view,
  mode,
  engineers,
  onRun,
  onShowOnMap,
  compact,
  tone = 'dark',
  initialAction = null,
  onClose,
  isModal = false
}) => {
  const skin = SKIN[tone];
  const [openAction, setOpenAction] = useState<WorkflowAction | null>(
    initialAction && view?.availableActions.includes(initialAction) ? initialAction : null
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<{ url: string; title: string } | null>(null);
  const [mobileTab, setMobileTab] = useState<'A' | 'B' | 'C'>('A');

  const engineerName = useMemo(() => new Map(engineers.map((e) => [e.id, e.name])), [engineers]);

  // Handle escape key to close modal or lightbox
  useEffect(() => {
    if (!isModal && !lightboxPhoto) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxPhoto) {
          setLightboxPhoto(null);
        } else if (onClose) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isModal, lightboxPhoto, onClose]);

  if (!view) {
    return (
      <div className={`p-6 text-center text-xs ${skin.muted}`}>
        Status alur kerja belum dimuat atau laporan tidak ditemukan.
      </div>
    );
  }

  const isStaff = view.audience === 'STAFF';
  const staffCase = isStaff ? (view.case as ReportCase) : null;
  const publicCase = !isStaff ? (view.case as PublicReportView) : null;
  const state = view.case.state;

  const run = async (command: WorkflowCommand) => {
    setBusy(true);
    setMessage(null);
    const outcome = await onRun(command);
    setBusy(false);
    if (outcome.ok === false) {
      const failure = outcome as { error: string; code: string };
      setMessage({
        tone: 'error',
        text: failure.code === 'VERSION_CONFLICT'
          ? 'Laporan baru saja diubah orang lain; data sudah dimuat ulang. Periksa lalu ulangi.'
          : failure.error
      });
      return;
    }
    setOpenAction(null);
    setMessage({
      tone: 'ok',
      text: `${ACTION_LABEL[command.action as WorkflowAction]} — tersimpan dan terkirim ke peran berikutnya.`
    });
  };

  const assignmentOverdue =
    staffCase?.assignment &&
    state === 'FIELD_INSPECTION_REQUESTED' &&
    Date.parse(staffCase.assignment.dueAt) < Date.now();

  // Primary action button in footer
  const primaryActions = view.availableActions.filter((a) => a !== 'COMPLETE_WORK_ORDER');

  // RENDER COLUMNS
  const renderColumnA = () => (
    <div className="space-y-4">
      {/* 1. Header Section Laporan & Status */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-2">
        <div className="flex items-center justify-between pb-1 border-b border-white/5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#A6A8AE]">
            Ringkasan Laporan
          </span>
          <StateBadge state={state} tone={tone} />
        </div>
        <InfoRow label="ID Laporan" value={view.case.id} mono valueClass="text-[#FFD60A] font-bold" />
        <InfoRow label="Waktu Masuk" value={fmt(view.case.report.createdAt)} />
        <InfoRow
          label="Sumber Data"
          value={
            staffCase?.dataStatus === 'SYNTHETIC'
              ? 'Laporan Warga (Synthetic)'
              : 'Laporan Warga (R.U / R.E)'
          }
          border={false}
        />
      </div>

      {/* 2. Lokasi & Koordinat */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#A6A8AE]">Lokasi Ruas</p>
            <p className="text-xs font-semibold text-slate-100 mt-0.5">{view.case.report.segmentName}</p>
          </div>
          {onShowOnMap && (
            <button
              type="button"
              onClick={onShowOnMap}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#FFD60A]/10 border border-[#FFD60A]/30 text-[#FFD60A] hover:bg-[#FFD60A]/20 text-[11px] font-semibold transition-colors flex-shrink-0"
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>Lihat di peta</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 pt-1 border-t border-white/5 text-[11px]">
          <span className="text-[#A6A8AE]">Koordinat:</span>
          <span className="font-mono text-slate-200 bg-white/5 px-2 py-0.5 rounded border border-white/10 select-all">
            {view.case.report.coordinates[0].toFixed(5)}, {view.case.report.coordinates[1].toFixed(5)}
          </span>
        </div>
      </div>

      {/* 3. Foto Utama Bukti Warga */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#A6A8AE]">Foto Bukti Laporan</p>
          {view.case.report.photoUrl && (
            <button
              type="button"
              onClick={() =>
                setLightboxPhoto({
                  url: view.case.report.photoUrl!,
                  title: `Foto Bukti Laporan — ${view.case.id}`
                })
              }
              className="text-[11px] text-[#FFD60A] hover:underline inline-flex items-center gap-1 font-medium"
            >
              <Maximize2 className="w-3 h-3" /> Perbesar Foto
            </button>
          )}
        </div>
        {view.case.report.photoUrl ? (
          <div
            className="relative group rounded-lg overflow-hidden border border-white/10 bg-black/40 aspect-[4/3] flex items-center justify-center cursor-pointer"
            onClick={() =>
              setLightboxPhoto({
                url: view.case.report.photoUrl!,
                title: `Foto Bukti Laporan — ${view.case.id}`
              })
            }
          >
            <img
              src={view.case.report.photoUrl}
              alt={`Foto laporan warga ${view.case.id}`}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/75 border border-white/20 text-xs text-white shadow-lg">
                <Maximize2 className="w-3.5 h-3.5" /> Klik untuk perbesar
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-xs text-slate-400">
            Tidak ada foto bukti dari pelapor.
          </div>
        )}
      </div>

      {/* 4. Rincian Kerusakan & Deskripsi Pelapor */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#A6A8AE] pb-1 border-b border-white/5">
          Deskripsi &amp; Dimensi Estimasi
        </p>
        <InfoRow label="Jenis Kerusakan" value={view.case.report.damageTypeLabel} />
        <InfoRow
          label="Estimasi Dimensi"
          value={`${view.case.report.estimatedDepthCm} cm / ${view.case.report.estimatedAreaM2} m²`}
          mono
        />
        {view.case.report.description && (
          <div className="pt-2">
            <span className="text-[11px] text-[#A6A8AE]">Catatan Warga:</span>
            <p className="mt-1 text-xs text-slate-300 italic bg-black/25 p-2.5 rounded-lg border border-white/5">
              “{view.case.report.description}”
            </p>
          </div>
        )}
      </div>
    </div>
  );

  const renderColumnB = () => (
    <div className="space-y-4">
      {/* 1. Penyaringan Otomatis (AI / CV) */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-2">
        <div className="flex items-center justify-between pb-1 border-b border-white/5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#A6A8AE]">
            Penyaringan Otomatis (AI / CV)
          </p>
          {staffCase?.screening && (
            <DataTag
              skin={skin}
              tone={staffCase.screening.modelStatus === 'REAL' ? 'observed' : 'demo'}
            >
              {staffCase.screening.modelStatus}
            </DataTag>
          )}
        </div>

        {staffCase?.screening ? (
          <div className="space-y-1.5">
            <InfoRow
              label="Kelas Terdeteksi"
              value={staffCase.screening.detectedClass ?? 'Tidak ada deteksi model'}
              mono
            />
            <InfoRow
              label="Kepercayaan (Confidence)"
              value={
                staffCase.screening.confidence !== null
                  ? `${(staffCase.screening.confidence * 100).toFixed(0)}% (${staffCase.screening.modelStatus})`
                  : 'N/A'
              }
            />
            {staffCase.screening.reasons.length > 0 && (
              <div className="pt-1.5 border-t border-white/5">
                <p className="text-[11px] text-[#A6A8AE] font-medium mb-1">Catatan Evaluasi Sistem:</p>
                <ul className="text-xs text-slate-300 space-y-1 list-disc pl-4">
                  {staffCase.screening.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400 py-1">
            Penyaringan otomatis model komputer visi belum dijalankan.
          </p>
        )}
      </div>

      {/* 2. Hasil Inspeksi Lapangan (F.E) */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-2">
        <div className="flex items-center justify-between pb-1 border-b border-white/5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#A6A8AE]">
            Hasil Inspeksi Lapangan (F.E)
          </p>
          {staffCase?.inspection && <DataTag skin={skin} tone="observed">OBSERVED</DataTag>}
        </div>

        {staffCase?.inspection ? (
          <div className="space-y-1.5">
            <InfoRow
              label="Hasil Konfirmasi"
              value={
                staffCase.inspection.verdict === 'CONFIRMED'
                  ? 'Kerusakan Terkonfirmasi'
                  : 'Tidak Terkonfirmasi'
              }
              valueClass={
                staffCase.inspection.verdict === 'CONFIRMED'
                  ? 'text-emerald-400 font-semibold'
                  : 'text-rose-400 font-semibold'
              }
            />
            <InfoRow
              label="Tingkat Keparahan"
              value={staffCase.inspection.severity}
              valueClass="text-[#FFD60A] font-bold"
            />
            <InfoRow
              label="Dimensi Terukur"
              value={`${staffCase.inspection.measuredDepthCm !== null ? `${staffCase.inspection.measuredDepthCm} cm` : '-'} / ${staffCase.inspection.measuredAreaM2 !== null ? `${staffCase.inspection.measuredAreaM2} m²` : '-'}`}
              mono
            />
            <InfoRow
              label="Klasifikasi CV"
              value={
                staffCase.inspection.cvReview.accepted
                  ? 'Diterima sesuai laporan'
                  : `Dikoreksi: ${staffCase.inspection.cvReview.correctedClass}`
              }
            />
            {staffCase.inspection.notes && (
              <div className="pt-2 border-t border-white/5">
                <span className="text-[11px] text-[#A6A8AE]">Catatan Hasil Inspeksi:</span>
                <p className="mt-1 text-xs text-slate-300 italic bg-black/25 p-2 rounded border border-white/5">
                  “{staffCase.inspection.notes}”
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400 py-1">
            Belum ada hasil inspeksi lapangan dari Field Engineer.
          </p>
        )}
      </div>

      {/* 3. Rekomendasi Penanganan Teknis (F.E) */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#A6A8AE] pb-1 border-b border-white/5">
          Rekomendasi Penanganan (F.E)
        </p>

        {staffCase?.recommendation ? (
          <div className="space-y-1.5">
            <InfoRow label="Rencana Tindakan" value={staffCase.recommendation.treatment} />
            <InfoRow
              label="Tingkat Urgensi"
              value={staffCase.recommendation.urgency}
              valueClass="text-amber-400 font-semibold"
            />
            {staffCase.recommendation.rationale && (
              <div className="pt-1.5 border-t border-white/5">
                <span className="text-[11px] text-[#A6A8AE]">Alasan Teknis:</span>
                <p className="mt-0.5 text-xs text-slate-300">{staffCase.recommendation.rationale}</p>
              </div>
            )}
            {staffCase.recommendation.assessment && (
              <div className="pt-2 border-t border-white/5 space-y-1.5">
                <p className="text-[11px] text-[#A6A8AE] font-semibold uppercase tracking-wider">
                  Penilaian Ruas PINN
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-white/[0.03] p-2 rounded-lg border border-white/5">
                    <span className="text-[10px] text-[#A6A8AE] block">Risiko</span>
                    <span className="font-bold text-amber-400">
                      {staffCase.recommendation.assessment.risk}
                    </span>
                  </div>
                  <div className="bg-white/[0.03] p-2 rounded-lg border border-white/5">
                    <span className="text-[10px] text-[#A6A8AE] block">Skor Kondisi</span>
                    <span className="font-bold text-slate-200">
                      {staffCase.recommendation.assessment.conditionScorePrototype}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 pt-1 text-[10.5px]">
                  <DataTag skin={skin} tone="demo">{staffCase.recommendation.assessment.engine}</DataTag>
                  <DataTag skin={skin}>{staffCase.recommendation.assessment.validationStatus}</DataTag>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400 py-1">
            Belum ada rekomendasi penanganan teknis dari F.E.
          </p>
        )}
      </div>
    </div>
  );

  const renderColumnC = () => (
    <div className="h-full flex flex-col space-y-4">
      {/* 1. Status Penanganan & Penugasan (Bagian Atas) */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-2 flex-shrink-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#A6A8AE] pb-1 border-b border-white/5">
          Status Penanganan &amp; Penugasan
        </p>

        {staffCase?.assignment ? (
          <div className="space-y-1.5">
            <InfoRow
              label="Petugas F.E"
              value={
                engineerName.get(staffCase.assignment.engineerId) ??
                actorName(staffCase.assignment.engineerId)
              }
              valueClass="text-slate-100 font-semibold"
            />
            <InfoRow
              label="Batas Waktu"
              value={
                <span>
                  {fmt(staffCase.assignment.dueAt)}
                  {assignmentOverdue && (
                    <span className="ml-1.5 text-rose-400 font-bold">(Lewat Batas)</span>
                  )}
                </span>
              }
              mono
            />
            <InfoRow
              label="Ditugaskan Oleh"
              value={actorName(staffCase.assignment.assignedBy)}
              border={!staffCase.assignment.instructions}
            />
            {staffCase.assignment.instructions && (
              <div className="pt-1 text-xs">
                <span className="text-[11px] text-[#A6A8AE]">Instruksi Kerja:</span>
                <p className="text-slate-300 italic mt-0.5">{staffCase.assignment.instructions}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400 py-1">
            Belum ada penugasan petugas untuk laporan ini.
          </p>
        )}

        {/* SPK / Perintah Kerja */}
        {staffCase?.workOrder && (
          <div className="pt-2 border-t border-white/5 space-y-1">
            <InfoRow label="Perintah Kerja (SPK)" value={staffCase.workOrder.id} mono valueClass="text-[#FFD60A] font-semibold" />
            <InfoRow
              label="Status Pekerjaan"
              value={
                staffCase.workOrder.status === 'COMPLETED'
                  ? 'Selesai / Bukti Terkirim'
                  : 'Sedang Dikerjakan'
              }
              border={false}
            />
            {staffCase.workOrder.contractorNote && (
              <p className="text-[11px] text-slate-400 pt-1">Catatan: {staffCase.workOrder.contractorNote}</p>
            )}
          </div>
        )}

        {/* Verifikasi Mutu & Persetujuan M.O */}
        {((staffCase?.inspectionReviews ?? []).length > 0 || (staffCase?.approvals ?? []).length > 0) && (
          <div className="pt-2 border-t border-white/5 space-y-1.5">
            {(staffCase?.inspectionReviews ?? []).map((r) => (
              <div key={r.id} className="text-xs py-1 border-b border-white/5 last:border-0">
                <div className="flex items-center justify-between">
                  <span className="text-[#A6A8AE]">Verifikasi Inspeksi</span>
                  <span className={`font-semibold ${r.decision === 'VERIFIED' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {r.decision === 'VERIFIED' ? 'Diverifikasi' : 'Inspeksi Ulang'}
                  </span>
                </div>
                <p className="text-[10.5px] text-slate-300 mt-0.5">
                  Oleh {actorName(r.decidedBy)} · {fmt(r.decidedAt)} {r.reason && `— “${r.reason}”`}
                </p>
              </div>
            ))}
            {(staffCase?.approvals ?? []).map((a) => (
              <div key={a.id} className="text-xs py-1 border-b border-white/5 last:border-0">
                <div className="flex items-center justify-between">
                  <span className="text-[#A6A8AE]">Persetujuan Penanganan</span>
                  <span className={`font-semibold ${a.decision === 'APPROVED' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {a.decision === 'APPROVED' ? 'Disetujui' : 'Dikembalikan'}
                  </span>
                </div>
                <p className="text-[10.5px] text-slate-300 mt-0.5">
                  Oleh {actorName(a.decidedBy)} · {fmt(a.decidedAt)} {a.reason && `— “${a.reason}”`}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. Bukti Pekerjaan / Inspeksi (Foto Lapangan & Hasil Perbaikan) */}
      {(staffCase?.inspection?.evidencePhotoUrl || staffCase?.workOrder?.completionPhotoUrl) && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-2 flex-shrink-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#A6A8AE] pb-1 border-b border-white/5">
            Bukti Pekerjaan &amp; Inspeksi Lapangan
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {staffCase?.inspection?.evidencePhotoUrl && (
              <div
                className="relative group rounded-lg overflow-hidden border border-white/10 bg-black/40 aspect-[4/3] cursor-pointer"
                onClick={() =>
                  setLightboxPhoto({
                    url: staffCase.inspection!.evidencePhotoUrl!,
                    title: `Foto Bukti Inspeksi F.E — ${staffCase.id}`
                  })
                }
              >
                <img
                  src={staffCase.inspection.evidencePhotoUrl}
                  alt="Foto bukti F.E"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/75 text-[9.5px] text-slate-200">
                  Bukti F.E
                </span>
              </div>
            )}
            {staffCase?.workOrder?.completionPhotoUrl && (
              <div
                className="relative group rounded-lg overflow-hidden border border-white/10 bg-black/40 aspect-[4/3] cursor-pointer"
                onClick={() =>
                  setLightboxPhoto({
                    url: staffCase.workOrder!.completionPhotoUrl!,
                    title: `Foto Hasil Perbaikan (After) — ${staffCase.id}`
                  })
                }
              >
                <img
                  src={staffCase.workOrder.completionPhotoUrl}
                  alt="Foto perbaikan"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/30 text-[9.5px] text-emerald-300">
                  Hasil Perbaikan
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Inline Action Form jika dibuka */}
      {openAction && staffCase && (
        <div className="flex-shrink-0">
          <ActionForm
            action={openAction}
            engineers={engineers}
            caseData={staffCase}
            busy={busy}
            skin={skin}
            onSubmit={run}
            onCancel={() => setOpenAction(null)}
          />
        </div>
      )}

      {/* 4. Riwayat Tindakan (Timeline Vertikal Ringkas dengan Scroll Internal) */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 flex-1 min-h-[200px] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/5 flex-shrink-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#A6A8AE] flex items-center gap-1.5">
            <History className="w-3.5 h-3.5 text-[#FFD60A]" />
            <span>Riwayat Tindakan ({staffCase ? staffCase.history.length : (publicCase?.timeline?.length ?? 0)})</span>
          </p>
        </div>

        {/* Scroll internal riwayat */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-3">
          {(staffCase
            ? [...staffCase.history].reverse().map((h) => ({
                key: h.id,
                at: h.at,
                state: h.to,
                action: h.action,
                actor: h.actor.role === 'SYSTEM' ? 'Sistem' : actorName(h.actor.id),
                reason: h.reason
              }))
            : [...(publicCase?.timeline ?? [])].reverse().map((t, i) => ({
                key: `${t.at}-${i}`,
                at: t.at,
                state: t.state,
                action: null,
                actor: 'Sistem',
                reason: t.note
              }))
          ).map((entry) => (
            <div key={entry.key} className="relative pl-3.5 border-l border-white/15 text-xs pb-1">
              <span className="absolute -left-[4.5px] top-1 w-2 h-2 rounded-full bg-[#FFD60A] ring-2 ring-[#12141A]" />
              <div className="flex items-center justify-between gap-1.5">
                <span className="font-mono text-[10.5px] text-[#A6A8AE]">{fmt(entry.at)}</span>
                <StateBadge state={entry.state} tone={tone} />
              </div>
              <p className="mt-1 font-semibold text-slate-100">
                {entry.action ? ACTION_LABEL[entry.action] : ''}{' '}
                <span className="text-[#A6A8AE] font-normal">· {entry.actor}</span>
              </p>
              {entry.reason && (
                <p className="text-slate-400 mt-0.5 text-[11px] italic">“{entry.reason}”</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // MODAL WRAPPER OR EMBEDDED CONTAINER
  const content = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 1. UNIFIED SINGLE HEADER */}
      <header className="flex items-center justify-between gap-2 border-b border-line-subtle px-4 py-3 bg-panel flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-100 whitespace-nowrap shrink-0">
            DETAIL LAPORAN
          </h2>
          <span className="text-[#A6A8AE] shrink-0">·</span>
          <span className="font-mono text-xs font-semibold text-[#FFD60A] bg-[#FFD60A]/10 px-2 py-0.5 rounded border border-[#FFD60A]/20 select-all truncate max-w-[130px] sm:max-w-[180px]">
            {view.case.id}
          </span>
          {staffCase && staffCase.dataStatus === 'SYNTHETIC' && (
            <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide border border-amber-500/30 text-amber-300 bg-amber-500/10 shrink-0">
              SYNTHETIC
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <StateBadge state={state} tone={tone} />
          {isModal && onClose && (
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg p-1.5 text-[#A6A8AE] hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Tutup Dialog"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      {/* TAB SWITCHER: Always visible in compact/panel mode on all viewports */}
      <div
        className={`flex items-center border-b border-line-subtle bg-panel px-3 py-2 gap-1.5 flex-shrink-0 sticky top-0 z-10 ${
          isModal && !compact ? 'lg:hidden' : ''
        }`}
      >
        <button
          type="button"
          onClick={() => setMobileTab('A')}
          className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors text-center truncate ${
            mobileTab === 'A'
              ? 'bg-[#FFD60A] text-black font-bold shadow-sm'
              : 'text-[#A6A8AE] hover:text-slate-100 hover:bg-white/5'
          }`}
        >
          A. Laporan &amp; Bukti
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('B')}
          className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors text-center truncate ${
            mobileTab === 'B'
              ? 'bg-[#FFD60A] text-black font-bold shadow-sm'
              : 'text-[#A6A8AE] hover:text-slate-100 hover:bg-white/5'
          }`}
        >
          B. Analisis
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('C')}
          className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors text-center truncate ${
            mobileTab === 'C'
              ? 'bg-[#FFD60A] text-black font-bold shadow-sm'
              : 'text-[#A6A8AE] hover:text-slate-100 hover:bg-white/5'
          }`}
        >
          C. Tindakan ({staffCase ? staffCase.history.length : (publicCase?.timeline?.length ?? 0)})
        </button>
      </div>

      {/* 2. MASTER BODY CONTENT */}
      <div className="flex-1 min-h-0 bg-workspace">
        {isModal && !compact ? (
          <>
            {/* WIDE MODAL DESKTOP: 3 COLUMNS SIDE-BY-SIDE */}
            <div className="hidden lg:grid h-full grid-cols-[1.05fr_0.95fr_1.1fr] divide-x divide-line-subtle min-h-0">
              <div className="min-h-0 overflow-y-auto custom-scrollbar p-5">
                {renderColumnA()}
              </div>
              <div className="min-h-0 overflow-y-auto custom-scrollbar p-5">
                {renderColumnB()}
              </div>
              <div className="min-h-0 overflow-y-auto custom-scrollbar p-5">
                {renderColumnC()}
              </div>
            </div>

            {/* WIDE MODAL MOBILE: ACTIVE TAB CONTENT */}
            <div className="lg:hidden h-full overflow-y-auto custom-scrollbar p-4">
              {mobileTab === 'A' && renderColumnA()}
              {mobileTab === 'B' && renderColumnB()}
              {mobileTab === 'C' && renderColumnC()}
            </div>
          </>
        ) : (
          /* PANEL / COMPACT: UNIFIED SINGLE-COLUMN TABBED VIEW ON ALL VIEWPORTS */
          <div className="p-3.5 sm:p-4 space-y-3">
            {mobileTab === 'A' && renderColumnA()}
            {mobileTab === 'B' && renderColumnB()}
            {mobileTab === 'C' && renderColumnC()}
          </div>
        )}
      </div>

      {/* 3. UNIFIED SINGLE FOOTER */}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle px-5 py-3.5 bg-panel flex-shrink-0">
        <div className="flex items-center gap-3">
          {isModal && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 hover:text-white transition-colors"
            >
              Tutup
            </button>
          )}
          {message && (
            <span
              role={message.tone === 'error' ? 'alert' : 'status'}
              className={`text-xs px-2.5 py-1 rounded-md border ${
                message.tone === 'error'
                  ? 'text-rose-300 bg-rose-500/10 border-rose-500/30'
                  : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
              }`}
            >
              {message.text}
            </span>
          )}
        </div>

        {/* Action buttons corresponding to workflow status and role */}
        <div className="flex flex-wrap items-center gap-2">
          {primaryActions.map((action) => (
            <button
              key={action}
              type="button"
              disabled={busy}
              onClick={() => {
                setMessage(null);
                setMobileTab('C');
                setOpenAction(openAction === action ? null : action);
              }}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm ${
                openAction === action
                  ? 'bg-amber-400 text-black border border-amber-300 ring-2 ring-amber-400/30'
                  : 'bg-[#FFD60A] text-black hover:bg-[#FFD60A]/90 active:scale-95'
              }`}
            >
              {ACTION_LABEL[action]}
            </button>
          ))}
          {view.availableActions.includes('COMPLETE_WORK_ORDER') && (
            <span className="text-[11px] text-[#A6A8AE] italic">
              Kirim bukti selesai lewat tombol “Sudah Selesai” di kartu tugas.
            </span>
          )}
        </div>
      </footer>

      {/* LIGHTBOX PHOTO VIEWER */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md animate-fadeIn"
          onClick={() => setLightboxPhoto(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between w-full mb-3 text-white">
              <span className="text-sm font-semibold">{lightboxPhoto.title}</span>
              <button
                type="button"
                onClick={() => setLightboxPhoto(null)}
                className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label="Tutup Pratinjau Foto"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={lightboxPhoto.url}
              alt={lightboxPhoto.title}
              className="max-w-full max-h-[80vh] object-contain rounded-xl border border-white/20 shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );

  // Return either modal wrapper or embedded section
  if (isModal) {
    return (
      <div
        className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/80 p-2 sm:p-4 md:p-6 backdrop-blur-sm animate-fadeIn"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Detail Laporan ${view.case.id}`}
          className="w-[95vw] max-w-[1400px] h-[88vh] max-h-[900px] min-h-[580px] rounded-panel border border-line-subtle bg-panel text-ink shadow-[0_24px_64px_rgba(0,0,0,0.85)] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {content}
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label="Status alur kerja laporan"
      className={`rounded-2xl border ${skin.section} overflow-hidden shadow-xl`}
    >
      {content}
    </section>
  );
};
