/**
 * v5 case store: a JSON snapshot next to the append-only event log (07 §2.3). The event is written
 * first, then the snapshot, and the snapshot records the chain head, so a truncated or rolled-back
 * log is detected even though each remaining event still verifies.
 */
import { randomBytes, randomUUID, sign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyCommand, isV5Failure, type CommandContext, type V5Command, type V5Failure } from '../../src/domain/v5/stateMachine';
import { blankCase, type V5Actor, type V5Case } from '../../src/domain/v5/model';
import { EventChain, KEY_ID, sha256Hex, type ChainEvent, type ChainId, type VerifyReport } from './chain';
import { checkpointText, merkleRoot } from './merkle';

export interface Checkpoint {
  chainId: ChainId;
  period: string;
  firstSeq: number;
  lastSeq: number;
  root: string;
  prev: string;
  time: string;
  signedText: string;
  checkpointHash: string;
  sig: string;
  keyId: string;
}

export interface IssuedDocument {
  id: string;
  kind: 'AUDIT_REPORT';
  caseId: string;
  publicCode: string;
  version: number;
  supersedes: string | null;
  supersededBy: string | null;
  sha256: string;
  issuedAt: string;
  filePath: string;
  snapshot: { chainId: string; firstSeq: number; lastSeq: number; root: string; period: string; time: string; lastCaseSeq: number };
}

interface Snapshot {
  cases: Record<string, V5Case>;
  heads: Partial<Record<ChainId, { seq: number; hash: string }>>;
  checkpoints: Checkpoint[];
  documents: IssuedDocument[];
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
  private snapshot: Snapshot = { cases: {}, heads: {}, checkpoints: [], documents: [] };
  private readonly file: string;

  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.chain = new EventChain(dir);
    this.file = path.join(dir, 'cases.json');
    if (fs.existsSync(this.file)) this.snapshot = { ...this.snapshot, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
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

  private chainEvent(c: V5Case, type: string, payload: Record<string, unknown>, actor: V5Actor, now: string, refs: Partial<ChainEvent['refs']>, overlapBasis: string | null): ChainEvent {
    const event = this.chain.append(c.chainId, {
      type,
      entity: { type: 'case', id: c.id },
      actor: { ref: this.chain.actorRef(actor.kind, actor.personId ?? actor.accountId), role: actor.role, kind: actor.kind, overlap_basis: overlapBasis },
      server_received_at: now,
      payload,
      refs
    });
    this.snapshot.heads[c.chainId] = { seq: event.seq, hash: event.event_hash };
    return event;
  }

  /** Runs one command through the state machine and chains its event. */
  apply(c: V5Case, cmd: V5Command, actor: V5Actor, now: string, expectedVersion: number, extra: Partial<CommandContext> = {}): TransitionOutcome | V5Failure {
    const result = applyCommand(c, cmd, { actor, now, expectedVersion, ...extra });
    if (isV5Failure(result)) return result;
    const event = this.chainEvent(result.next, result.event.type, result.event.payload, actor, now, { evidence_sha256: result.event.evidenceSha256, prev_state: result.event.prevState, next_state: result.event.nextState }, result.event.overlapBasis);
    this.snapshot.cases[result.next.id] = result.next;
    this.save();
    return { case: result.next, event };
  }

  /** An analysis or note that does not change the state: chained, and no version bump. */
  record(c: V5Case, patch: Partial<V5Case>, type: string, payload: Record<string, unknown>, actor: V5Actor, now: string, evidenceSha256: string[] = []): V5Case {
    this.chainEvent(c, type, payload, actor, now, { evidence_sha256: evidenceSha256, prev_state: c.state, next_state: c.state }, null);
    const next = { ...(this.snapshot.cases[c.id] ?? c), ...patch };
    this.snapshot.cases[c.id] = next;
    this.save();
    return next;
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

  /** Ad hoc checkpoint before a document is issued (07 §4.3). Signed; a chain of checkpoints. */
  addCheckpoint(chainId: ChainId, eventHashes: string[], time: string): Checkpoint {
    const previous = [...this.snapshot.checkpoints].reverse().find((c) => c.chainId === chainId);
    const fields = { chainId, period: `adhoc:${time}`, firstSeq: 1, lastSeq: eventHashes.length, root: merkleRoot(eventHashes), prev: previous?.checkpointHash ?? '0'.repeat(64), time };
    const signedText = checkpointText(fields);
    const checkpoint: Checkpoint = { ...fields, signedText, checkpointHash: sha256Hex(signedText), sig: sign(null, Buffer.from(signedText, 'utf8'), this.chain.signingKey).toString('base64'), keyId: KEY_ID };
    this.snapshot.checkpoints.push(checkpoint);
    this.save();
    return checkpoint;
  }

  checkpoints(): Checkpoint[] {
    return this.snapshot.checkpoints;
  }

  addDocument(doc: IssuedDocument): void {
    this.snapshot.documents.push(doc);
    this.save();
  }

  documents(): IssuedDocument[] {
    return this.snapshot.documents;
  }

  document(id: string): IssuedDocument | null {
    return this.snapshot.documents.find((d) => d.id === id) ?? null;
  }

  documentsFor(caseId: string): IssuedDocument[] {
    return this.snapshot.documents.filter((d) => d.caseId === caseId);
  }
}
