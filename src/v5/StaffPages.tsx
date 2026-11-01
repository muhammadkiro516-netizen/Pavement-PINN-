/**
 * Staff screens. One case screen shows the record; the action panel depends on role and state.
 * The server decides every action: a button here only asks, and a refusal shows its SoD rule.
 */
import { useState, type ReactNode } from 'react';
import { ClipboardCheck, FileText, Link2, ShieldCheck } from 'lucide-react';
import { V5_ROLE_NAMES, type V5Case, type V5Role, type V5State } from '../domain/v5/model';
import { v5 } from './api';
import { useV5 } from './context';
import { Capture, DetectionView, apiUrl, type EvidenceView } from './Capture';
import { FollowUps } from './CitizenPages';
import { Card, Chip, Confidence, ErrorNote, Ladder, RolePavi, dateOnly, roleWord, rupiah, useAction, useLoad, when, type ChipKind, type LadderView } from './ui';

export interface StaffCase extends V5Case {
  stateLabel: string;
  ladder: LadderView;
  priority: { score: number; reasons: { text: string; points: number }[] };
}

const QUEUES: Partial<Record<V5Role, { title: string; states: V5State[]; empty: string }>> = {
  COORDINATOR: { title: 'Priority queue', states: ['TRIAGE', 'ACCEPTED', 'INSPECTED', 'PLAN_APPROVED', 'WORK_VERIFIED', 'MONITORING', 'REOPENED'], empty: 'No cases waiting for you.' },
  FIELD_INSPECTOR: { title: 'My inspections', states: ['INSPECTION_ASSIGNED', 'INSPECTION_VERIFIED', 'MONITORING', 'REOPENED'], empty: 'No inspections assigned to you.' },
  APPROVER: { title: 'Waiting for approval', states: ['PLAN_PROPOSED', 'WORK_VERIFIED'], empty: 'No plans waiting for approval.' },
  REPAIR_CREW: { title: 'My work orders', states: ['WORK_ORDERED', 'IN_PROGRESS'], empty: 'No work orders for you.' },
  SUPERVISOR: { title: 'Repairs to check', states: ['WORK_SUBMITTED'], empty: 'No repairs waiting for your check.' }
};

const NEXT_STEP: Partial<Record<V5State, string>> = {
  TRIAGE: 'Accept and assign an inspector',
  ACCEPTED: 'Assign an inspector',
  INSPECTION_ASSIGNED: 'Measure on site',
  INSPECTED: 'Check the inspection',
  INSPECTION_VERIFIED: 'Run physics and cost, propose a plan',
  PLAN_PROPOSED: 'Approve or return the plan',
  PLAN_APPROVED: 'Issue the work order',
  WORK_ORDERED: 'Start the repair',
  IN_PROGRESS: 'Upload the evidence checklist',
  WORK_SUBMITTED: 'Check the evidence',
  WORK_VERIFIED: 'Accept the repair',
  MONITORING: 'Follow-ups running',
  REOPENED: 'Assign a new inspection'
};

