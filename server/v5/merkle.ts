/**
 * Checkpoints over the event log (07 §4): RFC 6962 Merkle tree with an audit path per event, and a
 * signed line-based checkpoint. Bitcoin anchoring with OpenTimestamps is not built, so the checkpoint
 * says so rather than implying a timestamp it lacks.
 */
import { createHash } from 'node:crypto';

const sha = (...parts: Buffer[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

export const leafHash = (eventHashHex: string) => sha(Buffer.from([0x00]), Buffer.from(eventHashHex, 'utf8'));
const nodeHash = (l: Buffer, r: Buffer) => sha(Buffer.from([0x01]), l, r);

function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function mth(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) return sha();
  if (leaves.length === 1) return leaves[0];
  const k = splitPoint(leaves.length);
  return nodeHash(mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

export const merkleRoot = (eventHashes: string[]) => mth(eventHashes.map(leafHash)).toString('hex');

/** RFC 6962 §2.1.1 audit path, deepest sibling first. */
export function inclusionProof(eventHashes: string[], index: number): string[] {
  const walk = (leaves: Buffer[], m: number): Buffer[] => {
    if (leaves.length <= 1) return [];
    const k = splitPoint(leaves.length);
    return m < k ? [...walk(leaves.slice(0, k), m), mth(leaves.slice(k))] : [...walk(leaves.slice(k), m - k), mth(leaves.slice(0, k))];
  };
  return walk(eventHashes.map(leafHash), index).map((b) => b.toString('hex'));
}

export function verifyInclusion(eventHash: string, index: number, size: number, path: string[], root: string): boolean {
  let fn = index;
  let sn = size - 1;
  let hash = leafHash(eventHash);
  for (const step of path) {
    const sibling = Buffer.from(step, 'hex');
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      hash = nodeHash(sibling, hash);
      if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) { fn >>= 1; sn >>= 1; }
    } else {
      hash = nodeHash(hash, sibling);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && hash.toString('hex') === root;
}

export function checkpointText(c: { chainId: string; period: string; firstSeq: number; lastSeq: number; root: string; prev: string; time: string }): string {
  return ['pavement-pinn checkpoint v1', `chain: ${c.chainId}`, `period: ${c.period}`, `range: ${c.firstSeq}-${c.lastSeq}`, `root: ${c.root}`, `prev: ${c.prev}`, `time: ${c.time}`].join('\n');
}
