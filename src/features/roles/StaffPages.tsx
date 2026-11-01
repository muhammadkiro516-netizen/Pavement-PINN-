/**
 * Staff screens. One case screen shows the record; the action panel depends on role and state.
 * The server decides every action: a button here only asks, and a refusal shows its SoD rule.
 */
import { useState, type ReactNode } from 'react';
import { ClipboardCheck, FileText, Link2, ShieldCheck } from 'lucide-react';
import { V5_ROLE_NAMES, V5_STATE_LABELS, type V5Case, type V5Role, type V5State } from '../../domain/v5/model';
import { ROAD_STATUS_WORD } from '../road-owner/RoadOwnerCard';
import { v5, v6 } from './api';
import { useV5 } from './context';
import { AccessBadge, type Badge } from './TeamPanel';
import { panelDuty, type V6Role } from '../../domain/v6/roles';
import { CaseAiPanel } from './CaseAi';
import { CompareOptions } from './CostModule';
import { Capture, DetectionView, apiUrl, type EvidenceView } from './Capture';
import { FollowUps } from './TrackPages';
import { Card, Chip, Confidence, ErrorNote, Ladder, RolePavi, TechDetails, dateOnly, roleWord, rupiah, useAction, useLoad, when, type ChipKind, type LadderView } from './ui';

const stateWord = (c: { state: V5Case['state']; stateLabel?: string }) => (c.state ? V5_STATE_LABELS[c.state as V5State].id : c.stateLabel ?? '');
const REPAIR_WORD = (r: string) => REPAIR_LABEL[r] ?? r;
const CATEGORY_WORD: Record<string, string> = { TEMPORARY: 'sementara', PERMANENT: 'permanen' };
const URGENCY_WORD: Record<string, string> = { ROUTINE: 'biasa', PRIORITY: 'prioritas', URGENT: 'mendesak' };
const VERDICT_WORD: Record<string, string> = { CONFIRMED: 'Benar, sesuai laporan', NOT_FOUND: 'Tidak ada kerusakan', DIFFERENT_CLASS: 'Jenisnya berbeda' };
const DAMAGE_WORD: Record<string, string> = { POTHOLE: 'Lubang', ALLIGATOR: 'Retak buaya', LONG_CRACK: 'Retak memanjang', TRANS_CRACK: 'Retak melintang', RUTTING_DEPRESSION: 'Amblas / alur', EDGE_BREAK: 'Tepi rusak', RAVELLING: 'Permukaan terkelupas', PATCH_FAILURE: 'Tambalan rusak', SEVERE_BREAKUP: 'Rusak berat' };
const REASON_WORD: Record<string, string> = { 'Hazard marked': 'Ada bahaya', 'Pothole': 'Lubang', 'Coordinator to confirm the owner': 'Pemilik jalan perlu dipastikan', 'Large damage, as reported': 'Kerusakan besar', 'Medium damage, as reported': 'Kerusakan sedang' };
const reasonWord = (t: string) => REASON_WORD[t] ?? t.replace(/^Waiting (\d+) days?$/, 'Menunggu $1 hari').replace(/^(\d+) witness(es)?$/, '$1 saksi');
const DAMAGE_OPTIONS = Object.keys(DAMAGE_WORD);

export interface StaffCase extends V5Case {
  stateLabel: string;
  ladder: LadderView;
  priority: { score: number; reasons: { text: string; points: number }[] };
}

const QUEUES: Partial<Record<V5Role, { title: string; states: V5State[]; empty: string }>> = {
  COORDINATOR: { title: 'Antrian prioritas', states: ['TRIAGE', 'ACCEPTED', 'INSPECTED', 'INSPECTION_VERIFIED', 'PLAN_APPROVED', 'MONITORING', 'REOPENED'], empty: 'Tidak ada kasus yang menunggu Anda.' },
  FIELD_INSPECTOR: { title: 'Inspeksi saya', states: ['INSPECTION_ASSIGNED', 'INSPECTION_VERIFIED', 'MONITORING', 'REOPENED'], empty: 'Belum ada inspeksi untuk Anda.' },
  APPROVER: { title: 'Menunggu persetujuan', states: ['PLAN_PROPOSED', 'WORK_VERIFIED'], empty: 'Tidak ada rencana yang menunggu.' },
  REPAIR_CREW: { title: 'Tugas perbaikan', states: ['WORK_ORDERED', 'IN_PROGRESS'], empty: 'Belum ada tugas perbaikan untuk Anda.' },
  SUPERVISOR: { title: 'Perbaikan yang perlu dicek', states: ['WORK_SUBMITTED'], empty: 'Tidak ada perbaikan yang menunggu.' }
};

const NEXT_STEP: Partial<Record<V5State, string>> = {
  TRIAGE: 'Terima dan tugaskan petugas',
  ACCEPTED: 'Tugaskan petugas',
  INSPECTION_ASSIGNED: 'Ukur di lokasi',
  INSPECTED: 'Periksa hasil inspeksi',
  INSPECTION_VERIFIED: 'Hitung umur dan biaya, lalu usulkan rencana',
  PLAN_PROPOSED: 'Setujui atau kembalikan rencana',
  PLAN_APPROVED: 'Terbitkan perintah kerja',
  WORK_ORDERED: 'Mulai perbaikan',
  IN_PROGRESS: 'Lengkapi bukti perbaikan',
  WORK_SUBMITTED: 'Periksa bukti',
  WORK_VERIFIED: 'Terima perbaikan',
  MONITORING: 'Pemeriksaan lanjutan berjalan',
  REOPENED: 'Tugaskan inspeksi baru'
};

export type CaseScope = 'ACTION' | 'INBOX' | 'FIELD' | 'WORK' | 'ALL';

const WORK_STATES: V5State[] = ['PLAN_PROPOSED', 'PLAN_APPROVED', 'WORK_ORDERED', 'IN_PROGRESS', 'WORK_SUBMITTED', 'WORK_VERIFIED'];

/** Which cases a list shows for this person (§2.4): the OM sees all, the FE what is theirs. */
function inList(c: StaffCase, scope: CaseScope, v6Role: V6Role | null, me: string | null): boolean {
  const state = c.state as V5State;
  const mineInspect = c.inspection?.inspectorAccountId === me;
  const mineVerify = c.workOrder?.supervisorAccountId === me;
  if (scope === 'ALL' || v6Role === 'CONTRACTOR') return true;
  if (scope === 'WORK') {
    if (!WORK_STATES.includes(state)) return false;
    return v6Role !== 'FE' || mineInspect || mineVerify;
  }
  if (scope === 'FIELD') return mineInspect && ['INSPECTION_ASSIGNED', 'INSPECTION_VERIFIED', 'REOPENED', 'MONITORING'].includes(state);
  if (scope === 'INBOX') return v6Role !== 'FE' ? V5_STATE_LABELS[state]?.open ?? false : mineInspect || mineVerify;
  if (v6Role === 'AUDITOR') return true;
  if (v6Role === 'OM') return [...QUEUES.COORDINATOR!.states, ...QUEUES.APPROVER!.states].includes(state);
  return (mineInspect && ['INSPECTION_ASSIGNED', 'INSPECTION_VERIFIED', 'MONITORING', 'REOPENED'].includes(state)) || (mineVerify && state === 'WORK_SUBMITTED');
}

