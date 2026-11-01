/**
 * Hash-chained, signed event log (07_AUDIT_INTEGRITY.md §2-§3). Append-only JSONL.
 * Personal data never enters the log: actor refs are
 * HMACs, payloads hold ids, codes, integers and moderated text.
 */
import { createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type ChainId = 'prod';

export const GENESIS_HASH = '0'.repeat(64);
const EVENT_DOMAIN = 'PPINN-EVT-v1\n';
export const KEY_ID = 'srv-2026-01';

/**
 * RFC 8785 JSON Canonicalization: keys sorted by UTF-16 code units (the default sort), no
 * whitespace, ECMAScript number and string serialisation (JSON.stringify). Non-finite numbers
 * and undefined values have no canonical form and are refused.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite numbers cannot be canonicalized');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const parts = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
    return `{${parts.join(',')}}`;
  }
  throw new Error(`Cannot canonicalize ${typeof value}`);
}

export const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** Throws on any non-integer number: money, measures and scores are integers in the log (07 §2.1). */
export function assertIntegerPayload(value: unknown, where = 'payload'): void {
  if (typeof value === 'number' && !Number.isInteger(value)) throw new Error(`${where} holds a non-integer number: ${value}`);
  if (Array.isArray(value)) value.forEach((v, i) => assertIntegerPayload(v, `${where}[${i}]`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) assertIntegerPayload(v, `${where}.${k}`);
}

export interface ChainEvent {
  v: 1;
  chain_id: ChainId;
  seq: number;
  event_id: string;
  type: string;
  entity: { type: string; id: string };
  actor: { ref: string; role: string; kind: string; overlap_basis: string | null };
  server_received_at: string;
  payload: Record<string, unknown>;
  payload_sha256: string;
  refs: { evidence_sha256: string[]; corrects_event_hash: string | null; prev_state: string | null; next_state: string | null };
  prev_hash: string;
  event_hash: string;
  sig: { alg: 'Ed25519'; key_id: string; value: string };
}

export type EventDraft = Pick<ChainEvent, 'type' | 'entity' | 'server_received_at' | 'payload'> & {
  actor: { ref: string; role: string; kind: string; overlap_basis?: string | null };
  refs?: Partial<ChainEvent['refs']>;
};

export function hashEventBody(event: Omit<ChainEvent, 'event_hash' | 'sig'> & Partial<Pick<ChainEvent, 'event_hash' | 'sig'>>): string {
  const { event_hash: _hash, sig: _sig, ...body } = event;
  return sha256Hex(EVENT_DOMAIN + canonicalize(body));
}

export type EventStatus = 'OK' | 'HASH_MISMATCH' | 'LINK_BROKEN' | 'BAD_SIGNATURE' | 'SEQ_GAP' | 'UNREADABLE';

export interface VerifyReport {
  ok: boolean;
  chainId: ChainId;
  checked: number;
  headHash: string;
  firstFailure: { seq: number; status: EventStatus; line: number } | null;
}

/** Verifies raw JSONL so a byte edited anywhere in a stored line is seen (07 §3.3, IN-1, IN-2). */
export function verifyChainText(chainId: ChainId, text: string, publicKey: KeyObject): VerifyReport {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  const failure = (seq: number, status: EventStatus, line: number): VerifyReport => ({ ok: false, chainId, checked: line - 1, headHash: prevHash, firstFailure: { seq, status, line } });
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let e: ChainEvent;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      return failure(expectedSeq, 'UNREADABLE', lineNo);
    }
    // A hash mismatch at this seq comes first: an edit must be pinned to the edited event.
    const recomputed = hashEventBody(e);
    if (recomputed !== e.event_hash || sha256Hex(canonicalize(e.payload)) !== e.payload_sha256) return failure(e.seq, 'HASH_MISMATCH', lineNo);
    if (e.prev_hash !== prevHash) return failure(e.seq, 'LINK_BROKEN', lineNo);
    if (e.seq !== expectedSeq) return failure(e.seq, 'SEQ_GAP', lineNo);
    if (!verify(null, Buffer.from(e.event_hash, 'utf8'), publicKey, Buffer.from(e.sig.value, 'base64'))) return failure(e.seq, 'BAD_SIGNATURE', lineNo);
    prevHash = e.event_hash;
    expectedSeq++;
  }
  return { ok: true, chainId, checked: lines.length, headHash: prevHash, firstFailure: null };
}

