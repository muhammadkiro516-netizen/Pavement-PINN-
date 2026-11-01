/**
 * Follow-up schedule (08_REPAIR_VERIFICATION.md §4). The intervals are literature-based design
 * choices, not validated with Indonesian road authorities, and the UI must say so.
 */
import type { FollowUpMilestone, V5FollowUp } from './model';

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString();
}

const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();

function item(caseId: string, milestone: FollowUpMilestone, dueAt: string | null, windowDays: number, trigger: string, assigneeRole: V5FollowUp['assigneeRole']): V5FollowUp {
  return { id: `FU-${caseId}-${milestone}`, milestone, dueAt, windowDays, trigger, assigneeRole, result: null, source: null, recordedAt: null };
}

/**
 * T0 is the acceptance date, or the PHO date on contracts. Temporary patches only get M1 and
 * HEAVY_RAIN. Milestones within 14 days of each other are merged, keeping the stricter one.
 */
export function followUpSchedule(caseId: string, t0: string, category: 'TEMPORARY' | 'PERMANENT', maintenanceMonths?: number | null): V5FollowUp[] {
  const rain = item(caseId, 'HEAVY_RAIN', null, 14, 'First sustained heavy rain after the repair (threshold TODO_VERIFY: BMKG rainfall categories)', 'FIELD_INSPECTOR');
  const m1 = item(caseId, 'M1', addMonths(t0, 1), 7, '1 month after the repair', 'CITIZEN');
  if (category === 'TEMPORARY') return [m1, rain];

  const dated: V5FollowUp[] = [m1, item(caseId, 'M3', addMonths(t0, 3), 10, '3 months after the repair', 'FIELD_INSPECTOR'), item(caseId, 'M6', addMonths(t0, 6), 14, '6 months after the repair', 'CITIZEN')];
  if (maintenanceMonths && maintenanceMonths > 0) {
    dated.push(item(caseId, 'PRE_FHO', addDays(addMonths(t0, maintenanceMonths), -21), 7, '21 days before the maintenance period ends', 'INSPECTOR_AND_SUPERVISOR'));
  }
  return [...mergeClose(dated), rain];
}

const STRICTNESS: Readonly<Record<V5FollowUp['assigneeRole'], number>> = { CITIZEN: 0, FIELD_INSPECTOR: 1, INSPECTOR_AND_SUPERVISOR: 2 };

function mergeClose(items: V5FollowUp[]): V5FollowUp[] {
  const sorted = [...items].sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  const merged: V5FollowUp[] = [];
  for (const next of sorted) {
    const last = merged[merged.length - 1];
    const closeDays = last ? (new Date(next.dueAt!).getTime() - new Date(last.dueAt!).getTime()) / 86_400_000 : Infinity;
    if (last && closeDays <= 14) {
      if (STRICTNESS[next.assigneeRole] > STRICTNESS[last.assigneeRole]) merged[merged.length - 1] = next;
    } else {
      merged.push(next);
    }
  }
  return merged;
}

export const followUpIsDue = (f: V5FollowUp, now: string) => !f.result && f.dueAt !== null && f.dueAt <= now;
export const followUpIsOverdue = (f: V5FollowUp, now: string) => !f.result && f.dueAt !== null && addDays(f.dueAt, f.windowDays) < now;