export function CaseList({ title, scope }: { title: string; scope: CaseScope }) {
  const { role, v6Role, accountId, go } = useV5();
  const { data, error } = useLoad(() => v5<StaffCase[]>('/cases'), []);
  const rows = (data ?? []).filter((c) => inList(c, scope, v6Role, accountId));
  return (
    <Card title={title} testId="v5-queue">
      {error && <p>{error.message}</p>}
      {!data && !error && <p>Memuat…</p>}
      {data && rows.length === 0 && <div className="v5-empty"><RolePavi role={role} mood="sleep" /><p>Belum ada yang perlu dikerjakan di sini.</p></div>}
      <ul className="v5-list">
        {rows.map((c) => (
          <li key={c.id} data-code={c.publicCode}>
            <button type="button" onClick={() => go(`/kerja/${c.id}`)} data-testid={`v5-open-${c.publicCode}`}>
              <span className="v5-row-between"><strong>{c.publicCode}</strong></span>
              <span>{stateWord(c)} · berikutnya: {NEXT_STEP[c.state as V5State] ?? 'tidak ada'}</span>
              <span className="v5-caption">{c.routing?.officeName ?? 'Instansi belum ditentukan'}{c.routing && <> <Confidence level={c.routing.confidence} /></>}{c.routing?.confidence === 'LOW' && !c.ownershipConfirmed && (c.state === 'TRIAGE' || c.state === 'ACCEPTED') && <span className="v5-warn" data-testid="v6-confirm-owner-label"> · Konfirmasi kepemilikan</span>}</span>
              {v6Role === 'OM' && c.priority.reasons.length > 0 && <span className="v5-reasons" data-testid="v5-priority-reasons">Kenapa didahulukan: {c.priority.reasons.map((r) => reasonWord(r.text)).join(' · ')}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function CaseScreen({ id }: { id: string }) {
  const { role, go } = useV5();
  const { data: c, error, reload, setData } = useLoad(() => v5<StaffCase>(`/cases/${id}`), [id]);
  if (error) return <Card title="Kasus ini tidak bisa dibuka"><p>{error.message}</p></Card>;
  if (!c) return <Card><p>Memuat…</p></Card>;
  return (
    <>
      <button type="button" className="v5-link" onClick={() => go('/kerja/')}>Kembali</button>
      <Card testId="v5-case-head">
        <div className="v5-row-between">
          <div>
            <p className="v5-eyebrow">Kasus</p>
            <p className="v5-code">{c.publicCode}</p>
          </div>
          <RolePavi role={role} mood="scan" />
        </div>
        <p className="v5-state" data-testid="v5-state-label">{stateWord(c)}</p>
                <button type="button" className="v5-link" onClick={() => go(`/pantau/${c.publicCode}`)}>Lihat halaman publik</button>
      </Card>
      <ActionPanel c={c} onChange={(next) => { if (next) setData({ ...c, ...next }); reload(); }} />
      <CompareOptions c={c} />
      <CaseAiPanel caseId={c.id} />
      <CaseRecord c={c} />
    </>
  );
}

const EVENT_WORD: Record<string, string> = { 'case.submitted': 'Laporan warga', 'case.screening_started': 'Penyaringan dimulai', 'case.screened': 'Disaring dan diarahkan', 'case.accepted': 'Diterima instansi', 'case.transfer_requested': 'Pengalihan diminta', 'case.transfer_confirmed': 'Pengalihan dikonfirmasi', 'case.pending_set': 'Alasan menunggu', 'case.hazard_marked': 'Rambu dicatat', 'inspection.assigned': 'Petugas ditugaskan', 'inspection.submitted': 'Inspeksi selesai', 'inspection.verified': 'Inspeksi diperiksa', 'pinn.run': 'Umur dihitung', 'cost.estimated': 'Biaya dihitung', 'plan.proposed': 'Rencana diusulkan', 'plan.approved': 'Rencana disetujui', 'plan.returned': 'Rencana dikembalikan', 'work_order.issued': 'Perintah kerja', 'work.started': 'Perbaikan dimulai', 'work.stage_evidence': 'Foto tahap kerja', 'work.declared': 'Biaya dan volume dilaporkan', 'work.submitted': 'Bukti dikirim', 'work.rejected': 'Perlu diulang', 'work.verified': 'Diperiksa pengawas', 'work.accepted': 'Diterima, mulai dipantau', 'follow_up.recorded': 'Pemeriksaan lanjutan', 'follow_up.scheduled': 'Pemeriksaan dijadwalkan', 'flag.created': 'Catatan klarifikasi', 'response.added': 'Tanggapan', 'case.reopened': 'Dibuka kembali', 'case.closed': 'Ditutup', 'document.issued': 'Laporan diterbitkan' };
const eventWord = (t: string) => EVENT_WORD[t] ?? t;

function Num({ children, kind, title }: { children: ReactNode; kind: ChipKind; title?: string }) {
  return <span className="v5-num">{children} <Chip kind={kind} title={title} /></span>;
}

function CaseRecord({ c }: { c: StaffCase & { now?: string } }) {
  const i = c.inspection;
  const cost = c.costRun as CostView | null;
  const shots = c.evidence;
  return (
    <>
      {c.routing && (
        <Card title="Pemilik jalan" testId="v5-case-routing">
          <p><strong>{c.routing.officeName}</strong> · {c.routing.authorityName}</p>
          <p>{ROAD_STATUS_WORD[c.routing.roadStatus ?? 'UNKNOWN']}{c.routing.segmentName ? ` · ${c.routing.segmentName}` : ''} <Confidence level={c.routing.confidence} /></p>
          <TechDetails><p>{c.routing.basis}</p>{c.routing.note && <p>{c.routing.note}</p>}</TechDetails>
        </Card>
      )}
      <Card title="Lama menunggu"><Ladder ladder={c.ladder} /></Card>
      {i?.submittedAt && (
        <Card title="Hasil ukur" testId="v5-measurements">
          <dl className="v5-dl">
            <dt>Hasil</dt><dd>{VERDICT_WORD[i.verdict ?? ''] ?? i.verdict}, {DAMAGE_WORD[i.classConfirmed ?? ''] ?? i.classConfirmed}</dd>
            {i.lengthMm && <><dt>Ukuran</dt><dd><Num kind={i.areaStatus === 'MEASURED' ? 'MEASURED' : 'AI_ESTIMATE'} >{(i.lengthMm / 1000).toFixed(2)} × {((i.widthMm ?? 0) / 1000).toFixed(2)} m</Num></dd></>}
            {i.depthMmTyped && <><dt>Kedalaman</dt><dd><Num kind="MEASURED">{i.depthMmTyped} mm</Num></dd></>}
            <dt>Cek penggaris</dt><dd>Periksa fotonya dengan mata. AI belum bisa membaca penggaris.</dd>
          </dl>
        </Card>
      )}
      {c.pinnRun && <PinnCard run={c.pinnRun} />}
      {cost && <CostCard cost={cost} />}
      {c.plan && (
        <Card title="Rencana perbaikan" testId="v5-plan">
          <dl className="v5-dl">
            <dt>Perbaikan</dt><dd>{REPAIR_WORD(c.plan.repairType)}, {CATEGORY_WORD[c.plan.category]}</dd>
            <dt>Urgensi</dt><dd>{URGENCY_WORD[c.plan.urgency]}</dd>
            <dt>Volume</dt><dd><Num kind="COMPUTED">{(c.plan.areaCm2 / 10000).toFixed(2)} m² × {c.plan.thicknessMm} mm</Num></dd>
            <dt>Alasan</dt><dd>{c.plan.rationale}</dd>
            {c.plan.budgetSource && <><dt>Anggaran</dt><dd>{c.plan.budgetSource}</dd></>}
          </dl>
        </Card>
      )}
      {c.workOrder && (
        <Card title="Perintah kerja" testId="v5-work-order">
          <p>Catatan internal, bukan SPK. {c.workOrder.type === 'SWAKELOLA' ? 'Swakelola' : 'Kontrak'} · {CATEGORY_WORD[c.workOrder.category]}</p>
          <p>Target selesai {dateOnly(c.workOrder.targetDate)} <Chip kind="INPUT" /></p>
          {c.declared && <p>Biaya yang dilaporkan {c.declared.reportedSpendIdr ? rupiah(c.declared.reportedSpendIdr) : '–'} <Chip kind="INPUT" /></p>}
        </Card>
      )}
      {c.flags.length > 0 && (
        <Card title="Catatan yang perlu klarifikasi" testId="v5-flags">
          <ul>{c.flags.map((f) => <li key={f.id}>{f.text} {f.note && <em>({f.note})</em>}</li>)}</ul>
          <p className="v5-caption">Catatan ini tentang kasus, bukan tentang orang, dan bukan temuan audit.</p>
        </Card>
      )}
      {c.followUps.length > 0 && <Card title="Pemeriksaan lanjutan"><FollowUps items={c.followUps.map((f) => { const now = c.now ?? new Date().toISOString(); return { ...f, due: !f.result && !!f.dueAt && f.dueAt <= now, overdue: !f.result && !!f.dueAt && new Date(new Date(f.dueAt).getTime() + f.windowDays * 86_400_000).toISOString() < now }; })} /></Card>}
      {shots.length > 0 && (
        <Card title={`Foto bukti (${shots.length})`}>
          <div className="v5-strip">{shots.map((e) => <figure key={e.id}><img src={apiUrl(`/api/v5/evidence/${e.id}/image`)} alt={e.stage ?? e.kind} loading="lazy" /><figcaption>{e.stage ?? e.kind}</figcaption></figure>)}</div>
        </Card>
      )}
    </>
  );
}

export interface CostView {
  fairCostIdr: { low: number; mid: number; high: number } | null;
  label: string;
  basis: string;
  completeness: { excluded: string[] };
  inputs: { key: string; label: string; unit: string; status: ChipKind; source: string; value?: number; low?: number; mid?: number; high?: number }[];
  warnings: string[];
  lines: { id: string; item: string; idr: { low: number; mid: number; high: number } | null; status: ChipKind; sourceToFetch?: string }[];
  comparison: { reportedSpendIdr: number; diffPct: number; result: string; label_en: string; insideRange: boolean } | null;
  quantity: { areaCutM2: { mid: number }; depthRepairCm: number; tons: { mid: number }; qPay: { mid: number } };
}

export function CostCard({ cost }: { cost: CostView }) {
  const f = cost.fairCostIdr;
  return (
    <Card title="Biaya wajar" testId="v5-cost">
      {f ? <p className="v5-big" data-testid="v5-cost-range"><strong>{rupiah(f.low)} – {rupiah(f.high)}</strong> <Chip kind="ASSUMED" /><br /><span className="v5-caption">Nilai tengah {rupiah(f.mid)}</span></p> : <p className="v5-big">Belum bisa dihitung <Chip kind="TODO_VERIFY" /></p>}
      <p className="v5-caption">Perkiraan awal: harga resmi pemerintah belum lengkap, dan belum termasuk mobilisasi dan pengaturan lalu lintas.</p>
      <p>Luas potongan {cost.quantity.areaCutM2.mid} m², dalam {cost.quantity.depthRepairCm} cm <Chip kind="COMPUTED" /></p>
      {cost.comparison && (
        <p className={cost.comparison.result === 'NEEDS_CLARIFICATION' ? 'v5-warn' : 'v5-good'} data-testid="v5-cost-result">
          Dilaporkan {rupiah(cost.comparison.reportedSpendIdr)} <Chip kind="INPUT" />: selisih {cost.comparison.diffPct > 0 ? '+' : ''}{cost.comparison.diffPct}% <Chip kind="COMPUTED" />. <strong>{cost.comparison.result === 'NEEDS_CLARIFICATION' ? 'Perlu klarifikasi' : 'Masih dalam kisaran wajar'}</strong>. Ini bukan temuan audit.
        </p>
      )}
      <TechDetails>
      {(
        <table className="v5-table" data-testid="v5-cost-inputs">
          <thead><tr><th>Masukan</th><th>Nilai</th><th>Label dan sumber</th></tr></thead>
          <tbody>
            {cost.inputs.map((x) => (
              <tr key={x.key}>
                <td>{x.label}</td>
                <td>{x.value !== undefined ? x.value : x.low !== undefined ? `${x.low.toLocaleString('en-US')} – ${(x.high ?? 0).toLocaleString('en-US')}` : x.high !== undefined ? `sampai ${x.high}` : '–'} {x.unit}</td>
                <td><Chip kind={x.status} /> <span className="v5-caption">{x.source}</span></td>
              </tr>
            ))}
            {cost.lines.filter((l) => !l.idr).map((l) => <tr key={l.id}><td>{l.item}</td><td>belum dihitung</td><td><Chip kind="TODO_VERIFY" /> <span className="v5-caption">{l.sourceToFetch}</span></td></tr>)}
          </tbody>
        </table>
      )}
      <ul className="v5-caption">{cost.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      </TechDetails>
    </Card>
  );
}

export function PinnCard({ run }: { run: NonNullable<V5Case['pinnRun']> }) {
  if (run.status !== 'COMPUTED' || !run.lifeMonths) {
    return <Card title="Perkiraan umur perbaikan" testId="v5-pinn"><p>Belum bisa dihitung: layanan perhitungan sedang tidak tersedia.</p><p className="v5-caption">Rencana tetap bisa diusulkan.</p></Card>;
  }
  const { p10, p50, p90 } = run.lifeMonths;
  const top = Math.max(p90, 1);
  return (
    <Card title="Perkiraan umur perbaikan" testId="v5-pinn">
      <p className="v5-big" data-testid="v5-pinn-range"><strong>{p10}–{p90} bulan</strong> <Chip kind="AI_ESTIMATE" /><br /><span className="v5-caption">Paling mungkin sekitar {p50} bulan.</span></p>
      <div className="v5-band" aria-hidden="true"><span style={{ left: `${(p10 / top) * 100}%`, width: `${Math.max(2, ((p90 - p10) / top) * 100)}%` }} /></div>
      <p>Dihitung dari beban lalu lintas <Chip kind="INPUT" /> dan susunan jalan yang umum <Chip kind="ASSUMED" />.</p>
      <p className="v5-caption">Belum divalidasi di lapangan. Petugas yang memutuskan perbaikannya.</p>
      <TechDetails>
        <dl className="v5-dl">
          <dt>Rentang</dt><dd>P10–P90 dari {run.samples} sampel</dd>
          <dt>Lalu lintas</dt><dd>{run.esalYear?.toLocaleString('en-US')} ESAL/tahun</dd>
          <dt>Kelas jalan</dt><dd>{run.roadClass}</dd>
          <dt>Model</dt><dd>{run.solver}, {run.device}. Model pengganti berbasis fisika (teori lapis elastis). {run.hostLabel === 'HOST_NON_INTEL' ? 'Dijalankan di laptop non-Intel.' : run.hostLabel}</dd>
        </dl>
      </TechDetails>
    </Card>
  );
}

interface PanelProps { c: StaffCase; onChange: (next?: Partial<StaffCase>) => void }

function useTransition(c: StaffCase, onChange: PanelProps['onChange']) {
  const action = useAction();
  const send = (name: string, body: Record<string, unknown> = {}) => action.run(async () => {
    const out = await v5<{ case: V5Case }>(`/cases/${c.id}/transitions`, { action: name, expectedVersion: c.version, ...body });
    onChange(out.case as Partial<StaffCase>);
    return out;
  });
  return { ...action, send };
}

function ActionPanel({ c, onChange }: PanelProps) {
  const { role: viewed, v6Role, accountId } = useV5();
  const state = c.state as V5State;
  // An OM or FE holds several duties; the case's own step decides which panel it needs.
  const role = v6Role ? panelDuty(v6Role, state) : viewed;
  if (role === 'COORDINATOR') return <CoordinatorPanel c={c} onChange={onChange} />;
  if (role === 'FIELD_INSPECTOR') {
    if (c.inspection?.inspectorAccountId !== accountId && (state === 'INSPECTION_ASSIGNED' || state === 'INSPECTION_VERIFIED')) return <Card><p>Inspeksi ini ditugaskan ke orang lain.</p></Card>;
    if (state === 'INSPECTION_ASSIGNED') return <InspectPanel c={c} onChange={onChange} />;
    if (state === 'INSPECTION_VERIFIED') return <PlanPanel c={c} onChange={onChange} />;
    if (state === 'MONITORING') return <FollowUpPanel c={c} onChange={onChange} />;
  }
  if (role === 'APPROVER') {
    if (state === 'PLAN_PROPOSED') return <ApprovePanel c={c} onChange={onChange} />;
    if (state === 'WORK_VERIFIED') return <AcceptPanel c={c} onChange={onChange} />;
  }
  if (role === 'REPAIR_CREW' && (state === 'WORK_ORDERED' || state === 'IN_PROGRESS')) return <CrewPanel c={c} onChange={onChange} />;
  if (role === 'SUPERVISOR' && state === 'WORK_SUBMITTED') return <SupervisorPanel c={c} onChange={onChange} />;
  if (role === 'AUDITOR') return <AuditPanel c={c} onChange={onChange} />;
  return <Card><p className="v5-muted">Belum ada yang perlu dilakukan {V5_ROLE_NAMES[role].id} di tahap ini. Berikutnya: {NEXT_STEP[state] ?? 'tidak ada'}.</p></Card>;
}

function Reason({ value, onChange, label = 'Alasan' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className="v5-field"><span>{label}, minimal 10 huruf</span>
      <textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} data-testid="v5-reason" />
    </label>
  );
}

function CoordinatorPanel({ c, onChange }: PanelProps) {
  const { staff } = useV5();
  const firstOf = (role: string) => staff.find((a) => a.role === role)?.accountId ?? '';
  const t = useTransition(c, onChange);
  const state = c.state as V5State;
  const [reason, setReason] = useState('');
  const [inspector, setInspector] = useState(() => firstOf('FE'));
  const [due, setDue] = useState(() => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  const [showTransfer, setShowTransfer] = useState(false);
  const [target, setTarget] = useState(0);
  const [decreeNo, setDecreeNo] = useState('');
  const [decreeDate, setDecreeDate] = useState('');
  const [damage, setDamage] = useState(c.damageClass ?? c.screening?.label ?? 'POTHOLE');
  const [executorType, setExecutorType] = useState<'SWAKELOLA' | 'CONTRACT'>('SWAKELOLA');
  const [executor, setExecutor] = useState('');
  const [packageId, setPackageId] = useState('');
  const [ownNo, setOwnNo] = useState('');
  const [ownDate, setOwnDate] = useState('');
  const [guestBadge, setGuestBadge] = useState<Badge | null>(null);
  const agencies = useLoad(() => v6<{ id: string; name: string }[]>('/agencies'), []);
  // The one who proposed the plan does not check it, when there is someone else who can.
  const [supervisor, setSupervisor] = useState(() => staff.find((a) => a.role === 'FE' && a.accountId !== c.inspection?.inspectorAccountId)?.accountId ?? firstOf('FE'));
  const [delay, setDelay] = useState('AWAITING_BUDGET');
  const [until, setUntil] = useState(() => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [showDelay, setShowDelay] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const acceptAndAssign = () => t.run(async () => {
    let version = c.version;
    if (state === 'TRIAGE') {
      const out = await v5<{ case: V5Case }>(`/cases/${c.id}/transitions`, { action: 'ACCEPT', expectedVersion: version, reason, damageClass: damage });
      version = out.case.version;
    }
    const out = await v5<{ case: V5Case }>(`/cases/${c.id}/transitions`, { action: 'ASSIGN_INSPECTION', expectedVersion: version, inspectorAccountId: inspector, dueAt: new Date(due).toISOString(), instructions: reason });
    onChange(out.case as Partial<StaffCase>);
  });

  const rain = () => t.run(async () => { await v5(`/cases/${c.id}/heavy-rain`, {}); setNote('Pemeriksaan setelah hujan lebat sudah terjadwal.'); onChange(); });

  return (
    <Card title={NEXT_STEP[state] ?? 'Tindakan'} testId="v5-panel-coordinator">
      {guestBadge && <AccessBadge badge={guestBadge} title="Kode tamu untuk pelaksana" />}
      {c.transferPending && (
        <div className="v5-note" data-testid="v5-transfer-pending">
          <p>Pengalihan ke <strong>{c.transferPending.toAuthorityName}</strong> menunggu konfirmasi orang kedua di instansi itu. SK: {c.transferPending.decreeRef}</p>
          <Reason value={reason} onChange={setReason} />
          <button type="button" className="v5-btn" disabled={t.busy} onClick={() => t.send('CONFIRM_TRANSFER', { reason })} data-testid="v5-confirm-transfer">Konfirmasi pengalihan</button>
        </div>
      )}
      {!c.transferPending && (state === 'TRIAGE' || state === 'ACCEPTED' || state === 'REOPENED') && (
        <>
          {c.routing?.confidence === 'LOW' && !c.ownershipConfirmed && (
            <div className="v5-note" data-testid="v5-coordinator-confirm">
              <p className="v5-warn">Konfirmasi kepemilikan: sistem belum yakin jalan ini milik instansi Anda.</p>
              <label className="v5-field"><span>Nomor SK penetapan jalan</span><input value={ownNo} onChange={(e) => setOwnNo(e.target.value)} data-testid="v6-own-decree-number" /></label>
              <label className="v5-field"><span>Tanggal SK</span><input type="date" value={ownDate} onChange={(e) => setOwnDate(e.target.value)} data-testid="v6-own-decree-date" /></label>
              <button type="button" className="v5-btn" disabled={t.busy || !ownNo.trim() || !ownDate} onClick={() => t.run(async () => { const out = await v5<{ case: V5Case }>(`/cases/${c.id}/confirm-ownership`, { decreeRef: { number: ownNo, date: ownDate } }); onChange(out.case as Partial<StaffCase>); })} data-testid="v6-confirm-ownership">Ya, ini jalan kami</button>
            </div>
          )}
          {c.ownershipConfirmed && <p className="v5-muted" data-testid="v6-ownership-confirmed">Kepemilikan dipastikan: {c.ownershipConfirmed.decreeRef}</p>}
          {c.screening?.label && <p>Saran AI: {DAMAGE_WORD[c.screening.label] ?? c.screening.label}, keyakinan {c.screening.score === null ? '–' : `${Math.round(c.screening.score * 100)}%`} <Chip kind="AI_ESTIMATE" /></p>}
          {state === 'TRIAGE' && (
            <label className="v5-field"><span>Jenis kerusakan, Anda yang memutuskan</span>
              <select value={damage} onChange={(e) => setDamage(e.target.value)} data-testid="v5-damage-class">
                {DAMAGE_OPTIONS.map((k) => <option key={k} value={k}>{DAMAGE_WORD[k]}</option>)}
              </select>
            </label>
          )}
          <label className="v5-field"><span>Petugas inspeksi</span>
            <select value={inspector} onChange={(e) => setInspector(e.target.value)} data-testid="v5-inspector">{staff.filter((a) => a.role === 'FE').map((a) => <option key={a.accountId} value={a.accountId}>{a.displayName}</option>)}</select>
          </label>
          <label className="v5-field"><span>Tenggat</span><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <Reason value={reason} onChange={setReason} />
          <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy} onClick={acceptAndAssign} data-testid="v5-accept-assign">{state === 'TRIAGE' ? 'Terima dan tugaskan' : 'Tugaskan petugas'}</button>
          {state !== 'REOPENED' && <button type="button" className="v5-link" onClick={() => setShowTransfer(!showTransfer)} data-testid="v5-transfer-toggle">Alihkan ke instansi lain</button>}
          {state !== 'REOPENED' && <button type="button" className="v5-link" disabled={t.busy} onClick={() => t.send('CLOSE_INVALID', { reason, closureReason: 'INVALID' })} data-testid="v5-close-invalid">Tutup: bukan kerusakan jalan</button>}
          {showTransfer && (
            <div className="v5-note">
              <label className="v5-field"><span>Instansi</span><select value={target} onChange={(e) => setTarget(Number(e.target.value))} data-testid="v5-transfer-target">{(agencies.data ?? []).map((x, i) => <option key={x.id} value={i}>{x.name}</option>)}</select></label>
              <label className="v5-field"><span>Nomor SK penetapan jalan</span><input value={decreeNo} onChange={(e) => setDecreeNo(e.target.value)} placeholder="Kepmen PUPR 1688/KPTS/M/2022" data-testid="v5-decree-number" /></label>
              <label className="v5-field"><span>Tanggal SK</span><input type="date" value={decreeDate} onChange={(e) => setDecreeDate(e.target.value)} data-testid="v5-decree-date" /></label>
              <button type="button" className="v5-btn" disabled={t.busy} onClick={() => t.send('TRANSFER_AUTHORITY', { reason, target: { agencyId: agencies.data?.[target]?.id }, decreeRef: { number: decreeNo, date: decreeDate } })} data-testid="v5-transfer">Kirim pengalihan</button>
            </div>
          )}
        </>
      )}
      {state === 'INSPECTED' && (
        <>
          <p>Periksa hasil inspeksi di bawah. Lihat foto penggaris dengan mata, karena AI belum bisa membacanya.</p>
          <Reason value={reason} onChange={setReason} />
          <div className="v5-row">
            <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy} onClick={() => t.send('VERIFY_INSPECTION', { reason, acknowledgeRulerMismatch: true })} data-testid="v5-verify-inspection">Inspeksi sudah lengkap</button>
            <button type="button" className="v5-btn" disabled={t.busy} onClick={() => t.send('REQUEST_REINSPECTION', { reason })}>Minta inspeksi ulang</button>
          </div>
        </>
      )}
      {state === 'INSPECTION_VERIFIED' && (
        <>
          <p>Berikutnya petugas mengusulkan rencana. Kalau lokasi ini tidak perlu diperbaiki, tutup di sini.</p>
          <Reason value={reason} onChange={setReason} />
          <button type="button" className="v5-btn" disabled={t.busy} onClick={() => t.send('CLOSE_NO_ACTION', { reason })} data-testid="v5-close-no-action">Tutup: tidak perlu perbaikan</button>
        </>
      )}
      {state === 'PLAN_APPROVED' && (
        <>
          <p>Ini catatan internal, bukan SPK.</p>
          <label className="v5-field"><span>Dikerjakan oleh</span><select value={executorType} onChange={(e) => setExecutorType(e.target.value as 'SWAKELOLA' | 'CONTRACT')} data-testid="v6-executor-type"><option value="SWAKELOLA">Regu sendiri (swakelola)</option><option value="CONTRACT">Kontraktor</option></select></label>
          <label className="v5-field"><span>Nama regu atau kontraktor</span><input value={executor} onChange={(e) => setExecutor(e.target.value)} data-testid="v6-executor-name" /></label>
          {executorType === 'CONTRACT' && <label className="v5-field"><span>Nomor paket pekerjaan</span><input value={packageId} onChange={(e) => setPackageId(e.target.value)} data-testid="v6-package-id" /></label>}
          <label className="v5-field"><span>Yang memeriksa hasil</span><select value={supervisor} onChange={(e) => setSupervisor(e.target.value)} data-testid="v5-supervisor">{staff.filter((a) => a.role === 'FE').map((a) => <option key={a.accountId} value={a.accountId}>{a.displayName}</option>)}</select></label>
          <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy || executor.trim().length < 2 || (executorType === 'CONTRACT' && !packageId.trim())} onClick={async () => { const out = await t.send('ISSUE_WORK_ORDER', { type: executorType, ...(executorType === 'CONTRACT' ? { packageId } : {}), executorName: executor, supervisorAccountId: supervisor, targetDate: new Date(Date.now() + 14 * 86_400_000).toISOString() }); const badge = (out as { guestBadge?: Badge } | undefined)?.guestBadge; if (badge) setGuestBadge(badge); }} data-testid="v5-issue-work-order">Terbitkan perintah kerja</button>
        </>
      )}
      {state === 'MONITORING' && (
        <>
          <p>Pemeriksaan lanjutan berjalan. Catat hujan lebat pertama saat terjadi agar pemeriksaannya terjadwal.</p>
          <button type="button" className="v5-btn" disabled={t.busy} onClick={rain} data-testid="v5-heavy-rain">Catat hujan lebat</button>
          <Reason value={reason} onChange={setReason} label="Alasan membuka kembali" />
          <button type="button" className="v5-btn" disabled={t.busy} onClick={() => t.send('REOPEN', { reason })} data-testid="v5-reopen">Buka kembali kasus</button>
        </>
      )}
      {['ACCEPTED', 'INSPECTION_ASSIGNED', 'INSPECTED', 'INSPECTION_VERIFIED', 'PLAN_PROPOSED', 'PLAN_APPROVED', 'WORK_ORDERED'].includes(state) && (
        <>
          <button type="button" className="v5-link" onClick={() => setShowDelay(!showDelay)} data-testid="v5-delay-toggle">Umumkan alasan menunggu</button>
          {showDelay && (
            <div className="v5-note">
              <label className="v5-field"><span>Alasan</span><select value={delay} onChange={(e) => setDelay(e.target.value)} data-testid="v5-delay-code">{([['AWAITING_BUDGET', 'Menunggu anggaran'], ['AWAITING_SCHEDULE', 'Menunggu jadwal'], ['AWAITING_CONTRACT', 'Menunggu pengadaan'], ['RAINY_SEASON', 'Setelah musim hujan'], ['TECHNICAL_REVIEW', 'Perlu kajian teknis']] as const).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
              <label className="v5-field"><span>Perkiraan sampai</span><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} data-testid="v5-delay-until" /></label>
              <Reason value={reason} onChange={setReason} label="Catatan untuk publik" />
              <button type="button" className="v5-btn" disabled={t.busy} onClick={() => t.send('SET_PENDING', { reason, code: delay, until: new Date(until).toISOString(), note: reason })} data-testid="v5-set-pending">Umumkan</button>
            </div>
          )}
        </>
      )}
      {note && <p className="v5-good">{note}</p>}
      <ErrorNote error={t.error} />
    </Card>
  );
}

function InspectPanel({ c, onChange }: PanelProps) {
  const t = useTransition(c, onChange);
  const [overview, setOverview] = useState<EvidenceView | null>(null);
  const [marker, setMarker] = useState<EvidenceView | null>(null);
  const [ruler, setRuler] = useState<EvidenceView | null>(null);
  const [cls, setCls] = useState(c.damageClass ?? 'POTHOLE');
  const [verdict, setVerdict] = useState('CONFIRMED');
  const [lengthCm, setLengthCm] = useState('');
  const [widthCm, setWidthCm] = useState('');
  const [depthMm, setDepthMm] = useState('');
  const step = !overview ? 1 : !marker ? 2 : !ruler ? 3 : 4;
  const submit = () => t.send('SUBMIT_INSPECTION', {
    verdict,
    classConfirmed: cls,
    lengthMm: Math.round(Number(lengthCm) * 10),
    widthMm: Math.round(Number(widthCm) * 10),
    depthMmTyped: Math.round(Number(depthMm)),
    evidenceIds: [overview?.id, marker?.id, ruler?.id].filter(Boolean)
  });
  return (
    <Card title={`Ukur di lokasi, langkah ${step} dari 4`} testId="v5-panel-inspect">
      {step === 1 && <Capture kind="OVERVIEW" caseId={c.id} purpose="INSPECTION" title="1. Foto keseluruhan" hint="Tunjukkan seluruh kerusakan dan jalan di sekitarnya." onDone={setOverview} />}
      {step === 2 && <Capture kind="MARKER_NADIR" caseId={c.id} purpose="INSPECTION" title="2. Kartu penanda" hint="Letakkan kartu 20 cm di samping kerusakan. Pegang HP tegak lurus di atasnya." onDone={setMarker} />}
      {step === 3 && <Capture kind="DEPTH_RULER" caseId={c.id} purpose="INSPECTION" title="3. Penggaris di titik terdalam" hint="Letakkan mistar perata melintang. Berdirikan penggaris di titik terdalam. Pastikan angkanya terbaca." onDone={setRuler} />}
      {step === 4 && (
        <>
          {overview && <DetectionView evidence={overview} />}
          <p>Kartu penanda: {marker?.marker?.found ? <><strong data-testid="v5-marker-found">terdeteksi</strong>, ukuran dihitung terukur <Chip kind="MEASURED" /></> : <><strong data-testid="v5-marker-found">tidak terdeteksi</strong>, ukuran dihitung perkiraan <Chip kind="AI_ESTIMATE" /></>}</p>
          <label className="v5-field"><span>Apakah AI benar?</span>
            <select value={verdict} onChange={(e) => setVerdict(e.target.value)} data-testid="v5-verdict"><option value="CONFIRMED">Ya, benar</option><option value="DIFFERENT_CLASS">Jenisnya lain, saya perbaiki</option><option value="NOT_FOUND">Tidak ada kerusakan</option></select>
          </label>
          <label className="v5-field"><span>Jenis kerusakan</span>
            <select value={cls} onChange={(e) => setCls(e.target.value)} data-testid="v5-class">{DAMAGE_OPTIONS.map((k) => <option key={k} value={k}>{DAMAGE_WORD[k]}</option>)}</select>
          </label>
          <div className="v5-row">
            <label className="v5-field"><span>Panjang (cm)</span><input inputMode="decimal" value={lengthCm} onChange={(e) => setLengthCm(e.target.value)} data-testid="v5-length" /></label>
            <label className="v5-field"><span>Lebar (cm)</span><input inputMode="decimal" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} data-testid="v5-width" /></label>
          </div>
          <label className="v5-field"><span>Kedalaman (mm), dari penggaris</span><input inputMode="numeric" value={depthMm} onChange={(e) => setDepthMm(e.target.value)} data-testid="v5-depth" /></label>
          <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy} onClick={submit} data-testid="v5-submit-inspection"><ClipboardCheck size={18} aria-hidden="true" /> Kirim hasil inspeksi</button>
          <ErrorNote error={t.error} />
        </>
      )}
    </Card>
  );
}

const REPAIR_LABEL: Record<string, string> = { HOT_MIX_FULL_DEPTH_PATCH: 'Tambal aspal panas sampai dasar', COLD_MIX_TEMPORARY: 'Tambal dingin sementara', OVERLAY: 'Lapis ulang', MILL_AND_INLAY: 'Kupas dan lapis ulang', RECONSTRUCTION: 'Bangun ulang', HOT_MIX_PATCH: 'Tambal aspal panas' };

function PlanPanel({ c, onChange }: PanelProps) {
  const t = useTransition(c, onChange);
  const action = useAction();
  const [esal, setEsal] = useState(String(c.pinnRun?.esalYear ?? ''));
  const [repair, setRepair] = useState(c.pinnRun?.repairOptions?.[0] ?? 'HOT_MIX_FULL_DEPTH_PATCH');
  const [urgency, setUrgency] = useState('PRIORITY');
  const [rationale, setRationale] = useState('');
  const runPinn = () => action.run(async () => { const out = await v5<{ run: V5Case['pinnRun']; case: V5Case }>(`/cases/${c.id}/pinn`, { esalYear: Number(esal) }); setRepair(out.run?.repairOptions?.[0] ?? repair); onChange(out.case as Partial<StaffCase>); });
  const runCost = () => action.run(async () => { const out = await v5<{ case: V5Case }>(`/cases/${c.id}/cost`, { mix: repair === 'COLD_MIX_TEMPORARY' ? 'COLD_MIX' : 'AC_WC' }); onChange(out.case as Partial<StaffCase>); });
  const options = c.pinnRun?.repairOptions ?? ['HOT_MIX_FULL_DEPTH_PATCH', 'COLD_MIX_TEMPORARY'];
  return (
    <Card title="Umur, biaya, dan rencana perbaikan" testId="v5-panel-plan">
      <label className="v5-field"><span>Beban lalu lintas per tahun (ESAL) <Chip kind="INPUT" /></span><input inputMode="numeric" value={esal} onChange={(e) => setEsal(e.target.value)} data-testid="v5-esal" /></label>
      <button type="button" className="v5-btn" disabled={action.busy} onClick={runPinn} data-testid="v5-run-pinn">{action.busy ? 'Menghitung…' : 'Hitung perkiraan umur'}</button>
      <label className="v5-field"><span>Pilihan perbaikan, Anda yang memutuskan</span>
        <select value={repair} onChange={(e) => setRepair(e.target.value)} data-testid="v5-repair">{options.map((o) => <option key={o} value={o}>{REPAIR_LABEL[o] ?? o}</option>)}</select>
      </label>
      <button type="button" className="v5-btn" disabled={action.busy} onClick={runCost} data-testid="v5-run-cost">Hitung biaya wajar</button>
      <div className="v5-row">
        <label className="v5-field"><span>Urgensi</span><select value={urgency} onChange={(e) => setUrgency(e.target.value)} data-testid="v5-urgency"><option value="ROUTINE">Biasa</option><option value="PRIORITY">Prioritas</option><option value="URGENT">Mendesak</option></select></label>
      </div>
      <label className="v5-field"><span>Alasan memilih perbaikan ini</span><textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} data-testid="v5-rationale" /></label>
      <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy || !c.costRun} onClick={() => t.send('PROPOSE_PLAN', { repairType: repair, category: repair === 'COLD_MIX_TEMPORARY' ? 'TEMPORARY' : 'PERMANENT', urgency, rationale })} data-testid="v5-propose-plan">Usulkan rencana</button>
      {!c.costRun && <p className="v5-caption">Hitung biaya wajar dulu, karena volume rencana diambil dari situ.</p>}
      <ErrorNote error={action.error ?? t.error} />
    </Card>
  );
}

function ApprovePanel({ c, onChange }: PanelProps) {
  const t = useTransition(c, onChange);
  const [reason, setReason] = useState('');
  const [budget, setBudget] = useState('APBD');
  return (
    <Card title="Setujui rencana" testId="v5-panel-approve">
      <Reason value={reason} onChange={setReason} />
      <label className="v5-field"><span>Sumber anggaran</span><select value={budget} onChange={(e) => setBudget(e.target.value)} data-testid="v5-budget">{['APBD', 'APBN', 'DANA_DESA', 'BUJT', 'OTHER'].map((k) => <option key={k}>{k}</option>)}</select></label>
      <div className="v5-row">
        <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy} onClick={() => t.send('APPROVE_PLAN', { reason, budgetSource: budget })} data-testid="v5-approve">Setujui rencana</button>
        <button type="button" className="v5-btn" disabled={t.busy} onClick={() => t.send('RETURN_PLAN', { reason })} data-testid="v5-return-plan">Kembalikan rencana</button>
      </div>
      <ErrorNote error={t.error} />
    </Card>
  );
}

