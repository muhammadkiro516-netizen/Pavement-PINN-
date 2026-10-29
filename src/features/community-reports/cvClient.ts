/**
 * Browser side of the road-damage CV pipeline: sends the exact photo bytes to the server,
 * then follows the job. The stages shown in "Memeriksa foto" are the stages the server
 * reports; nothing here invents progress or a result.
 */
import type { CvJobStage, CvJobView } from '../../types/cv';

export const CV_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const CV_MAX_BYTES = 5 * 1024 * 1024;

export class CvClientError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'CvClientError';
  }
}

/** Labels for the server stages, in execution order. */
export const CV_STAGE_LABELS: Record<CvJobStage, string> = {
  queued: 'Menunggu antrean analisis',
  validating_input: 'Memvalidasi gambar',
  model_loading: 'Memuat model',
  preprocessing: 'Menyiapkan gambar',
  detecting: 'Mendeteksi kerusakan jalan',
  segmenting: 'Menyegmentasi area retak',
  evaluating: 'Mengevaluasi jenis dan keparahan',
  validating: 'Memvalidasi hasil AI',
  done: 'Analisis selesai'
};

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; type: string } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new CvClientError('INVALID_IMAGE', 'Foto tidak dapat dibaca.');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type: m[1] };
}

/** Client-side input checks before upload; the server repeats them on the bytes. */
export function checkImageInput(type: string, size: number): string | null {
  if (!(CV_IMAGE_TYPES as readonly string[]).includes(type)) return 'Format foto harus JPEG, PNG, atau WebP.';
  if (size > CV_MAX_BYTES) return 'Ukuran foto melebihi 5 MB.';
  if (size === 0) return 'File foto kosong.';
  return null;
}

async function readError(res: Response): Promise<CvClientError> {
  const body = await res.json().catch(() => null);
  const e = body?.error;
  return new CvClientError(e?.code ?? `HTTP_${res.status}`, e?.message ?? `Server menjawab ${res.status}.`);
}

/** Upload, then poll until the job is done or failed. `onUpdate` sees every real stage change. */
export async function runCvAnalysis(
  dataUrl: string,
  idempotencyKey: string,
  onUpdate: (job: CvJobView) => void,
  signal?: AbortSignal
): Promise<CvJobView> {
  const { bytes, type } = dataUrlToBytes(dataUrl);
  const invalid = checkImageInput(type, bytes.length);
  if (invalid) throw new CvClientError('INVALID_IMAGE', invalid);
  const res = await fetch('/api/cv/jobs', { method: 'POST', headers: { 'Content-Type': type, 'Idempotency-Key': idempotencyKey }, body: bytes, signal });
  if (!res.ok) throw await readError(res);
  let job = (await res.json()).job as CvJobView;
  onUpdate(job);
  const started = Date.now();
  while (job.state !== 'done' && job.state !== 'error') {
    if (Date.now() - started > 120_000) throw new CvClientError('TIMEOUT', 'Analisis melebihi 2 menit.');
    await new Promise((r) => setTimeout(r, 300));
    if (signal?.aborted) throw new CvClientError('ABORTED', 'Analisis dibatalkan.');
    const poll = await fetch(`/api/cv/jobs/${job.jobId}`, { signal });
    if (!poll.ok) throw await readError(poll);
    job = (await poll.json()).job as CvJobView;
    onUpdate(job);
  }
  if (job.state === 'error') throw new CvClientError(job.error?.code ?? 'INFERENCE_FAILED', job.error?.message ?? 'Analisis gagal.');
  return job;
}

/** Server-side conversion for gallery files the browser cannot decode (HEIC, AVIF, TIFF, ...). */
export async function normalizePhoto(file: Blob): Promise<string> {
  const res = await fetch('/api/media/normalize', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  if (!res.ok) throw await readError(res);
  return (await res.json()).image as string;
}