export function StaffHome() {
  const { role, go, account } = useV5();
  const queue = QUEUES[role];
  const { data, error } = useLoad(() => v5<StaffCase[]>('/cases'), [role, account?.accountId]);
  if (role === 'AUDITOR') return <AuditorHome />;
  if (role === 'AGENCY_HEAD') return <HeadHome />;
  if (role === 'ADMIN') return <AdminHome />;
  const rows = (data ?? []).filter((c) => queue?.states.includes(c.state as V5State));
  return (
    <Card title={queue?.title} testId="v5-queue">
      {error && <p>{error.message}</p>}
      {!data && !error && <p>Loading…</p>}
      {data && rows.length === 0 && <div className="v5-empty"><RolePavi role={role} mood="sleep" /><p>{queue?.empty}</p></div>}
      <ul className="v5-list">
        {rows.map((c) => (
          <li key={c.id} data-code={c.publicCode}>
            <button type="button" onClick={() => go(`/v5/case/${c.id}`)} data-testid={`v5-open-${c.publicCode}`}>
              <span className="v5-row-between"><strong>{c.publicCode}</strong>{c.isDemo && <Chip kind="DEMO" />}</span>
              <span>{c.stateLabel} · next: {NEXT_STEP[c.state as V5State] ?? 'None'}</span>
              <span className="v5-caption">{c.routing?.officeName ?? 'Office not set'}{c.routing && <> <Confidence level={c.routing.confidence} /></>}</span>
              {role === 'COORDINATOR' && <span className="v5-reasons" data-testid="v5-priority-reasons">Priority {c.priority.score} <Chip kind="COMPUTED" title="Added up from the reasons shown" />: {c.priority.reasons.map((r) => r.text).join(' · ') || 'no urgent signs'}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function CaseScreen({ id }: { id: string }) {
  const { role, go, account } = useV5();
  const { data: c, error, reload, setData } = useLoad(() => v5<StaffCase>(`/cases/${id}`), [id, account?.accountId]);
  if (error) return <Card title="Could not open this case"><p>{error.message}</p></Card>;
  if (!c) return <Card><p>Loading…</p></Card>;
  return (
    <>
      <button type="button" className="v5-link" onClick={() => go('/v5/')}>Back to queue</button>
      <Card testId="v5-case-head">
        <div className="v5-row-between">
          <div>
            <p className="v5-eyebrow">Case</p>
            <p className="v5-code">{c.publicCode}</p>
          </div>
          <RolePavi role={role} mood="scan" />
        </div>
        <p className="v5-state" data-testid="v5-state-label">{c.stateLabel}</p>
        {c.isDemo && <p><Chip kind="DEMO" /> Sample environment. {c.captureTrust === 'DEMO' && <strong>DEMO — not a live capture.</strong>}</p>}
        <button type="button" className="v5-link" onClick={() => go(`/v5/t/${c.publicCode}`)}>Open the public page</button>
      </Card>
      <ActionPanel c={c} onChange={(next) => { if (next) setData({ ...c, ...next }); reload(); }} />
      <CaseRecord c={c} />
    </>
  );
}

function Num({ children, kind, title }: { children: ReactNode; kind: ChipKind; title?: string }) {
  return <span className="v5-num">{children} <Chip kind={kind} title={title} /></span>;
}

function CaseRecord({ c }: { c: StaffCase }) {
  const i = c.inspection;
  const cost = c.costRun as CostView | null;
  const shots = c.evidence;
  return (
    <>
      {c.routing && (
        <Card title="Whose road" testId="v5-case-routing">
          <p><strong>{c.routing.officeName}</strong> · {c.routing.authorityName}</p>
          <p>{c.routing.roadStatus} road{c.routing.segmentName ? ` · ${c.routing.segmentName}` : ''} <Confidence level={c.routing.confidence} /></p>
          <p className="v5-caption">{c.routing.basis}</p>
          {c.routing.note && <p className="v5-warn">{c.routing.note}</p>}
        </Card>
      )}
      <Card title="Time waiting"><Ladder ladder={c.ladder} /></Card>
      {i?.submittedAt && (
        <Card title="Measurements" testId="v5-measurements">
          <dl className="v5-dl">
            <dt>Verdict</dt><dd>{i.verdict?.replace('_', ' ').toLowerCase()}, {i.classConfirmed}</dd>
            {i.lengthMm && <><dt>Size</dt><dd><Num kind={i.areaStatus === 'MEASURED' ? 'MEASURED' : 'AI_ESTIMATE'} title={i.areaStatus === 'MEASURED' ? 'Marker card found in the photo' : 'No marker card found, so this is an estimate'}>{(i.lengthMm / 1000).toFixed(2)} × {((i.widthMm ?? 0) / 1000).toFixed(2)} m</Num></dd></>}
            {i.depthMmTyped && <><dt>Depth</dt><dd><Num kind="MEASURED" title="Ruler-at-deepest-point photo, typed by the inspector">{i.depthMmTyped} mm</Num></dd></>}
            <dt>AI ruler check</dt><dd>{i.rulerCheck === 'AI_UNREADABLE' ? 'Check the photo by eye. No ruler-reading model yet.' : i.rulerCheck}</dd>
          </dl>
        </Card>
      )}
      {c.pinnRun && <PinnCard run={c.pinnRun} />}
      {cost && <CostCard cost={cost} />}
      {c.plan && (
        <Card title="Repair plan" testId="v5-plan">
          <dl className="v5-dl">
            <dt>Repair</dt><dd>{c.plan.repairType.replace(/_/g, ' ').toLowerCase()}, {c.plan.category.toLowerCase()}</dd>
            <dt>Urgency</dt><dd>{c.plan.urgency.toLowerCase()}</dd>
            <dt>Quantity</dt><dd><Num kind="COMPUTED" title="From the inspector's measurements. The server recomputes it.">{(c.plan.areaCm2 / 10000).toFixed(2)} m² × {c.plan.thicknessMm} mm</Num></dd>
            <dt>Reason</dt><dd>{c.plan.rationale}</dd>
            {c.plan.budgetSource && <><dt>Budget</dt><dd>{c.plan.budgetSource}</dd></>}
          </dl>
        </Card>
      )}
      {c.workOrder && (
        <Card title="Work order" testId="v5-work-order">
          <p>Internal record, not an SPK. {c.workOrder.type.toLowerCase()} · {c.workOrder.category.toLowerCase()}</p>
          <p>Target date {dateOnly(c.workOrder.targetDate)} <Chip kind="INPUT" /></p>
          {c.declared && <p>Reported spend {c.declared.reportedSpendIdr ? rupiah(c.declared.reportedSpendIdr) : '–'} <Chip kind="INPUT" title="Declared by the crew" /></p>}
        </Card>
      )}
      {c.flags.length > 0 && (
        <Card title="Notes that need clarification" testId="v5-flags">
          <ul>{c.flags.map((f) => <li key={f.id}><strong>{f.code.replace(/_/g, ' ').toLowerCase()}</strong>: {f.text} {f.note && <em>({f.note})</em>}</li>)}</ul>
          <p className="v5-caption">Attached to this case, never to a person. Not an audit finding.</p>
        </Card>
      )}
      {c.followUps.length > 0 && <Card title="Follow-ups"><FollowUps items={c.followUps.map((f) => ({ ...f, due: !f.result && !!f.dueAt && f.dueAt <= new Date().toISOString(), overdue: false }))} /></Card>}
      {shots.length > 0 && (
        <Card title={`Evidence photos (${shots.length})`}>
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
  const [open, setOpen] = useState(false);
  const f = cost.fairCostIdr;
  return (
    <Card title="Fair cost" testId="v5-cost">
      {f ? <p className="v5-big" data-testid="v5-cost-range"><strong>{rupiah(f.low)} – {rupiah(f.high)}</strong> <Chip kind="ASSUMED" title="Route B: official AHSP coefficients not loaded" /><br /><span className="v5-caption">Middle {rupiah(f.mid)}</span></p> : <p className="v5-big">Not computed <Chip kind="TODO_VERIFY" /></p>}
      <p className="v5-caption">{cost.label}</p>
      <p>Cut area {cost.quantity.areaCutM2.mid} m², repair depth {cost.quantity.depthRepairCm} cm <Chip kind="COMPUTED" /></p>
      {cost.comparison && (
        <p className={cost.comparison.result === 'NEEDS_CLARIFICATION' ? 'v5-warn' : 'v5-good'} data-testid="v5-cost-result">
          Reported {rupiah(cost.comparison.reportedSpendIdr)} <Chip kind="INPUT" />: {cost.comparison.diffPct > 0 ? '+' : ''}{cost.comparison.diffPct}% <Chip kind="COMPUTED" />. <strong>{cost.comparison.label_en}</strong>.
        </p>
      )}
      <button type="button" className="v5-link" onClick={() => setOpen(!open)} data-testid="v5-cost-inputs-toggle">{open ? 'Hide' : 'Show'} every input ({cost.inputs.length})</button>
      {open && (
        <table className="v5-table" data-testid="v5-cost-inputs">
          <thead><tr><th>Input</th><th>Value</th><th>Label and source</th></tr></thead>
          <tbody>
            {cost.inputs.map((x) => (
              <tr key={x.key}>
                <td>{x.label}</td>
                <td>{x.value !== undefined ? x.value : x.low !== undefined ? `${x.low.toLocaleString('en-US')} – ${(x.high ?? 0).toLocaleString('en-US')}` : x.high !== undefined ? `up to ${x.high}` : '–'} {x.unit}</td>
                <td><Chip kind={x.status} /> <span className="v5-caption">{x.source}</span></td>
              </tr>
            ))}
            {cost.lines.filter((l) => !l.idr).map((l) => <tr key={l.id}><td>{l.item}</td><td>excluded</td><td><Chip kind="TODO_VERIFY" /> <span className="v5-caption">{l.sourceToFetch}</span></td></tr>)}
          </tbody>
        </table>
      )}
      <ul className="v5-caption">{cost.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
    </Card>
  );
}

export function PinnCard({ run }: { run: NonNullable<V5Case['pinnRun']> }) {
  if (run.status !== 'COMPUTED' || !run.lifeMonths) {
    return <Card title="Expected life" testId="v5-pinn"><p>Not computed. {run.reason} <Chip kind="NOT_MEASURED" /></p><p className="v5-caption">The plan can still go ahead.</p></Card>;
  }
  const { p10, p50, p90 } = run.lifeMonths;
  const top = Math.max(p90, 1);
  return (
    <Card title="Expected life, indicative" testId="v5-pinn">
      <p className="v5-big" data-testid="v5-pinn-range"><strong>{p10}–{p90} months</strong> <Chip kind="AI_ESTIMATE" title={`P10 to P90 from ${run.samples} samples`} /><br /><span className="v5-caption">P10–P90. Middle {p50} months.</span></p>
      <div className="v5-band" aria-hidden="true"><span style={{ left: `${(p10 / top) * 100}%`, width: `${Math.max(2, ((p90 - p10) / top) * 100)}%` }} /></div>
      <dl className="v5-dl">
        <dt>Traffic</dt><dd>{run.esalYear?.toLocaleString('en-US')} ESAL/year <Chip kind="INPUT" title="Typed by a person" /></dd>
        <dt>Layer structure</dt><dd>Typical for a {run.roadClass?.toLowerCase()} road <Chip kind="ASSUMED" title="Not measured on this road" /></dd>
        <dt>Model</dt><dd>{run.solver} on {run.device}. Physics-informed forward surrogate of layered-elastic theory.</dd>
      </dl>
      <p className="v5-caption">Ran on {run.hostLabel === 'HOST_NON_INTEL' ? 'a non-Intel laptop' : run.hostLabel}. Not validated in the field. A person chooses the repair.</p>
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
  const { role, account } = useV5();
  const state = c.state as V5State;
  if (role === 'COORDINATOR') return <CoordinatorPanel c={c} onChange={onChange} />;
  if (role === 'FIELD_INSPECTOR') {
    if (c.inspection?.inspectorAccountId !== account?.accountId && (state === 'INSPECTION_ASSIGNED' || state === 'INSPECTION_VERIFIED')) return <Card><p>This inspection is assigned to someone else.</p></Card>;
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
  return <Card><p className="v5-muted">No action for {V5_ROLE_NAMES[role].en} at this step. Next: {NEXT_STEP[state] ?? 'none'}.</p></Card>;
}

function Reason({ value, onChange, label = 'Reason' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className="v5-field"><span>{label}, at least 10 characters</span>
      <textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} data-testid="v5-reason" />
    </label>
  );
}

const TRANSFER_TARGETS = [
  { authorityId: 'kementerian-pu', authorityName: 'BBPJN DKI Jakarta - Jawa Barat', level: 'NASIONAL' },
  { authorityId: 'pemprov-dki', authorityName: 'Dinas Bina Marga Provinsi DKI Jakarta', level: 'PROVINSI' },
  { authorityId: 'pemprov-jabar', authorityName: 'Dinas Bina Marga Provinsi Jawa Barat', level: 'PROVINSI' },
  { authorityId: 'pemkab-karawang', authorityName: 'Dinas PUPR Kabupaten Karawang', level: 'KABUPATEN' }
];

function CoordinatorPanel({ c, onChange }: PanelProps) {
  const { accounts, account } = useV5();
  const t = useTransition(c, onChange);
  const state = c.state as V5State;
  const [reason, setReason] = useState('');
  const [inspector, setInspector] = useState('ACC-INSPECT');
  const [due, setDue] = useState(() => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  const [showTransfer, setShowTransfer] = useState(false);
  const [target, setTarget] = useState(0);
  const [decreeNo, setDecreeNo] = useState('');
  const [decreeDate, setDecreeDate] = useState('');
  const [damage, setDamage] = useState(c.damageClass ?? c.screening?.label ?? 'POTHOLE');
  const [crew, setCrew] = useState('ACC-CREW');
  const [supervisor, setSupervisor] = useState('ACC-SUPERVISE');
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

  const rain = () => t.run(async () => { await v5(`/cases/${c.id}/heavy-rain`, {}); setNote('Heavy-rain follow-up is now due.'); onChange(); });

  return (
    <Card title={NEXT_STEP[state] ?? 'Actions'} testId="v5-panel-coordinator">
      {c.transferPending && (
        <div className="v5-note" data-testid="v5-transfer-pending">
          <p>Transfer to <strong>{c.transferPending.toAuthorityName}</strong> waits for a second person at that agency. Decree: {c.transferPending.decreeRef}</p>
          <Reason value={reason} onChange={setReason} />
          <button type="button" className="v5-btn" disabled={t.busy} onClick={() => t.send('CONFIRM_TRANSFER', { reason })} data-testid="v5-confirm-transfer">Confirm transfer</button>
        </div>
      )}
      {!c.transferPending && (state === 'TRIAGE' || state === 'ACCEPTED' || state === 'REOPENED') && (
        <>
          {c.routing?.confidence === 'LOW' && <p className="v5-warn" data-testid="v5-coordinator-confirm">Coordinator to confirm: {c.routing.note ?? 'please confirm the owner of this road.'}</p>}
          {c.screening?.label && <p>AI suggestion: {c.screening.label}, score {c.screening.score === null ? '–' : `${Math.round(c.screening.score * 100)}%`} <Chip kind="AI_ESTIMATE" title={c.screening.modelId ?? ''} /></p>}
          {state === 'TRIAGE' && (
            <label className="v5-field"><span>Damage class, you decide</span>
              <select value={damage} onChange={(e) => setDamage(e.target.value)} data-testid="v5-damage-class">
                {['POTHOLE', 'ALLIGATOR', 'LONG_CRACK', 'TRANS_CRACK', 'RUTTING_DEPRESSION', 'EDGE_BREAK', 'RAVELLING', 'PATCH_FAILURE', 'SEVERE_BREAKUP'].map((k) => <option key={k}>{k}</option>)}
              </select>
            </label>
          )}
          <label className="v5-field"><span>Field Inspector</span>
            <select value={inspector} onChange={(e) => setInspector(e.target.value)} data-testid="v5-inspector">{accounts.filter((a) => a.role === 'FIELD_INSPECTOR').map((a) => <option key={a.accountId} value={a.accountId}>{a.displayName}</option>)}</select>
          </label>
          <label className="v5-field"><span>Due date</span><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <Reason value={reason} onChange={setReason} />
          <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy} onClick={acceptAndAssign} data-testid="v5-accept-assign">{state === 'TRIAGE' ? 'Accept and assign' : 'Assign inspector'}</button>
          {state !== 'REOPENED' && <button type="button" className="v5-link" onClick={() => setShowTransfer(!showTransfer)} data-testid="v5-transfer-toggle">Transfer to another agency</button>}
          {showTransfer && (
            <div className="v5-note">
              <label className="v5-field"><span>Agency</span><select value={target} onChange={(e) => setTarget(Number(e.target.value))} data-testid="v5-transfer-target">{TRANSFER_TARGETS.map((x, i) => <option key={x.authorityId} value={i}>{x.authorityName}</option>)}</select></label>
              <label className="v5-field"><span>Road decree number (SK)</span><input value={decreeNo} onChange={(e) => setDecreeNo(e.target.value)} placeholder="Kepmen PUPR 1688/KPTS/M/2022" data-testid="v5-decree-number" /></label>
              <label className="v5-field"><span>Decree date</span><input type="date" value={decreeDate} onChange={(e) => setDecreeDate(e.target.value)} data-testid="v5-decree-date" /></label>
              <button type="button" className="v5-btn" disabled={t.busy} onClick={() => t.send('TRANSFER_AUTHORITY', { reason, target: TRANSFER_TARGETS[target], decreeRef: { number: decreeNo, date: decreeDate } })} data-testid="v5-transfer">Send transfer</button>
            </div>
          )}
        </>
      )}
      {state === 'INSPECTED' && (
        <>
          <p>Check the inspection below. No ruler-reading model exists yet, so look at the ruler photo by eye.</p>
          <Reason value={reason} onChange={setReason} />
          <div className="v5-row">
            <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy} onClick={() => t.send('VERIFY_INSPECTION', { reason, acknowledgeRulerMismatch: true })} data-testid="v5-verify-inspection">Inspection is complete</button>
            <button type="button" className="v5-btn" disabled={t.busy} onClick={() => t.send('REQUEST_REINSPECTION', { reason })}>Inspect again</button>
          </div>
        </>
      )}
      {state === 'PLAN_APPROVED' && (
        <>
          <p>This is an internal record, not an SPK.</p>
          <label className="v5-field"><span>Repair Crew</span><select value={crew} onChange={(e) => setCrew(e.target.value)} data-testid="v5-crew">{accounts.filter((a) => a.role === 'REPAIR_CREW' || a.role === 'SUPERVISOR').map((a) => <option key={a.accountId} value={a.accountId}>{a.displayName}</option>)}</select></label>
          <label className="v5-field"><span>Works Supervisor</span><select value={supervisor} onChange={(e) => setSupervisor(e.target.value)} data-testid="v5-supervisor">{accounts.filter((a) => a.role === 'SUPERVISOR').map((a) => <option key={a.accountId} value={a.accountId}>{a.displayName}</option>)}</select></label>
          <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy} onClick={() => t.send('ISSUE_WORK_ORDER', { type: 'SWAKELOLA', crewAccountId: crew, supervisorAccountId: supervisor, targetDate: new Date(Date.now() + 7 * 86_400_000).toISOString() })} data-testid="v5-issue-work-order">Issue work order</button>
        </>
      )}
      {state === 'MONITORING' && (
        <>
          <p>Follow-ups are running. Record the first heavy rain when it happens, so the check can be scheduled. The rainfall threshold is not sourced yet <Chip kind="TODO_VERIFY" /></p>
          <button type="button" className="v5-btn" disabled={t.busy} onClick={rain} data-testid="v5-heavy-rain">Record heavy rain</button>
          <Reason value={reason} onChange={setReason} label="Reason to reopen" />
          <button type="button" className="v5-btn" disabled={t.busy} onClick={() => t.send('REOPEN', { reason })} data-testid="v5-reopen">Reopen case</button>
        </>
      )}
      {['ACCEPTED', 'INSPECTION_ASSIGNED', 'INSPECTED', 'INSPECTION_VERIFIED', 'PLAN_PROPOSED', 'PLAN_APPROVED', 'WORK_ORDERED'].includes(state) && (
        <>
          <button type="button" className="v5-link" onClick={() => setShowDelay(!showDelay)} data-testid="v5-delay-toggle">Publish a delay reason</button>
          {showDelay && (
            <div className="v5-note">
              <label className="v5-field"><span>Reason</span><select value={delay} onChange={(e) => setDelay(e.target.value)} data-testid="v5-delay-code">{['AWAITING_BUDGET', 'AWAITING_SCHEDULE', 'AWAITING_CONTRACT', 'RAINY_SEASON', 'TECHNICAL_REVIEW'].map((k) => <option key={k}>{k}</option>)}</select></label>
              <label className="v5-field"><span>Expected until</span><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} data-testid="v5-delay-until" /></label>
              <Reason value={reason} onChange={setReason} label="Public note" />
              <button type="button" className="v5-btn" disabled={t.busy} onClick={() => t.send('SET_PENDING', { reason, code: delay, until: new Date(until).toISOString(), note: reason })} data-testid="v5-set-pending">Publish reason</button>
            </div>
          )}
        </>
      )}
      {note && <p className="v5-good">{note}</p>}
      {account && <ErrorNote error={t.error} />}
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
  const place = { lat: c.location.latE6 / 1e6, lon: c.location.lonE6 / 1e6 };
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
    <Card title={`Measure on site, step ${step} of 4`} testId="v5-panel-inspect">
      {step === 1 && <Capture kind="OVERVIEW" caseId={c.id} purpose="INSPECTION" title="1. Overview" hint="Show the whole damage and the road around it." sampleId="pothole" demoPlace={place} onDone={setOverview} />}
      {step === 2 && <Capture kind="MARKER_NADIR" caseId={c.id} purpose="INSPECTION" title="2. Marker card" hint="Lay the 200 mm card next to the damage. Hold the phone straight above." sampleId="marker-card" demoPlace={place} onDone={setMarker} />}
      {step === 3 && <Capture kind="DEPTH_RULER" caseId={c.id} purpose="INSPECTION" title="3. Ruler at the deepest point" hint="Lay the straightedge across. Stand the ruler at the deepest point. Keep the numbers readable." sampleId="ruler" demoPlace={place} onDone={setRuler} />}
      {step === 4 && (
        <>
          {overview && <DetectionView evidence={overview} />}
          <p>Marker card: {marker?.marker?.found ? <><strong data-testid="v5-marker-found">found</strong>, size can count as measured <Chip kind="MEASURED" title={`${marker.marker.pxPerMm} px per mm`} /></> : <><strong data-testid="v5-marker-found">not found</strong>, size counts as an estimate <Chip kind="AI_ESTIMATE" /></>}</p>
          <label className="v5-field"><span>Is the AI right?</span>
            <select value={verdict} onChange={(e) => setVerdict(e.target.value)} data-testid="v5-verdict"><option value="CONFIRMED">Yes, confirmed</option><option value="DIFFERENT_CLASS">Different damage, I correct it</option><option value="NOT_FOUND">No damage here</option></select>
          </label>
          <label className="v5-field"><span>Damage class</span>
            <select value={cls} onChange={(e) => setCls(e.target.value)} data-testid="v5-class">{['POTHOLE', 'ALLIGATOR', 'LONG_CRACK', 'TRANS_CRACK', 'RUTTING_DEPRESSION', 'EDGE_BREAK', 'RAVELLING', 'PATCH_FAILURE', 'SEVERE_BREAKUP'].map((k) => <option key={k}>{k}</option>)}</select>
          </label>
          <div className="v5-row">
            <label className="v5-field"><span>Length (cm), from the card</span><input inputMode="decimal" value={lengthCm} onChange={(e) => setLengthCm(e.target.value)} data-testid="v5-length" /></label>
            <label className="v5-field"><span>Width (cm), from the card</span><input inputMode="decimal" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} data-testid="v5-width" /></label>
          </div>
          <label className="v5-field"><span>Depth (mm), as read from the ruler</span><input inputMode="numeric" value={depthMm} onChange={(e) => setDepthMm(e.target.value)} data-testid="v5-depth" /></label>
          <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy} onClick={submit} data-testid="v5-submit-inspection"><ClipboardCheck size={18} aria-hidden="true" /> Send inspection</button>
          <ErrorNote error={t.error} />
        </>
      )}
    </Card>
  );
}

const REPAIR_LABEL: Record<string, string> = { HOT_MIX_FULL_DEPTH_PATCH: 'Hot-mix full-depth patch', COLD_MIX_TEMPORARY: 'Cold-mix temporary patch', OVERLAY: 'Overlay', MILL_AND_INLAY: 'Mill and inlay', RECONSTRUCTION: 'Reconstruction', HOT_MIX_PATCH: 'Hot-mix patch' };

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
    <Card title="Expected life, fair cost, repair plan" testId="v5-panel-plan">
      <label className="v5-field"><span>Traffic load, ESAL per year <Chip kind="INPUT" /></span><input inputMode="numeric" value={esal} onChange={(e) => setEsal(e.target.value)} data-testid="v5-esal" /></label>
      <button type="button" className="v5-btn" disabled={action.busy} onClick={runPinn} data-testid="v5-run-pinn">{action.busy ? 'Working…' : 'Run physics model'}</button>
      <label className="v5-field"><span>Repair option, you decide <Chip kind="TODO_VERIFY" title="Suggestions follow a convention that is not sourced yet" /></span>
        <select value={repair} onChange={(e) => setRepair(e.target.value)} data-testid="v5-repair">{options.map((o) => <option key={o} value={o}>{REPAIR_LABEL[o] ?? o}</option>)}</select>
      </label>
      <button type="button" className="v5-btn" disabled={action.busy} onClick={runCost} data-testid="v5-run-cost">Calculate fair cost</button>
      <div className="v5-row">
        <label className="v5-field"><span>Urgency</span><select value={urgency} onChange={(e) => setUrgency(e.target.value)} data-testid="v5-urgency"><option>ROUTINE</option><option>PRIORITY</option><option>URGENT</option></select></label>
      </div>
      <label className="v5-field"><span>Why this repair</span><textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} data-testid="v5-rationale" /></label>
      <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy || !c.costRun} onClick={() => t.send('PROPOSE_PLAN', { repairType: repair, category: repair === 'COLD_MIX_TEMPORARY' ? 'TEMPORARY' : 'PERMANENT', urgency, rationale })} data-testid="v5-propose-plan">Propose plan</button>
      {!c.costRun && <p className="v5-caption">Calculate the fair cost first. The plan's quantities come from it.</p>}
      <ErrorNote error={action.error ?? t.error} />
    </Card>
  );
}

function ApprovePanel({ c, onChange }: PanelProps) {
  const t = useTransition(c, onChange);
  const { account, switchRole } = useV5();
  const [reason, setReason] = useState('');
  const [budget, setBudget] = useState('APBD');
  return (
    <Card title="Approve the plan" testId="v5-panel-approve">
      <Reason value={reason} onChange={setReason} />
      <label className="v5-field"><span>Budget source</span><select value={budget} onChange={(e) => setBudget(e.target.value)} data-testid="v5-budget">{['APBD', 'APBN', 'DANA_DESA', 'BUJT', 'OTHER'].map((k) => <option key={k}>{k}</option>)}</select></label>
      <div className="v5-row">
        <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy} onClick={() => t.send('APPROVE_PLAN', { reason, budgetSource: budget })} data-testid="v5-approve">Approve plan</button>
        <button type="button" className="v5-btn" disabled={t.busy} onClick={() => t.send('RETURN_PLAN', { reason })} data-testid="v5-return-plan">Return plan</button>
      </div>
      <ErrorNote error={t.error} />
      {t.error?.rule === 'SOD-2' && account?.accountId === 'ACC-INSPECT-AS-APPROVER' && (
        <button type="button" className="v5-link" onClick={() => switchRole('ACC-APPROVE')} data-testid="v5-switch-approver">Switch to the independent Approving Officer</button>
      )}
    </Card>
  );
}

function AcceptPanel({ c, onChange }: PanelProps) {
  const t = useTransition(c, onChange);
  const [reason, setReason] = useState('');
  const [months, setMonths] = useState('');
  return (
    <Card title="Accept the repair" testId="v5-panel-accept">
      <p>The supervisor checked the evidence. Accepting starts the follow-ups.</p>
      <Reason value={reason} onChange={setReason} />
      <label className="v5-field"><span>Maintenance period, months, from the contract if any <Chip kind="INPUT" /></span><input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} data-testid="v5-months" /></label>
      <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy} onClick={() => t.send('ACCEPT_WORK', { reason, ...(months ? { maintenanceMonths: Number(months) } : {}) })} data-testid="v5-accept-work">Accept repair</button>
      <ErrorNote error={t.error} />
    </Card>
  );
}

