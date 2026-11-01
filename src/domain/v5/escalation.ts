/**
 * Public escalation ladder (02 §3.5): day 2 Coordinator, day 7 Agency Head, day 14 public label,
 * day 30 complaint draft. Counted from the oldest report, paused by a valid delay reason, restarted
 * from the end of that delay. The ladder is an internal target, configurable, not law.
 */
import { V5_STATE_LABELS, type V5Case } from './model';

export const LADDER = [
  { day: 2, level: 'COORDINATOR', label: 'Coordinator notified' },
  { day: 7, level: 'AGENCY_HEAD', label: 'Agency Head notified' },
  { day: 14, level: 'PUBLIC', label: 'Not handled for more than 14 days' },
  { day: 30, level: 'COMPLAINT', label: 'Complaint draft available' }
] as const;

export type LadderLevel = (typeof LADDER)[number]['level'];

export interface LadderStatus {
  daysWaiting: number;
  level: LadderLevel | null;
  /** Each rung, with whether it has been reached. */
  steps: { day: number; level: LadderLevel; label: string; reached: boolean }[];
  paused: boolean;
  applies: boolean;
}

const DAY_MS = 86_400_000;

export function ladderStatus(c: Pick<V5Case, 'state' | 'ladderStartAt' | 'pending'>, now: string): LadderStatus {
  const nowMs = new Date(now).getTime();
  // Temporary patches run on their own permanent-repair clock (02 §3.4), not on this ladder.
  const applies = !!c.state && V5_STATE_LABELS[c.state].open && c.state !== 'REPAIRED_TEMPORARY';
  const until = c.pending ? new Date(c.pending.until).getTime() : null;
  const paused = until !== null && until > nowMs;
  const startMs = until !== null && until <= nowMs ? until : new Date(c.ladderStartAt).getTime();
  const daysWaiting = paused ? 0 : Math.max(0, Math.floor((nowMs - startMs) / DAY_MS));
  const steps = LADDER.map((s) => ({ ...s, reached: applies && !paused && daysWaiting >= s.day }));
  const reached = steps.filter((s) => s.reached);
  return { daysWaiting, level: reached.length ? reached[reached.length - 1].level : null, steps, paused, applies };
}
