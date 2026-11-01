/** A citizen report through the real path: one-time code, evidence checks, then the case. */
import { ensureDeviceSession, v5 } from './api';

const MAX_BYTES = 500 * 1024;
const MAX_EDGE = 1600;

/** Every photo goes up as a JPEG of at most 500 KB. */
async function toUploadJpeg(dataUrl: string): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const ratio = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * ratio);
  canvas.height = Math.round(img.height * ratio);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.82, 0.7, 0.6, 0.5, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if ((url.length * 3) / 4 <= MAX_BYTES) return url;
  }
  return canvas.toDataURL('image/jpeg', 0.3);
}

export interface ReportSubmission {
  photo: string;
  extraEvidenceIds: string[];
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  classGuess: string | null;
  sizeBand: string | null;
  note: string;
  trace: { points: { lat: number; lon: number; accuracyM: number; t: number }[] } | null;
}

export async function submitReport(r: ReportSubmission): Promise<{ publicCode: string }> {
  await ensureDeviceSession();
  const accuracyM = r.accuracyM ?? 999;
  const { nonce } = await v5<{ nonce: string }>('/capture/nonce', { purpose: 'REPORT' });
  const evidence = await v5<{ id: string }>('/evidence', {
    nonce,
    kind: r.trace ? 'TRACE_POINT' : 'OVERVIEW',
    image: await toUploadJpeg(r.photo),
    gps: { lat: r.latitude, lon: r.longitude, accuracyM, speedMps: null },
    motionSamples: 1,
    clientTime: new Date().toISOString()
  });
  return v5<{ publicCode: string }>('/cases', {
    mode: r.trace ? 'TRACE' : 'SINGLE',
    evidenceIds: [evidence.id, ...r.extraEvidenceIds],
    lat: r.latitude,
    lon: r.longitude,
    accuracyM,
    classGuess: r.classGuess,
    sizeBand: r.sizeBand,
    note: r.note,
    tracePoints: r.trace?.points
  });
}