function AcceptPanel({ c, onChange }: PanelProps) {
  const t = useTransition(c, onChange);
  const [reason, setReason] = useState('');
  const [months, setMonths] = useState('');
  const [pho, setPho] = useState('');
  const contract = c.workOrder?.type === 'CONTRACT';
  return (
    <Card title="Terima perbaikan" testId="v5-panel-accept">
      <p>Pengawas sudah memeriksa buktinya. Setelah diterima, jadwal pemeriksaan lanjutan dimulai.</p>
      <Reason value={reason} onChange={setReason} />
      <label className="v5-field"><span>Masa pemeliharaan (bulan), kalau ada di kontrak <Chip kind="INPUT" /></span><input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} data-testid="v5-months" /></label>
      {contract && <label className="v5-field"><span>Tanggal serah terima pekerjaan</span><input type="date" value={pho} onChange={(e) => setPho(e.target.value)} data-testid="v6-pho-date" /></label>}
      <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy || (contract && !pho)} onClick={() => t.send('ACCEPT_WORK', { reason, ...(months ? { maintenanceMonths: Number(months) } : {}), ...(pho ? { phoDate: new Date(pho).toISOString() } : {}) })} data-testid="v5-accept-work">Terima perbaikan</button>
      <ErrorNote error={t.error} />
    </Card>
  );
}

