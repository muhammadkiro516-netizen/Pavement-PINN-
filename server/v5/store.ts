/**
 * v5 case store: a JSON snapshot next to the append-only event log (07 §2.3). The event is written
 * first, then the snapshot, and the snapshot records the chain head, so a truncated or rolled-back
 * log is detected even though each remaining event still verifies.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyCommand, isV5Failure, type CommandContext, type V5Command, type V5Failure } from '../../src/domain/v5/stateMachine';
import { blankCase, type V5Actor, type V5Case } from '../../src/domain/v5/model';
import { EventChain, type ChainEvent, type ChainId, type VerifyReport } from './chain';

interface Snapshot {
  cases: Record<string, V5Case>;
  heads: Partial<Record<ChainId, { seq: number; hash: string }>>;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(prefix: string): string {
  const bytes = randomBytes(6);
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${prefix}-${code}`;
}

export interface TransitionOutcome {
  case: V5Case;
  event: ChainEvent;
}

export class V5Store {
  readonly chain: EventChain;
  private snapshot: Snapshot = { cases: {}, heads: {} };
  private readonly file: string;

  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.chain = new EventChain(dir);
    this.file = path.join(dir, 'cases.json');
    if (fs.existsSync(this.file)) this.snapshot = JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.snapshot));
    fs.renameSync(tmp, this.file);
  }

  get(id: string): V5Case | null {
    return this.snapshot.cases[id] ?? null;
  }

  byPublicCode(code: string): V5Case | null {
    return this.list().find((c) => c.publicCode === code) ?? null;
  }

  list(): V5Case[] {
    return Object.values(this.snapshot.cases);
  }

  /** Runs one command through the state machine and chains its event. */
  apply(c: V5Case, cmd: V5Command, actor: V5Actor, now: string, expectedVersion: number, extra: Partial<CommandContext> = {}): TransitionOutcome | V5Failure {
    const result = applyCommand(c, cmd, { actor, now, expectedVersion, ...extra });
    if (isV5Failure(result)) return result;
    const event = this.chain.append(result.next.chainId, {
      type: result.event.type,
      entity: { type: 'case', id: result.next.id },
      actor: { ref: this.chain.actorRef(actor.kind, actor.personId ?? actor.accountId), role: actor.role, kind: actor.kind, overlap_basis: result.event.overlapBasis },
      server_received_at: now,
      payload: result.event.payload,
      refs: { evidence_sha256: result.event.evidenceSha256, prev_state: result.event.prevState, next_state: result.event.nextState }
    });
    this.snapshot.cases[result.next.id] = result.next;
    this.snapshot.heads[result.next.chainId] = { seq: event.seq, hash: event.event_hash };
    this.save();
    return { case: result.next, event };
  }

  /** Starts a case in memory; it exists only once its SUBMIT event is chained. */
  newCase(fields: Omit<Parameters<typeof blankCase>[0], 'id' | 'publicCode'>, codePrefix: string): V5Case {
    return blankCase({ ...fields, id: `CASE-${randomUUID().replace(/-/g, '').slice(0, 16)}`, publicCode: randomCode(codePrefix) });
  }

  eventsFor(caseId: string, chainId: ChainId): ChainEvent[] {
    return this.chain.events(chainId).filter((e) => e.entity.id === caseId);
  }

  /** Full chain check, plus the recorded head so removing the newest events is also caught. */
  verify(chainId: ChainId): VerifyReport & { truncated: boolean } {
    const report = this.chain.verify(chainId);
    const head = this.snapshot.heads[chainId];
    const truncated = report.ok && !!head && (report.checked !== head.seq || report.headHash !== head.hash);
    return { ...report, ok: report.ok && !truncated, truncated };
  }
}