const STAGES: { code: string; label: string; hint: string; fields?: { key: string; label: string; unit?: string }[] }[] = [
  { code: 'BEFORE', label: 'Before', hint: 'Defect with the marker card and ruler, same framing as the inspection.' },
  { code: 'CUT_EDGES', label: 'Cut edges', hint: 'Square, vertical cuts into sound pavement, with a tape in view.', fields: [{ key: 'cutLengthCm', label: 'Cut length', unit: 'cm' }, { key: 'cutWidthCm', label: 'Cut width', unit: 'cm' }] },
  { code: 'CLEAN_DRY', label: 'Clean and dry', hint: 'Hole cleaned, dry, no standing water.' },
  { code: 'TACK_COAT', label: 'Tack coat', hint: 'Sprayed on the base and the edges.', fields: [{ key: 'material', label: 'Material' }] },
  { code: 'DELIVERY_TICKET', label: 'Delivery ticket', hint: 'Ticket readable in the photo.', fields: [{ key: 'mixType', label: 'Mix type' }, { key: 'weightKg', label: 'Weight', unit: 'kg' }] },
  { code: 'MIX_TEMP_TRUCK', label: 'Temperature, truck', hint: 'Thermometer reading and mix in one frame.', fields: [{ key: 'temperatureC', label: 'Temperature', unit: '°C' }] },
  { code: 'MIX_TEMP_MAT', label: 'Temperature, patch', hint: 'Reading on the spread mix as compaction starts.', fields: [{ key: 'temperatureC', label: 'Temperature', unit: '°C' }] },
  { code: 'LOOSE_THICKNESS', label: 'Loose thickness', hint: 'Ruler at the patch edge before compaction.', fields: [{ key: 'thicknessMm', label: 'Thickness', unit: 'mm' }] },
  { code: 'COMPACTION', label: 'Compaction', hint: 'Roller or plate on the patch.', fields: [{ key: 'passes', label: 'Passes' }] },
  { code: 'AFTER', label: 'After', hint: 'Finished patch with the straightedge across it.' }
];