const STAGES: { code: string; label: string; hint: string; fields?: { key: string; label: string; unit?: string }[] }[] = [
  { code: 'BEFORE', label: 'Sebelum', hint: 'Kerusakan dengan kartu penanda dan penggaris, sudut sama dengan inspeksi.' },
  { code: 'CUT_EDGES', label: 'Tepi potongan', hint: 'Potongan persegi dan tegak sampai aspal yang masih baik, meteran terlihat.', fields: [{ key: 'cutLengthCm', label: 'Panjang potongan', unit: 'cm' }, { key: 'cutWidthCm', label: 'Lebar potongan', unit: 'cm' }] },
  { code: 'CLEAN_DRY', label: 'Bersih dan kering', hint: 'Lubang bersih, kering, tidak ada genangan.' },
  { code: 'TACK_COAT', label: 'Lapis perekat', hint: 'Disemprot di dasar dan tepi lubang.', fields: [{ key: 'material', label: 'Bahan' }] },
  { code: 'DELIVERY_TICKET', label: 'Tiket kiriman', hint: 'Tulisan tiket terbaca di foto.', fields: [{ key: 'mixType', label: 'Jenis campuran' }, { key: 'weightKg', label: 'Berat', unit: 'kg' }] },
  { code: 'MIX_TEMP_TRUCK', label: 'Suhu di truk', hint: 'Angka termometer dan campuran dalam satu foto.', fields: [{ key: 'temperatureC', label: 'Suhu', unit: '°C' }] },
  { code: 'MIX_TEMP_MAT', label: 'Suhu di lubang', hint: 'Angka pada campuran saat mulai dipadatkan.', fields: [{ key: 'temperatureC', label: 'Suhu', unit: '°C' }] },
  { code: 'LOOSE_THICKNESS', label: 'Tebal sebelum dipadatkan', hint: 'Penggaris di tepi tambalan sebelum dipadatkan.', fields: [{ key: 'thicknessMm', label: 'Tebal', unit: 'mm' }] },
  { code: 'COMPACTION', label: 'Pemadatan', hint: 'Alat pemadat di atas tambalan.', fields: [{ key: 'passes', label: 'Jumlah lintasan' }] },
  { code: 'AFTER', label: 'Sesudah', hint: 'Tambalan selesai dengan mistar perata di atasnya.' }
];

