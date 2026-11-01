/**
 * Live capture and evidence (05 §3). One-time nonce, server time, GPS and motion checks, perceptual
 * hash, EXIF strip, face blur, encrypted original. In DEMO MODE a failed check is shown as "would be
 * rejected in production" and sample photos are stamped; in production the same check refuses.
 * The original is deleted after 7 days; the public derivative and all hashes stay.
 */
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CaptureTrust, EvidenceKind, EvidenceRef } from '../../src/domain/v5/model';
import { EVIDENCE_KINDS } from '../../src/domain/v5/model';
import { callInferenceBytes } from '../services/inferenceClient';

export const NONCE_TTL_MS = 10 * 60_000;
export const MAX_PHOTO_BYTES = 500 * 1024;
export const MAX_GPS_ACCURACY_M = 50;
export const MAX_SPEED_MPS = 10 / 3.6;
export const PHASH_DUPLICATE_DISTANCE = 8;
export const ORIGINAL_RETENTION_MS = 7 * 86_400_000;
const MAX_SAMPLE_BYTES = 5 * 1024 * 1024;

export interface Detection { label: string; taxonomyCode: string; confidence: number; bbox: [number, number, number, number] }

export interface EvidenceRecord {
  id: string;
  ownerId: string;
  kind: EvidenceKind;
  stage: string | null;
  isDemo: boolean;
  captureTrust: CaptureTrust;
  demoSource: string | null;
  sha256Public: string;
  sha256OriginalEnc: string | null;
  phash: string | null;
  gps: { lat: number; lon: number; accuracyM: number; speedMps: number | null } | null;
  receivedAt: string;
  clientTime: string | null;
  checks: Record<string, string>;
  warnings: string[];
  privacy: { facesBlurred: number | null; platesBlurred: null; status: 'APPLIED' | 'NOT_AVAILABLE' };
  ai: { status: 'REAL' | 'MODEL_UNAVAILABLE' | 'NOT_RUN'; modelId: string | null; device: string | null; detections: Detection[]; width: number | null; height: number | null };
  marker: { found: boolean; pxPerMm: number | null; tiltRatio: number | null } | null;
  values: Record<string, unknown> | null;
  usedByCaseId: string | null;
}

export type CaptureFailure = { code: string; message: string };

interface Nonce { ownerId: string; purpose: string; expiresAt: number; usedAt: number | null }

const hamming = (a: string, b: string) => {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x > 0n) { n += Number(x & 1n); x >>= 1n; }
  return n;
};

const SAMPLE_ID = /^[a-z0-9-]{1,40}$/;

export class CaptureService {
  private nonces = new Map<string, Nonce>();
  private records = new Map<string, EvidenceRecord>();
  private readonly file: string;
  private readonly imageDir: string;
  private readonly originalDir: string;

