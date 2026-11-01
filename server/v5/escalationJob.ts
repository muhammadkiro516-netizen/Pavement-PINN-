import { ladderStatus } from '../../src/domain/v5/escalation';
import { SYSTEM_ACTOR } from '../../src/domain/v5/stateMachine';
import type { V5Store } from './store';

/**
 * Writes each ladder step a waiting case has reached to the log, once. It never changes a case
 * state: escalation only tells people the case is waiting (02 §3.4).
 */
export function sweepEscalations(store: V5Store, now: string): number {
  let written = 0;
  for (const c of store.list()) {
    const reached = ladderStatus(c, now).steps.filter((s) => s.reached);
    if (reached.length === 0) continue;
    // A new ladder start (a reopened case) counts its steps again.
    const startMs = new Date(c.ladderStartAt).getTime();
    const done = new Set(store.eventsFor(c.id, c.chainId)
      .filter((e) => e.type === 'escalation.reached' && new Date(e.server_received_at).getTime() >= startMs)
      .map((e) => e.payload.level));
    for (const step of reached) {
      if (done.has(step.level)) continue;
      store.record(c, {}, 'escalation.reached', { level: step.level, day: step.day }, SYSTEM_ACTOR, now);
      written += 1;
    }
  }
  return written;
}