function CrewPanel({ c, onChange }: PanelProps) {
  const t = useTransition(c, onChange);
  const [active, setActive] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [tonnage, setTonnage] = useState('');
  const [spend, setSpend] = useState('');
  const done = new Set(c.evidence.filter((e) => e.kind === 'WORK_STAGE').map((e) => e.stage));
  const stage = STAGES.find((s) => s.code === active);
  const started = c.state === 'IN_PROGRESS';
  const canStart = done.has('BEFORE') && done.has('CUT_EDGES');
  const missing = STAGES.filter((s) => !done.has(s.code) && s.code !== 'LOOSE_THICKNESS' && !(c.workOrder?.category === 'TEMPORARY' && ['CUT_EDGES', 'TACK_COAT', 'DELIVERY_TICKET', 'MIX_TEMP_TRUCK', 'MIX_TEMP_MAT'].includes(s.code)));

  const saveStage = (e: EvidenceView) => t.run(async () => {
    const typed = Object.fromEntries((stage?.fields ?? []).map((f) => [f.key, f.unit ? Number(values[`${stage!.code}.${f.key}`] ?? 0) : values[`${stage!.code}.${f.key}`] ?? '']));
    const out = await v5<{ case: V5Case }>(`/cases/${c.id}/stage-evidence`, { evidenceId: e.id, values: typed });
    setActive(null);
    onChange(out.case as Partial<StaffCase>);
  });

  return (
    <Card title={`Daftar bukti: ${done.size} dari ${STAGES.length}`} testId="v5-panel-crew">
      <p className="v5-caption">Foto membuktikan langkah kerja, bukan kepadatan aspal. Kepadatan hanya bisa diuji di laboratorium.</p>
      <ul className="v5-checklist">
        {STAGES.map((s) => (
          <li key={s.code} className={done.has(s.code) ? 'is-done' : ''} data-stage={s.code} data-done={done.has(s.code)}>
            <button type="button" onClick={() => setActive(s.code)} data-testid={`v5-stage-${s.code}`}>{done.has(s.code) ? '✓' : '○'} {s.label}</button>
          </li>
        ))}
      </ul>
      {stage && (
        <div className="v5-note">
          {stage.fields?.map((f) => (
            <label key={f.key} className="v5-field"><span>{f.label}{f.unit ? ` (${f.unit})` : ''} <Chip kind="INPUT" /></span>
              <input value={values[`${stage.code}.${f.key}`] ?? ''} onChange={(e) => setValues({ ...values, [`${stage.code}.${f.key}`]: e.target.value })} data-testid={`v5-value-${f.key}`} />
            </label>
          ))}
          <Capture key={stage.code} kind="WORK_STAGE" stage={stage.code} caseId={c.id} purpose="WORK_STAGE" title={stage.label} hint={stage.hint} onDone={saveStage} />
        </div>
      )}
      {!started && <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy || !canStart} onClick={() => t.send('START_WORK', { evidenceIds: [] , evidence: undefined, useSavedStages: true })} data-testid="v5-start-work">Mulai perbaikan</button>}
      {started && (
        <>
          <label className="v5-field"><span>Total campuran (kg), dari tiket <Chip kind="INPUT" /></span><input inputMode="numeric" value={tonnage} onChange={(e) => setTonnage(e.target.value)} data-testid="v5-tonnage" /></label>
          <label className="v5-field"><span>Biaya yang dilaporkan (rupiah) <Chip kind="INPUT" /></span><input inputMode="numeric" value={spend} onChange={(e) => setSpend(e.target.value)} data-testid="v5-spend" /></label>
          <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy || missing.length > 0} onClick={() => t.send('SUBMIT_WORK_EVIDENCE', { useSavedStages: true, declared: { tonnageKg: Number(tonnage), reportedSpendIdr: Number(spend), areaCm2: c.plan?.areaCm2, thicknessMm: c.plan?.thicknessMm } })} data-testid="v5-submit-work">Kirim bukti</button>
          {missing.length > 0 && <p className="v5-caption">Masih kurang: {missing.map((m) => m.label).join(', ')}.</p>}
        </>
      )}
      <ErrorNote error={t.error} />
    </Card>
  );
}