/** One appender per chain. Appends are synchronous, so `seq` and `prev_hash` stay gap-free. */
export class EventChain {
  private head = new Map<ChainId, { seq: number; hash: string }>();
  private readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  get signingKey(): KeyObject { return this.privateKey; }
  private readonly logPepper: string;

  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    const keyFile = path.join(dir, 'signing-key.pem');
    if (!fs.existsSync(keyFile)) {
      const { privateKey } = generateKeyPairSync('ed25519');
      fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o400 });
    }
    this.privateKey = createPrivateKey(fs.readFileSync(keyFile));
    this.publicKey = createPublicKey(this.privateKey);
    const pepperFile = path.join(dir, 'log-pepper');
    if (!fs.existsSync(pepperFile)) fs.writeFileSync(pepperFile, randomUUID(), { mode: 0o400 });
    this.logPepper = fs.readFileSync(pepperFile, 'utf8');
  }

  fileFor(chainId: ChainId): string {
    return path.join(this.dir, `events-${chainId}.jsonl`);
  }

  /** `staff:` / `dev:` + HMAC, so the log never names a person (07 §2.1). */
  actorRef(kind: 'PERSON' | 'DEVICE' | 'SYSTEM', id: string): string {
    if (kind === 'SYSTEM') return id;
    const prefix = kind === 'PERSON' ? 'staff' : 'dev';
    return `${prefix}:${createHmac('sha256', this.logPepper).update(id).digest('hex').slice(0, 32)}`;
  }

  private readHead(chainId: ChainId): { seq: number; hash: string } {
    const known = this.head.get(chainId);
    if (known) return known;
    const text = this.readText(chainId);
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    let current = { seq: 0, hash: GENESIS_HASH };
    if (lines.length > 0) {
      const last: ChainEvent = JSON.parse(lines[lines.length - 1]);
      current = { seq: last.seq, hash: last.event_hash };
    }
    this.head.set(chainId, current);
    return current;
  }

  readText(chainId: ChainId): string {
    const file = this.fileFor(chainId);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  }

  append(chainId: ChainId, draft: EventDraft): ChainEvent {
    assertIntegerPayload(draft.payload);
    const head = this.readHead(chainId);
    const body: Omit<ChainEvent, 'event_hash' | 'sig'> = {
      v: 1,
      chain_id: chainId,
      seq: head.seq + 1,
      event_id: randomUUID(),
      type: draft.type,
      entity: draft.entity,
      actor: { ref: draft.actor.ref, role: draft.actor.role, kind: draft.actor.kind, overlap_basis: draft.actor.overlap_basis ?? null },
      server_received_at: draft.server_received_at,
      payload: draft.payload,
      payload_sha256: sha256Hex(canonicalize(draft.payload)),
      refs: { evidence_sha256: draft.refs?.evidence_sha256 ?? [], corrects_event_hash: draft.refs?.corrects_event_hash ?? null, prev_state: draft.refs?.prev_state ?? null, next_state: draft.refs?.next_state ?? null },
      prev_hash: head.hash
    };
    const event_hash = hashEventBody(body);
    const event: ChainEvent = { ...body, event_hash, sig: { alg: 'Ed25519', key_id: KEY_ID, value: sign(null, Buffer.from(event_hash, 'utf8'), this.privateKey).toString('base64') } };
    const fd = fs.openSync(this.fileFor(chainId), 'a');
    try {
      fs.writeSync(fd, `${JSON.stringify(event)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    this.head.set(chainId, { seq: event.seq, hash: event.event_hash });
    return event;
  }

  events(chainId: ChainId): ChainEvent[] {
    return this.readText(chainId).split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  }

  verify(chainId: ChainId): VerifyReport {
    return verifyChainText(chainId, this.readText(chainId), this.publicKey);
  }

  /** Forgets the cached head; the file is re-read on the next append. */
  reloadHead(chainId: ChainId): void {
    this.head.delete(chainId);
  }
}