function CrewPanel({ c, onChange }: PanelProps) {
  const t = useTransition(c, onChange);
  const [active, setActive] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [tonnage, setTonnage] = useState('');
  const [spend, setSpend] = useState('');
  const done = new Set(c.evidence.filter((e) => e.kind === 'WORK_STAGE').map((e) => e.stage));
  const stage = STAGES.find((s) => s.code === active);
  const place = { lat: c.location.latE6 / 1e6, lon: c.location.lonE6 / 1e6 };
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
    <Card title={`Evidence checklist: ${done.size} of ${STAGES.length}`} testId="v5-panel-crew">
      <p className="v5-caption">Photos prove process steps. They cannot prove density: only a core test can.</p>
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
          <Capture key={stage.code} kind="WORK_STAGE" stage={stage.code} caseId={c.id} purpose="WORK_STAGE" title={stage.label} hint={stage.hint} sampleId={`stage-${stage.code.toLowerCase().replace(/_/g, '-')}`} demoPlace={place} onDone={saveStage} />
        </div>
      )}
      {!started && <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy || !canStart} onClick={() => t.send('START_WORK', { evidenceIds: [] , evidence: undefined, useSavedStages: true })} data-testid="v5-start-work">Start repair</button>}
      {started && (
        <>
          <label className="v5-field"><span>Total mix used, kg, from tickets <Chip kind="INPUT" /></span><input inputMode="numeric" value={tonnage} onChange={(e) => setTonnage(e.target.value)} data-testid="v5-tonnage" /></label>
          <label className="v5-field"><span>Reported spend, rupiah <Chip kind="INPUT" /></span><input inputMode="numeric" value={spend} onChange={(e) => setSpend(e.target.value)} data-testid="v5-spend" /></label>
          <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy || missing.length > 0} onClick={() => t.send('SUBMIT_WORK_EVIDENCE', { useSavedStages: true, declared: { tonnageKg: Number(tonnage), reportedSpendIdr: Number(spend), areaCm2: c.plan?.areaCm2, thicknessMm: c.plan?.thicknessMm } })} data-testid="v5-submit-work">Send evidence</button>
          {missing.length > 0 && <p className="v5-caption">Still needed: {missing.map((m) => m.label).join(', ')}.</p>}
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
  const place = { lat: c.location.latE6 / 1e6, lon: c.location.lonE6 / 1e6 };
  const items = c.evidence.filter((e) => e.kind === 'WORK_STAGE');
  const toggle = (s: string) => setFails((f) => (f.includes(s) ? f.filter((x) => x !== s) : [...f, s]));
  return (
    <Card title="Check the repair evidence" testId="v5-panel-supervisor">
      <ul className="v5-review">
        {items.map((e) => (
          <li key={e.id} data-stage={e.stage}>
            <img src={apiUrl(`/api/v5/evidence/${e.id}/image`)} alt={e.stage ?? ''} loading="lazy" />
            <div>
              <strong>{e.stage}</strong>
              {e.values && <span className="v5-caption">{Object.entries(e.values).map(([k, v]) => `${k}: ${v}`).join(', ')} <Chip kind="INPUT" /></span>}
              <label className="v5-check"><input type="checkbox" checked={fails.includes(e.stage ?? '')} onChange={() => toggle(e.stage ?? '')} /> Fail this item</label>
            </div>
          </li>
        ))}
      </ul>
      {!own ? (
        <Capture kind="WORK_STAGE" stage="SUPERVISOR_AFTER" caseId={c.id} purpose="WORK_STAGE" title="Your own after-photo" hint="Take it yourself, on site, with the straightedge across the patch." sampleId="stage-supervisor-after" demoPlace={place} onDone={setOwn} />
      ) : (
        <p className="v5-good" data-testid="v5-own-photo">Your own photo is saved.</p>
      )}
      <Reason value={reason} onChange={setReason} label={fails.length ? 'Reason' : 'Reason (only if you reject)'} />
      <div className="v5-row">
        <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy || !own || fails.length > 0} onClick={() => t.send('VERIFY_WORK', { evidenceIds: [own!.id], failedStages: fails })} data-testid="v5-verify-work">Repair checked</button>
        <button type="button" className="v5-btn" disabled={t.busy} onClick={() => t.send('REJECT_WORK', { reason, failedStages: fails })} data-testid="v5-reject-work">Needs rework</button>
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
  const place = { lat: c.location.latE6 / 1e6, lon: c.location.lonE6 / 1e6 };
  if (open.length === 0) return <Card title="Follow-up inspection"><p className="v5-muted">Nothing assigned to inspectors now.</p></Card>;
  return (
    <Card title="Follow-up inspection" testId="v5-panel-followup">
      <label className="v5-field"><span>Which check</span><select value={milestone} onChange={(e) => setMilestone(e.target.value)} data-testid="v5-fu-milestone">{open.map((f) => <option key={f.milestone}>{f.milestone}</option>)}</select></label>
      <label className="v5-field"><span>Result</span><select value={result} onChange={(e) => setResult(e.target.value)} data-testid="v5-fu-result"><option value="OK">OK</option><option value="DEFECT">Defect found</option></select></label>
      {!photo ? <Capture kind="FOLLOW_UP" caseId={c.id} purpose="FOLLOW_UP" title="Photo with the straightedge" hint="Same framing as the repair." sampleId="pothole-2" demoPlace={place} onDone={setPhoto} /> : <button type="button" className="v5-btn v5-btn-primary" disabled={t.busy} onClick={() => t.send('RECORD_FOLLOW_UP', { milestone, result, evidenceIds: [photo.id] })} data-testid="v5-fu-send">Record follow-up</button>}
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
  const [doc, setDoc] = useState<{ id: string; sha256: string; pdfUrl: string; verifyUrl: string; version: number; isDemo: boolean } | null>(null);
  const [sim, setSim] = useState<{ changedSeq: number; changedField: string; report: Verify } | null>(null);
  const [wording, setWording] = useState('W-01');
  const [note, setNote] = useState('');
  const issue = () => action.run(async () => { setDoc(await v5('/documents/audit-report', { caseId: c.id })); reload(); });
  const simulate = () => action.run(async () => setSim(await v5('/demo/tamper-simulate', {})));
  const flag = () => action.run(async () => { const out = await v5<{ case: V5Case }>(`/cases/${c.id}/flags`, { wordingId: wording, note, code: 'AUDITOR_NOTE', value: '' }); setNote(''); onChange(out.case as Partial<StaffCase>); reload(); });
  return (
    <>
      <Card title="Independent Repair Audit Report" testId="v5-panel-audit">
        <p>Read-only: you can export and add a neutral note, nothing else.</p>
        <button type="button" className="v5-btn v5-btn-primary" disabled={action.busy} onClick={issue} data-testid="v5-issue-report"><FileText size={18} aria-hidden="true" /> {action.busy ? 'Printing…' : 'Make the PDF'}</button>
        {doc && (
          <div className="v5-note" data-testid="v5-doc">
            <p><strong data-testid="v5-doc-id">{doc.id}</strong> {doc.isDemo && <Chip kind="DEMO" />}</p>
            <p className="v5-caption">SHA-256 <code data-testid="v5-doc-hash">{doc.sha256}</code></p>
            <div className="v5-row">
              <a className="v5-btn" href={apiUrl(doc.pdfUrl)} target="_blank" rel="noreferrer" data-testid="v5-doc-pdf">Open PDF</a>
              <button type="button" className="v5-btn" onClick={() => go(doc.verifyUrl)} data-testid="v5-doc-verify">Verify it</button>
            </div>
          </div>
        )}
        <ErrorNote error={action.error} />
      </Card>

      <Card title="Add a neutral note" testId="v5-panel-flag">
        <label className="v5-field"><span>Wording, from the neutral library</span>
          <select value={wording} onChange={(e) => setWording(e.target.value)} data-testid="v5-wording"><option value="W-01">Mismatch to clarify</option><option value="W-10">Recommend a core test</option></select>
        </label>
        <label className="v5-field"><span>Note, optional</span><input value={note} onChange={(e) => setNote(e.target.value)} data-testid="v5-flag-note" /></label>
        <button type="button" className="v5-btn" disabled={action.busy} onClick={flag} data-testid="v5-add-flag">Add note</button>
        <p className="v5-caption">Notes attach to the case, never to a person. Accusing words are refused.</p>
      </Card>

      <Card title="Event log" testId="v5-events">
        {data && (
          <>
            <p className={data.verify.ok ? 'v5-good' : 'v5-bad'} data-testid="v5-chain-status"><ShieldCheck size={16} aria-hidden="true" /> {data.verify.ok ? `Intact. ${data.verify.checked} events checked on this chain.` : `Failed at event ${data.verify.firstFailure?.seq ?? 'end of log'}: ${data.verify.firstFailure?.status ?? 'newest events are missing'}.`} <Chip kind="COMPUTED" /></p>
            <ol className="v5-events">
              {data.events.map((e) => (
                <li key={e.seq}><span><Link2 size={12} aria-hidden="true" /> #{e.seq} {e.type}</span><span className="v5-caption">{when(e.server_received_at)} · {roleWord(e.actor.role)}{e.actor.overlap_basis ? ` · overlap: ${e.actor.overlap_basis}` : ''}</span><code>{e.event_hash.slice(0, 24)}…</code></li>
              ))}
            </ol>
            <button type="button" className="v5-btn" disabled={action.busy} onClick={simulate} data-testid="v5-tamper">See what tampering does</button>
            {sim && <p className="v5-bad" data-testid="v5-tamper-result">On a copy, we changed event #{sim.changedSeq} ({sim.changedField}). Result: {sim.report.ok ? 'not detected' : `verification fails at event ${sim.report.firstFailure?.seq}, ${sim.report.firstFailure?.status}`}. The real log was not touched. <Chip kind="DEMO" /></p>}
          </>
        )}
      </Card>
    </>
  );
}

function AuditorHome() {
  const { go } = useV5();
  const { data } = useLoad(() => v5<StaffCase[]>('/cases'));
  return (
    <Card title="All cases, read-only" testId="v5-queue">
      <div className="v5-empty"><RolePavi role="AUDITOR" /><p>You can read everything, export reports and add neutral notes. You cannot change a case.</p></div>
      <ul className="v5-list">
        {(data ?? []).map((c) => (
          <li key={c.id}><button type="button" onClick={() => go(`/v5/case/${c.id}`)} data-testid={`v5-open-${c.publicCode}`}><strong>{c.publicCode}</strong><span>{c.stateLabel}{c.isDemo ? ' · DEMO' : ''}</span></button></li>
        ))}
      </ul>
    </Card>
  );
}

function HeadHome() {
  const { go } = useV5();
  const { data } = useLoad(() => v5<{ totalCases: number; open: number; underWatch: number; levels: Record<string, number>; escalated: { id: string; publicCode: string; stateLabel: string; daysWaiting: number; level: string; office: string | null; delay: string | null }[]; overlaps: number }>('/dashboard/agency'));
  if (!data) return <Card><p>Loading…</p></Card>;
  return (
    <>
      <Card title="Agency overview" testId="v5-head">
        <div className="v5-empty"><RolePavi role="AGENCY_HEAD" /><p>Live counts from the case log. Sample cases only in demo mode <Chip kind="DEMO" /></p></div>
        <dl className="v5-dl">
          <dt>All cases</dt><dd>{data.totalCases} <Chip kind="COMPUTED" /></dd>
          <dt>Open</dt><dd>{data.open} <Chip kind="COMPUTED" /></dd>
          <dt>Repaired, under watch</dt><dd>{data.underWatch} <Chip kind="COMPUTED" /></dd>
          <dt>Past day 7</dt><dd>{data.levels.AGENCY_HEAD + data.levels.PUBLIC + data.levels.COMPLAINT} <Chip kind="COMPUTED" /></dd>
          <dt>Overlaps logged</dt><dd>{data.overlaps} <Chip kind="COMPUTED" /></dd>
        </dl>
      </Card>
      <Card title="Escalated to you">
        {data.escalated.length === 0 && <p className="v5-muted">No case has passed day 7.</p>}
        <ul className="v5-list">
          {data.escalated.map((e) => <li key={e.id}><button type="button" onClick={() => go(`/v5/case/${e.id}`)}><strong>{e.publicCode}</strong><span>{e.stateLabel} · {e.daysWaiting} days <Chip kind="COMPUTED" /> · {e.office}{e.delay ? ` · delay: ${e.delay}` : ''}</span></button></li>)}
        </ul>
      </Card>
    </>
  );
}

function AdminHome() {
  const { data, error } = useLoad(() => v5<{ registry: { version: string; attribution: string }; offices: { total: number; byStatus: Record<string, number>; list: { id: string; name: string; type: string; status: string }[] }; prices: { total: number; byStatus: Record<string, number>; list: { id: string; item: string; unit: string; priceIdr: number; region: string; status: string; source: string }[] }; wages: { ump: number; umkTodo: number }; note: string }>('/admin/overview'));
  if (error) return <Card><p>{error.message}</p></Card>;
  if (!data) return <Card><p>Loading…</p></Card>;
  return (
    <>
      <Card title="Region data" testId="v5-admin">
        <div className="v5-empty"><RolePavi role="ADMIN" /><p>{data.note} Admins cannot change a case.</p></div>
        <p>Road registry: {data.registry.version}. {data.registry.attribution}</p>
        <p>Offices: {data.offices.total}, {Object.entries(data.offices.byStatus).map(([k, v]) => `${v} ${k}`).join(', ')} <Chip kind="COMPUTED" /></p>
        <p>Wages: {data.wages.ump} provinces loaded, {data.wages.umkTodo} regencies still to verify <Chip kind="TODO_VERIFY" /></p>
      </Card>
      <Card title="Prices with a value, and their sources">
        <table className="v5-table">
          <thead><tr><th>Item</th><th>Price</th><th>Label</th></tr></thead>
          <tbody>{data.prices.list.map((p) => <tr key={p.id}><td>{p.item}<br /><span className="v5-caption">{p.region}</span></td><td>{rupiah(p.priceIdr)}/{p.unit}</td><td>{['OFFICIAL', 'ASSUMED', 'TODO_VERIFY', 'INPUT'].includes(p.status) ? <Chip kind={p.status as ChipKind} /> : <Chip kind="ASSUMED" title={p.status} />}</td></tr>)}</tbody>
        </table>
      </Card>
    </>
  );
}