function SupervisorPanel({ c, onChange }: PanelProps) {
  const t = useTransition(c, onChange);
  const [fails, setFails] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [own, setOwn] = useState<EvidenceView | null>(null);
  const items = c.evidence.filter((e) => e.kind === 'WORK_STAGE');
  const toggle = (s: string) => setFails((f) => (f.includes(s) ? f.filter((x) => x !== s) : [...f, s]));
  return (
    <Card title="Periksa bukti perbaikan" testId="v5-panel-supervisor">
      <ul className="v5-review">
        {items.map((e) => (
          <li key={e.id} data-stage={e.stage}>
            <img src={apiUrl(`/api/v5/evidence/${e.id}/image`)} alt={e.stage ?? ''} loading="lazy" />
            <div>
              <strong>{STAGES.find((x) => x.code === e.stage)?.label ?? e.stage}</strong>
              {e.values && <span className="v5-caption">{Object.entries(e.values).map(([k, v]) => `${k}: ${v}`).join(', ')} <Chip kind="INPUT" /></span>}
              <label className="v5-check"><input type="checkbox" checked={fails.includes(e.stage ?? '')} onChange={() => toggle(e.stage ?? '')} /> Item ini tidak lolos</label>
            </div>
          </li>
        ))}
      </ul>
      {!own ? (
        <Capture kind="WORK_STAGE" stage="SUPERVISOR_AFTER" caseId={c.id} purpose="WORK_STAGE" title="Foto Anda sendiri" hint="Ambil sendiri di lokasi, dengan mistar perata di atas tambalan." onDone={setOwn} />
      ) : (
        <p className="v5-good" data-testid="v5-own-photo">Foto Anda sudah tersimpan.</p>
      )}
      <Reason value={reason} onChange={setReason} label={fails.length ? 'Alasan' : 'Alasan (hanya kalau menolak)'} />
      <div className="v5-row">
        <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy || !own || fails.length > 0} onClick={() => t.send('VERIFY_WORK', { evidenceIds: [own!.id], failedStages: fails })} data-testid="v5-verify-work">Perbaikan sudah sesuai</button>
        <button type="button" className="v5-btn" disabled={t.busy} onClick={() => t.send('REJECT_WORK', { reason, failedStages: fails })} data-testid="v5-reject-work">Perlu diulang</button>
      </div>
      <ErrorNote error={t.error} />
    </Card>
  );
}

