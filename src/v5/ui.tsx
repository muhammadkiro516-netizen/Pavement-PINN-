/** Shared v5 pieces: honesty chips, role mascot, money, ladder and timeline. */
import { useEffect, useState, type ReactNode } from 'react';
import { Pavi, type PaviMood } from '../components/brand/Pavi';
import type { V5Role } from '../domain/v5/model';

export type ChipKind = 'MEASURED' | 'OFFICIAL' | 'INPUT' | 'ASSUMED' | 'AI_ESTIMATE' | 'TODO_VERIFY' | 'DEMO' | 'COMPUTED' | 'NOT_MEASURED';

const CHIP_TEXT: Record<ChipKind, string> = { MEASURED: 'MEASURED', OFFICIAL: 'OFFICIAL', INPUT: 'INPUT', ASSUMED: 'ASSUMED', AI_ESTIMATE: 'AI ESTIMATE', TODO_VERIFY: 'TODO VERIFY', DEMO: 'DEMO', COMPUTED: 'COMPUTED', NOT_MEASURED: 'NOT MEASURED YET' };

/** The label beside every number on screen (02 conventions). */
export function Chip({ kind, title }: { kind: ChipKind; title?: string }) {
  return <span className={`v5-chip v5-chip-${kind.toLowerCase()}`} title={title}>{CHIP_TEXT[kind]}</span>;
}

/** Colours from 09 §7. */
const PAVI_LOOK: Record<V5Role, { helmet: string; vest: string; name: string }> = {
  CITIZEN: { helmet: '#FFC72C', vest: '#FFFFFF', name: 'Citizen Pavi' },
  FIELD_INSPECTOR: { helmet: '#FF7A1A', vest: '#FFC72C', name: 'Inspector Pavi' },
  COORDINATOR: { helmet: '#0068B5', vest: '#FFFFFF', name: 'Coordinator Pavi' },
  APPROVER: { helmet: '#0D1015', vest: '#FFC72C', name: 'Approver Pavi' },
  REPAIR_CREW: { helmet: '#FFC72C', vest: '#FF7A1A', name: 'Crew Pavi' },
  SUPERVISOR: { helmet: '#12A06A', vest: '#FFFFFF', name: 'Supervisor Pavi' },
  AUDITOR: { helmet: '#FFFFFF', vest: '#0A9CC2', name: 'Auditor Pavi' },
  AGENCY_HEAD: { helmet: '#0D1015', vest: '#FFC72C', name: 'Agency Head Pavi' },
  ADMIN: { helmet: '#475569', vest: '#FFFFFF', name: 'Admin Pavi' }
};

export function RolePavi({ role, mood = 'idle', size = 64 }: { role: V5Role; mood?: PaviMood; size?: number }) {
  const look = PAVI_LOOK[role];
  return <span className={`v5-pavi v5-pavi-${mood}`} aria-hidden="true"><Pavi size={size} mood={mood} helmet={look.helmet} vest={look.vest} /></span>;
}

export const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('en-US')}`;

export function when(iso: string | null | undefined): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB';
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
}

export function Card({ title, children, testId, actions }: { title?: ReactNode; children: ReactNode; testId?: string; actions?: ReactNode }) {
  return (
    <section className="v5-card" data-testid={testId}>
      {(title || actions) && <div className="v5-card-head">{title && <h2>{title}</h2>}{actions}</div>}
      {children}
    </section>
  );
}

export function Confidence({ level }: { level: 'HIGH' | 'MEDIUM' | 'LOW' }) {
  const text = { HIGH: 'High confidence', MEDIUM: 'Medium confidence', LOW: 'Low confidence' }[level];
  return <span className={`v5-conf v5-conf-${level.toLowerCase()}`}>{text}</span>;
}

export interface LadderView {
  daysWaiting: number;
  level: string | null;
  paused: boolean;
  applies: boolean;
  steps: { day: number; level: string; label: string; reached: boolean }[];
}

export function Ladder({ ladder }: { ladder: LadderView }) {
  if (!ladder.applies) return <p className="v5-muted">The escalation clock has stopped: this case is no longer open.</p>;
  return (
    <div data-testid="v5-ladder">
      <p><strong data-testid="v5-days-waiting">{ladder.paused ? 'Clock paused by a delay reason' : `${ladder.daysWaiting} day${ladder.daysWaiting === 1 ? '' : 's'} waiting`}</strong> <Chip kind="COMPUTED" title="Counted from the first report. Internal target, not law." /></p>
      <ol className="v5-ladder">
        {ladder.steps.map((s) => (
          <li key={s.level} className={s.reached ? 'is-reached' : ''} data-reached={s.reached}>
            <span className="v5-ladder-day">Day {s.day}</span>
            <span>{s.label}</span>
          </li>
        ))}
      </ol>
      <p className="v5-caption">Days are internal targets, configurable, not law. <Chip kind="ASSUMED" title="02 §3.5" /></p>
    </div>
  );
}

export interface TimelineItem { type: string; label: string; at: string; role: string; hash: string; state?: string | null }

const ROLE_WORD: Record<string, string> = { CITIZEN: 'Citizen', FIELD_INSPECTOR: 'Field Inspector', COORDINATOR: 'Coordinator', APPROVER: 'Approver', REPAIR_CREW: 'Repair Crew', SUPERVISOR: 'Supervisor', AUDITOR: 'Auditor', AGENCY_HEAD: 'Agency Head', ADMIN: 'Admin', SYSTEM: 'System' };
export const roleWord = (r: string) => ROLE_WORD[r] ?? r;

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="v5-timeline" data-testid="v5-timeline">
      {items.map((e, i) => (
        <li key={`${e.hash}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
          <strong>{e.label}</strong>
          <span className="v5-caption">{when(e.at)} · {roleWord(e.role)} · <code title="Hash of this event in the log">{e.hash}</code></span>
        </li>
      ))}
    </ol>
  );
}

export function ErrorNote({ error }: { error: { message: string; rule?: string } | null }) {
  if (!error) return null;
  return <p className="v5-error" role="alert" data-testid="v5-error">{error.rule && <strong>{error.rule}: </strong>}{error.message}</p>;
}

/** Runs an async action with one busy flag and one error slot. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; rule?: string } | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e as { message: string; rule?: string });
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

/** Polls nothing: loads once and on demand. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    load().then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(e); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((t) => t + 1), setData };
}