  constructor(private readonly dir: string, private readonly demoMode: boolean, private readonly root = process.cwd()) {
    this.file = path.join(dir, 'evidence.json');
    this.imageDir = path.join(dir, 'evidence');
    this.originalDir = path.join(dir, 'originals');
    fs.mkdirSync(this.imageDir, { recursive: true });
    fs.mkdirSync(this.originalDir, { recursive: true });
    if (fs.existsSync(this.file)) for (const r of JSON.parse(fs.readFileSync(this.file, 'utf8')) as EvidenceRecord[]) this.records.set(r.id, r);
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...this.records.values()]));
    fs.renameSync(tmp, this.file);
  }

  issueNonce(ownerId: string, purpose: string, nowMs = Date.now()) {
    const nonce = randomBytes(16).toString('hex');
    this.nonces.set(nonce, { ownerId, purpose, expiresAt: nowMs + NONCE_TTL_MS, usedAt: null });
    return { nonce, expiresAt: new Date(nowMs + NONCE_TTL_MS).toISOString(), serverTime: new Date(nowMs).toISOString() };
  }

  /** Marks the nonce used. A second use or an expired nonce fails. */
  checkNonce(nonce: unknown, ownerId: string, nowMs = Date.now()): string | null {
    const n = typeof nonce === 'string' ? this.nonces.get(nonce) : undefined;
    if (!n || n.ownerId !== ownerId) return 'NONCE_INVALID';
    if (n.usedAt) return 'NONCE_REUSED';
    if (n.expiresAt < nowMs) return 'NONCE_EXPIRED';
    n.usedAt = nowMs;
    return null;
  }

  get(id: string): EvidenceRecord | null {
    return this.records.get(id) ?? null;
  }

  imagePath(id: string): string | null {
    const p = path.join(this.imageDir, `${id}.jpg`);
    return /^EV-[0-9a-f]{24}$/.test(id) && fs.existsSync(p) ? p : null;
  }

  samples(): { id: string; file: string; title: string; stage?: string }[] {
    const file = path.join(this.root, 'public', 'demo', 'samples', 'manifest.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  }

  private sampleBytes(id: string): Buffer | null {
    if (!SAMPLE_ID.test(id) || !this.samples().some((s) => s.id === id)) return null;
    const p = path.join(this.root, 'public', 'demo', 'samples', `${id}.jpg`);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  }

  private duplicateOf(hash: string, selfOwner: string): EvidenceRecord | null {
    for (const r of this.records.values()) {
      if (r.phash && r.captureTrust !== 'DEMO' && hamming(r.phash, hash) <= PHASH_DUPLICATE_DISTANCE && !(r.ownerId === selfOwner && r.kind === 'CLOSEUP')) return r;
    }
    return null;
  }

  async capture(input: {
    ownerId: string;
    image?: unknown;
    sampleId?: unknown;
    nonce?: unknown;
    kind?: unknown;
    stage?: unknown;
    gps?: { lat?: unknown; lon?: unknown; accuracyM?: unknown; speedMps?: unknown } | null;
    motionSamples?: unknown;
    clientTime?: unknown;
    values?: Record<string, unknown> | null;
    /** Where this photo must be, when it belongs to a case. */
    near?: { latE6: number; lonE6: number; maxM: number } | null;
  }, now = new Date()): Promise<EvidenceRecord | CaptureFailure> {
    const kind = input.kind as EvidenceKind;
    if (!EVIDENCE_KINDS.includes(kind)) return { code: 'VALIDATION', message: 'Unknown photo type.' };

    const isSample = typeof input.sampleId === 'string';
    if (isSample && !this.demoMode) return { code: 'FORBIDDEN', message: 'Sample photos exist only in demo mode.' };

    let bytes: Buffer | null;
    if (isSample) {
      bytes = this.sampleBytes(input.sampleId as string);
      if (!bytes) return { code: 'VALIDATION', message: 'Unknown sample photo.' };
      if (bytes.length > MAX_SAMPLE_BYTES) return { code: 'VALIDATION', message: 'Sample photo is too large.' };
    } else {
      if (typeof input.image !== 'string' || !input.image.startsWith('data:image/jpeg;base64,')) return { code: 'VALIDATION', message: 'Send the photo from the live camera.' };
      bytes = Buffer.from(input.image.slice('data:image/jpeg;base64,'.length), 'base64');
    }
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return { code: 'VALIDATION', message: 'This is not a JPEG photo.' };

    const checks: Record<string, string> = {};
    const warnings: string[] = [];
    // Production refuses; DEMO shows what production would do (02 §9 D-9).
    const refuse = (code: string, message: string): CaptureFailure | null => {
      if (!this.demoMode) return { code, message };
      warnings.push(`Would be rejected in production: ${message}`);
      return null;
    };

    if (!isSample && bytes.length > MAX_PHOTO_BYTES) {
      const failed = refuse('TOO_LARGE', `photo is ${Math.round(bytes.length / 1024)} KB, limit 500 KB.`);
      if (failed) return failed;
    }

    const nonceError = this.checkNonce(input.nonce, input.ownerId, now.getTime());
    checks.nonce = nonceError ?? 'OK';
    if (nonceError) {
      const message = nonceError === 'NONCE_EXPIRED' ? 'this camera session expired. Open the camera again.' : 'this camera session is not valid. Open the camera again.';
      const failed = refuse(nonceError, message);
      if (failed) return failed;
    }

    const lat = Number(input.gps?.lat);
    const lon = Number(input.gps?.lon);
    const accuracyM = Number(input.gps?.accuracyM);
    const speedMps = input.gps?.speedMps === null || input.gps?.speedMps === undefined ? null : Number(input.gps.speedMps);
    const hasGps = Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(accuracyM);
    if (!hasGps) {
      checks.gps = 'MISSING';
      const failed = refuse('NO_GPS', 'no GPS. Move to open sky and wait 10 seconds.');
      if (failed) return failed;
    } else if (accuracyM > MAX_GPS_ACCURACY_M) {
      checks.gps = `POOR_${Math.round(accuracyM)}M`;
      const failed = refuse('GPS_ACCURACY', `GPS accuracy is ${Math.round(accuracyM)} m. Move to open sky, waiting for better GPS.`);
      if (failed) return failed;
    } else {
      checks.gps = 'OK';
    }
    if (speedMps !== null && speedMps > MAX_SPEED_MPS) {
      checks.speed = 'TOO_FAST';
      const failed = refuse('SPEED_LOCK', 'you seem to be moving in a vehicle. Stop before taking the photo.');
      if (failed) return failed;
    }
    if (input.near && hasGps) {
      const distanceM = Math.hypot((lat - input.near.latE6 / 1e6) * 111_320, (lon - input.near.lonE6 / 1e6) * 111_320 * Math.cos((lat * Math.PI) / 180));
      checks.site = distanceM <= input.near.maxM ? 'OK' : `OFF_SITE_${Math.round(distanceM)}M`;
      if (distanceM > input.near.maxM) {
        const failed = refuse('OFF_SITE', `this photo is ${Math.round(distanceM)} m from the case; limit ${input.near.maxM} m.`);
        if (failed) return failed;
      }
    }
    checks.motion = Number(input.motionSamples) > 0 ? 'OK' : 'NO_SAMPLES';
    if (checks.motion !== 'OK') warnings.push('No motion data from this device. Noted, not blocked.');

    // Hash, blur and stamp. Without the service the photo has no blur, so it is not kept as public.
    const id = `EV-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const processed = await callInferenceBytes(`/v1/image/evidence${isSample ? '?watermark=DEMO' : ''}`, bytes, 'image/jpeg', 30_000);
    let publicBytes: Buffer;
    let phash: string | null = null;
    let facesBlurred: number | null = null;
    if ('unavailable' in processed || !processed.ok) {
      if ('unavailable' in processed) {
        const failed = refuse('PRIVACY_UNAVAILABLE', 'the privacy service is down, so faces cannot be blurred.');
        if (failed) return failed;
        checks.privacy = 'UNAVAILABLE';
        publicBytes = bytes;
      } else {
        return { code: 'VALIDATION', message: 'This photo could not be read.' };
      }
    } else {
      const body = processed.body as { phash: string; faces_blurred: number | null; jpeg_base64: string };
      phash = body.phash;
      facesBlurred = body.faces_blurred;
      publicBytes = Buffer.from(body.jpeg_base64, 'base64');
      checks.privacy = facesBlurred === null ? 'FACE_MODEL_MISSING' : 'OK';
    }

    if (phash) {
      const dup = this.duplicateOf(phash, input.ownerId);
      checks.duplicate = dup ? `MATCH_${dup.id}` : 'OK';
      if (dup && !isSample) {
        const failed = refuse('DUPLICATE_EVIDENCE', 'this photo matches one already used. Take a new photo.');
        if (failed) return failed;
      }
    }

    fs.writeFileSync(path.join(this.imageDir, `${id}.jpg`), publicBytes);
    const sha256Public = createHash('sha256').update(publicBytes).digest('hex');

    // AES-256-GCM per file. Deleting the file and its key removes the original for good.
    let sha256OriginalEnc: string | null = null;
    if (!isSample) {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
      fs.writeFileSync(path.join(this.originalDir, `${id}.enc`), enc);
      fs.writeFileSync(path.join(this.originalDir, `${id}.key`), key, { mode: 0o400 });
      sha256OriginalEnc = createHash('sha256').update(enc).digest('hex');
    }

    const ai = await this.detect(kind, publicBytes);
    const marker = kind === 'MARKER_NADIR' ? await this.findMarker(publicBytes) : null;
    if (kind === 'MARKER_NADIR' && marker && !marker.found) warnings.push('No marker card found in this photo, so its size cannot count as measured.');

    const record: EvidenceRecord = {
      id,
      ownerId: input.ownerId,
      kind,
      stage: typeof input.stage === 'string' ? input.stage : null,
      isDemo: this.demoMode,
      captureTrust: isSample ? 'DEMO' : 'LIVE_NONCE',
      demoSource: isSample ? `SAMPLE:${input.sampleId}` : null,
      sha256Public,
      sha256OriginalEnc,
      phash,
      gps: hasGps ? { lat, lon, accuracyM, speedMps } : null,
      receivedAt: now.toISOString(),
      clientTime: typeof input.clientTime === 'string' ? input.clientTime : null,
      checks,
      warnings,
      privacy: { facesBlurred, platesBlurred: null, status: facesBlurred === null ? 'NOT_AVAILABLE' : 'APPLIED' },
      ai,
      marker,
      values: input.values ?? null,
      usedByCaseId: null
    };
    this.records.set(id, record);
    this.save();
    return record;
  }

  private async detect(kind: EvidenceKind, bytes: Buffer): Promise<EvidenceRecord['ai']> {
    const none = { modelId: null, device: null, detections: [], width: null, height: null };
    if (kind !== 'OVERVIEW' && kind !== 'CLOSEUP' && kind !== 'TRACE_POINT') return { status: 'NOT_RUN', ...none };
    const reply = await callInferenceBytes('/v1/cv/analyze-image', bytes, 'image/jpeg', 45_000);
    if ('unavailable' in reply || !reply.ok) return { status: 'MODEL_UNAVAILABLE', ...none };
    const body = reply.body as { image: { width: number; height: number }; model: { detector: { modelId: string; device: string } }; detections: { label: string; taxonomyCode: string; confidence: number; bbox: [number, number, number, number] }[] };
    return {
      status: 'REAL',
      modelId: body.model.detector.modelId,
      device: body.model.detector.device,
      width: body.image.width,
      height: body.image.height,
      detections: body.detections.map(({ label, taxonomyCode, confidence, bbox }) => ({ label, taxonomyCode, confidence, bbox }))
    };
  }

  private async findMarker(bytes: Buffer): Promise<EvidenceRecord['marker']> {
    const reply = await callInferenceBytes('/v1/image/marker', bytes, 'image/jpeg', 15_000);
    if ('unavailable' in reply || !reply.ok) return null;
    const m = reply.body as { found: boolean; px_per_mm: number | null; tilt_ratio: number | null };
    return { found: m.found, pxPerMm: m.px_per_mm, tiltRatio: m.tilt_ratio };
  }

  /** Turns evidence ids into chain references, after checking ownership and single use. */
  claim(ids: unknown, ownerId: string, caseId: string): { refs: EvidenceRef[]; records: EvidenceRecord[] } | CaptureFailure {
    if (!Array.isArray(ids)) return { refs: [], records: [] };
    const records: EvidenceRecord[] = [];
    for (const id of ids) {
      const r = this.records.get(String(id));
      if (!r) return { code: 'VALIDATION', message: 'A photo is missing. Take it again.' };
      if (r.ownerId !== ownerId) return { code: 'FORBIDDEN', message: 'That photo was taken by someone else.' };
      if (r.usedByCaseId && r.usedByCaseId !== caseId) return { code: 'DUPLICATE_EVIDENCE', message: 'That photo is already used on another case.' };
      records.push(r);
    }
    for (const r of records) r.usedByCaseId = caseId;
    this.save();
    return { records, refs: records.map((r) => ({ id: r.id, sha256: r.sha256Public, kind: r.kind, stage: r.stage, captureTrust: r.captureTrust, demoSource: r.demoSource, values: r.values })) };
  }

  /** Deletes originals past their retention. Hashes in the log stay valid (07 §9). */
  purgeOriginals(nowMs = Date.now()): number {
    let removed = 0;
    for (const name of fs.readdirSync(this.originalDir)) {
      const file = path.join(this.originalDir, name);
      if (nowMs - fs.statSync(file).mtimeMs > ORIGINAL_RETENTION_MS) {
        fs.rmSync(file, { force: true });
        removed++;
      }
    }
    return removed;
  }
}

export const isCaptureFailure = (r: unknown): r is CaptureFailure => !!r && typeof r === 'object' && 'code' in r && 'message' in r && !('id' in r);

/** Great-circle length of a walked trace, with the checks of 05 §6.4. */
export function analyseTrace(points: { lat: number; lon: number; accuracyM: number; t: number }[], photoCount: number) {
  const kept = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.accuracyM <= 20);
  const flags: string[] = [];
  let lengthM = 0;
  let maxGapS = 0;
  let breaks = 0;
  for (let i = 1; i < kept.length; i++) {
    const a = kept[i - 1];
    const b = kept[i];
    const dy = (b.lat - a.lat) * 111_320;
    const dx = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
    const step = Math.hypot(dx, dy);
    const dt = (b.t - a.t) / 1000;
    if (dt > 15) { breaks++; maxGapS = Math.max(maxGapS, dt); continue; }
    maxGapS = Math.max(maxGapS, dt);
    if (dt > 0 && step / dt > 2.5) flags.push('SPEED');
    lengthM += step;
  }
  if (breaks > 1) flags.push('GAPS');
  const sorted = [...kept].map((p) => p.accuracyM).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : Infinity;
  const distinct = [...new Set(flags)];
  // T-2: more than one break in the walk is always LOW.
  const quality: 'HIGH' | 'MEDIUM' | 'LOW' = distinct.includes('GAPS') ? 'LOW' : distinct.length === 0 && median <= 5 ? 'HIGH' : distinct.length <= 1 && median <= 10 ? 'MEDIUM' : 'LOW';
  return { lengthM: Math.round(lengthM * 10) / 10, points: kept.length, medianAccuracyM: Number.isFinite(median) ? median : null, maxGapS: Math.round(maxGapS), flags: distinct, quality, enoughPhotos: photoCount >= 3, longEnough: lengthM >= 10 };
}