function FollowUpPanel({ c, onChange }: PanelProps) {
  const t = useTransition(c, onChange);
  const open = c.followUps.filter((f) => !f.result && f.assigneeRole !== 'CITIZEN');
  const [milestone, setMilestone] = useState(open[0]?.milestone ?? '');
  const [result, setResult] = useState('OK');
  const [photo, setPhoto] = useState<EvidenceView | null>(null);
  if (open.length === 0) return <Card title="Pemeriksaan lanjutan"><p className="v5-muted">Belum ada pemeriksaan untuk petugas saat ini.</p></Card>;
  return (
    <Card title="Pemeriksaan lanjutan" testId="v5-panel-followup">
      <label className="v5-field"><span>Pemeriksaan</span><select value={milestone} onChange={(e) => setMilestone(e.target.value)} data-testid="v5-fu-milestone">{open.map((f) => <option key={f.milestone}>{f.milestone}</option>)}</select></label>
      <label className="v5-field"><span>Hasil</span><select value={result} onChange={(e) => setResult(e.target.value)} data-testid="v5-fu-result"><option value="OK">Masih bagus</option><option value="DEFECT">Ada kerusakan</option></select></label>
      {!photo ? <Capture kind="FOLLOW_UP" caseId={c.id} purpose="FOLLOW_UP" title="Foto dengan mistar perata" hint="Sudutnya sama dengan foto perbaikan." onDone={setPhoto} /> : <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy} onClick={() => t.send('RECORD_FOLLOW_UP', { milestone, result, evidenceIds: [photo.id] })} data-testid="v5-fu-send">Catat hasil</button>}
      <ErrorNote error={t.error} />
    </Card>
  );
}

interface EventRow { seq: number; type: string; event_hash: string; prev_hash: string; server_received_at: string; actor: { role: string; ref: string; overlap_basis: string | null }; payload: Record<string, unknown>; refs: { next_state: string | null } }
interface Verify { ok: boolean; checked: number; truncated: boolean; firstFailure: { seq: number; status: string } | null }

function AuditPanel({ c, onChange }: PanelProps) {
  const { go } = useV5();
  const { data, reload } = useLoad(() => v5<{ events: EventRow[]; verify: Verify }>(`/cases/${c.id}/events`), [c.id]);
  const action = useAction();
  const [doc, setDoc] = useState<{ id: string; sha256: string; pdfUrl: string; verifyUrl: string; version: number } | null>(null);
  const [wording, setWording] = useState('W-01');
  const [note, setNote] = useState('');
  const issue = () => action.run(async () => { setDoc(await v5('/documents/audit-report', { caseId: c.id })); reload(); });
  const flag = () => action.run(async () => { const out = await v5<{ case: V5Case }>(`/cases/${c.id}/flags`, { wordingId: wording, note, code: 'AUDITOR_NOTE', value: '' }); setNote(''); onChange(out.case as Partial<StaffCase>); reload(); });
  return (
    <>
      <Card title="Laporan Audit Perbaikan Independen" testId="v5-panel-audit">
        <p>Anda hanya membaca: bisa mengunduh laporan dan menambah catatan netral, tidak bisa mengubah kasus.</p>
        <button type="button" className="v5-btn v5-btn-primary" disabled={action.busy} onClick={issue} data-testid="v5-issue-report"><FileText size={18} aria-hidden="true" /> {action.busy ? 'Mencetak…' : 'Buat PDF'}</button>
        {doc && (
          <div className="v5-note" data-testid="v5-doc">
            <p><strong data-testid="v5-doc-id">{doc.id}</strong> </p>
            <p className="v5-caption">Kode bukti <code data-testid="v5-doc-hash">{doc.sha256}</code></p>
            <div className="v5-row">
              <a className="v5-btn" href={apiUrl(doc.pdfUrl)} target="_blank" rel="noreferrer" data-testid="v5-doc-pdf">Buka PDF</a>
              <button type="button" className="v5-btn" onClick={() => go(doc.verifyUrl)} data-testid="v5-doc-verify">Periksa keasliannya</button>
            </div>
          </div>
        )}
        <ErrorNote error={action.error} />
      </Card>

      <Card title="Tambah catatan netral" testId="v5-panel-flag">
        <label className="v5-field"><span>Kalimat catatan</span>
          <select value={wording} onChange={(e) => setWording(e.target.value)} data-testid="v5-wording"><option value="W-01">Ada ketidaksesuaian, perlu klarifikasi</option><option value="W-10">Disarankan uji inti (core drill)</option></select>
        </label>
        <label className="v5-field"><span>Keterangan, opsional</span><input value={note} onChange={(e) => setNote(e.target.value)} data-testid="v5-flag-note" /></label>
        <button type="button" className="v5-btn" disabled={action.busy} onClick={flag} data-testid="v5-add-flag">Tambah catatan</button>
        <p className="v5-caption">Catatan melekat pada kasus, bukan pada orang. Kata yang menuduh akan ditolak.</p>
      </Card>

      <Card title="Catatan kejadian" testId="v5-events">
        {data && (
          <>
            <p className={data.verify.ok ? 'v5-good' : 'v5-bad'} data-testid="v5-chain-status"><ShieldCheck size={16} aria-hidden="true" /> {data.verify.ok ? `Utuh. ${data.verify.checked} catatan sudah dicek.` : `Ada catatan yang berubah, di nomor ${data.verify.firstFailure?.seq ?? 'terakhir'}.`} <Chip kind="COMPUTED" /></p>
            <ol className="v5-events">
              {data.events.map((e) => (
                <li key={e.seq}><span><Link2 size={12} aria-hidden="true" /> #{e.seq} {eventWord(e.type)}</span><span className="v5-caption">{when(e.server_received_at)} · {roleWord(e.actor.role)}{e.actor.overlap_basis ? ` · rangkap jabatan: ${e.actor.overlap_basis}` : ''}</span></li>
              ))}
            </ol>
          </>
        )}
      </Card>
    </>
  );
}

export function AuditorHome() {
  const { go } = useV5();
  const { data } = useLoad(() => v5<StaffCase[]>('/cases'));
  return (
    <Card title="Semua kasus" testId="v5-queue">
      <div className="v5-empty"><RolePavi role="AUDITOR" /><p>Anda bisa membaca semua, mengunduh laporan, dan menambah catatan netral. Anda tidak bisa mengubah kasus.</p></div>
      <ul className="v5-list">
        {(data ?? []).map((c) => (
          <li key={c.id}><button type="button" onClick={() => go(`/kerja/${c.id}`)} data-testid={`v5-open-${c.publicCode}`}><strong>{c.publicCode}</strong><span>{stateWord(c)}</span></button></li>
        ))}
      </ul>
    </Card>
  );
}

export function HeadHome() {
  const { go } = useV5();
  const { data } = useLoad(() => v5<{ totalCases: number; open: number; underWatch: number; levels: Record<string, number>; escalated: { id: string; publicCode: string; stateLabel: string; daysWaiting: number; level: string; office: string | null; delay: string | null }[]; overlaps: number }>('/dashboard/agency'));
  if (!data) return <Card><p>Memuat…</p></Card>;
  return (
    <>
      <Card title="Ringkasan instansi" testId="v5-head">
        <div className="v5-empty"><RolePavi role="AGENCY_HEAD" /><p>Angka langsung dari catatan kasus.</p></div>
        <dl className="v5-dl">
          <dt>Semua kasus</dt><dd>{data.totalCases} <Chip kind="COMPUTED" /></dd>
          <dt>Masih terbuka</dt><dd>{data.open} <Chip kind="COMPUTED" /></dd>
          <dt>Diperbaiki, dipantau</dt><dd>{data.underWatch} <Chip kind="COMPUTED" /></dd>
          <dt>Lewat 7 hari</dt><dd>{data.levels.AGENCY_HEAD + data.levels.PUBLIC + data.levels.COMPLAINT} <Chip kind="COMPUTED" /></dd>
          <dt>Rangkap jabatan tercatat</dt><dd>{data.overlaps} <Chip kind="COMPUTED" /></dd>
        </dl>
      </Card>
      <Card title="Eskalasi ke Anda">
        {data.escalated.length === 0 && <p className="v5-muted">Belum ada kasus yang lewat 7 hari.</p>}
        <ul className="v5-list">
          {data.escalated.map((e) => <li key={e.id}><button type="button" onClick={() => go(`/kerja/${e.id}`)}><strong>{e.publicCode}</strong><span>{e.stateLabel} · {e.daysWaiting} hari <Chip kind="COMPUTED" /> · {e.office}</span></button></li>)}
        </ul>
      </Card>
    </>
  );
}

export function AdminHome() {
  const { data, error } = useLoad(() => v5<{ registry: { version: string; attribution: string }; offices: { total: number; byStatus: Record<string, number>; list: { id: string; name: string; type: string; status: string }[] }; prices: { total: number; byStatus: Record<string, number>; list: { id: string; item: string; unit: string; priceIdr: number; region: string; status: string; source: string }[] }; wages: { ump: number; umkTodo: number }; note: string }>('/admin/overview'));
  if (error) return <Card><p>{error.message}</p></Card>;
  if (!data) return <Card><p>Memuat…</p></Card>;
  return (
    <>
      <Card title="Data wilayah" testId="v5-admin">
        <div className="v5-empty"><RolePavi role="ADMIN" /><p>Tabel ini langsung dari data sumber. Mengubahnya belum tersedia, dan admin tidak bisa mengubah kasus.</p></div>
        <p>Peta jalan: data OpenStreetMap. SK penetapan status belum dimuat <Chip kind="TODO_VERIFY" /></p>
        <p>Kantor instansi: {data.offices.total} <Chip kind="COMPUTED" /></p>
        <p>Upah: {data.wages.ump} provinsi dimuat, {data.wages.umkTodo} kabupaten/kota belum dipastikan <Chip kind="TODO_VERIFY" /></p>
      </Card>
      <Card title="Harga dan sumbernya">
        <table className="v5-table">
          <thead><tr><th>Barang</th><th>Harga</th><th>Label</th></tr></thead>
          <tbody>{data.prices.list.map((p) => <tr key={p.id}><td>{p.item}<br /><span className="v5-caption">{p.region}</span></td><td>{rupiah(p.priceIdr)}/{p.unit}</td><td>{['OFFICIAL', 'ASSUMED', 'TODO_VERIFY', 'INPUT'].includes(p.status) ? <Chip kind={p.status as ChipKind} /> : <Chip kind="ASSUMED" title={p.status} />}</td></tr>)}</tbody>
        </table>
      </Card>
    </>
  );
}
