/**
 * Live in-page camera (05 §2): getUserMedia only. No file input exists in this file, and a test checks that.
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, MapPin } from 'lucide-react';
import { v5 } from './api';
import { Chip, ErrorNote, useAction } from './ui';

export interface Detection { label: string; taxonomyCode: string; confidence: number; bbox: [number, number, number, number] }

export interface EvidenceView {
  id: string;
  kind: string;
  stage: string | null;
  captureTrust: string;
  sha256Public: string;
  imageUrl: string;
  warnings: string[];
  checks: Record<string, string>;
  privacy: { facesBlurred: number | null; status: string };
  ai: { status: string; modelId: string | null; device: string | null; detections: Detection[]; width: number | null; height: number | null };
  marker: { found: boolean; pxPerMm: number | null; tiltRatio: number | null } | null;
  gps: { lat: number; lon: number; accuracyM: number } | null;
}

export interface Fix { lat: number; lon: number; accuracyM: number; speedMps: number | null; t: number }

const MAX_BYTES = 500 * 1024;
const MAX_EDGE = 1600;
const MAX_ACCURACY_M = 50;
const SPEED_LOCK_MPS = 10 / 3.6;

/** Live GPS. In production the shutter waits for it. */
export function useGps(): { fix: Fix | null; denied: boolean } {
  const [fix, setFix] = useState<Fix | null>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    if (!navigator.geolocation) { setDenied(true); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => { setDenied(false); setFix({ lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: p.coords.accuracy, speedMps: p.coords.speed, t: p.timestamp }); },
      () => setDenied(true),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return { fix, denied };
}

function useMotionCount() {
  const count = useRef(0);
  useEffect(() => {
    const listener = () => { count.current += 1; };
    window.addEventListener('devicemotion', listener);
    return () => window.removeEventListener('devicemotion', listener);
  }, []);
  return count;
}

async function grabJpeg(video: HTMLVideoElement): Promise<string> {
  const ratio = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * ratio);
  canvas.height = Math.round(video.videoHeight * ratio);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.82, 0.7, 0.6, 0.5, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if ((url.length * 3) / 4 <= MAX_BYTES) return url;
  }
  return canvas.toDataURL('image/jpeg', 0.3);
}

export function Capture({ kind, stage, caseId, purpose, title, hint, values, onDone }: {
  kind: string;
  stage?: string;
  caseId?: string;
  purpose: string;
  title: string;
  hint: string;
  values?: Record<string, unknown>;
  onDone: (e: EvidenceView) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<'starting' | 'on' | 'denied'>('starting');
  const { fix, denied } = useGps();
  const motion = useMotionCount();
  const [flash, setFlash] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    if (!navigator.mediaDevices?.getUserMedia) { setCamera('denied'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1600 } }, audio: false })
      .then((s) => {
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const el = video.current;
        if (!el) return;
        el.srcObject = s;
        // The shutter opens only once real frames exist, or the photo would be empty.
        el.onloadedmetadata = () => { void el.play().catch(() => undefined); if (!stopped) setCamera('on'); };
      })
      .catch(() => setCamera('denied'));
    return () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const gpsBody = () => {
    if (fix) return { lat: fix.lat, lon: fix.lon, accuracyM: fix.accuracyM, speedMps: fix.speedMps };
    return null;
  };

  const send = (extra: Record<string, unknown>) => run(async () => {
    const { nonce } = await v5<{ nonce: string }>('/capture/nonce', { purpose, caseId, stage });
    const rec = await v5<EvidenceView>('/evidence', { nonce, kind, stage, caseId, gps: gpsBody(), motionSamples: motion.current, clientTime: new Date().toISOString(), values, ...extra });
    onDone(rec);
  });

  const shoot = async () => {
    if (!video.current || video.current.videoWidth === 0) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    if (navigator.vibrate) navigator.vibrate(10);
    await send({ image: await grabJpeg(video.current) });
  };

  const tooFast = fix?.speedMps != null && fix.speedMps > SPEED_LOCK_MPS;
  const gpsPoor = !fix || fix.accuracyM > MAX_ACCURACY_M;
  const blocked = gpsPoor || tooFast;

  return (
    <div className="v5-capture" data-testid="v5-capture">
      <h3>{title}</h3>
      <p>{hint}</p>
      <div className="v5-viewfinder">
        <video ref={video} playsInline muted autoPlay aria-label="Live camera" hidden={camera !== 'on'} />
        {camera === 'starting' && <p className="v5-viewfinder-note">Menyalakan kamera…</p>}
        {camera === 'denied' && <p className="v5-viewfinder-note">Kamera belum aktif. Izinkan kamera di pengaturan browser, lalu buka lagi.</p>}
        {flash && <div className="v5-flash" />}
      </div>
      <p className="v5-gps" data-testid="v5-gps">
        <MapPin size={16} aria-hidden="true" />
        {fix ? <>Lokasi akurat sampai {Math.round(fix.accuracyM)} m</> : denied ? 'Lokasi belum diizinkan.' : 'Mencari lokasi…'}
      </p>
      {gpsPoor && fix && <p className="v5-warn">Pindah ke tempat terbuka agar lokasi lebih akurat.</p>}
      {tooFast && <p className="v5-warn">Anda sepertinya sedang berkendara. Berhenti dulu sebelum memotret.</p>}
      <button type="button" className="v5-btn v5-btn-primary v5-shutter" disabled={camera !== 'on' || blocked || busy} onClick={shoot} data-testid="v5-shutter">
        <Camera size={20} aria-hidden="true" /> {busy ? 'Mengirim…' : 'Ambil foto'}
      </button>
      <ErrorNote error={error} />
    </div>
  );
}

/** Photo with what the AI saw drawn on it. */
export function DetectionView({ evidence }: { evidence: EvidenceView }) {
  const { ai } = evidence;
  const best = [...ai.detections].sort((a, b) => b.confidence - a.confidence);
  return (
    <figure className="v5-detect" data-testid="v5-detection">
      <div className="v5-detect-photo">
        <img src={apiUrl(evidence.imageUrl)} alt="Foto jalan" />
        {ai.width && ai.height && best.map((d, i) => (
          <span key={i} className="v5-box" style={{ left: `${(d.bbox[0] / ai.width!) * 100}%`, top: `${(d.bbox[1] / ai.height!) * 100}%`, width: `${((d.bbox[2] - d.bbox[0]) / ai.width!) * 100}%`, height: `${((d.bbox[3] - d.bbox[1]) / ai.height!) * 100}%` }}>
            <em>{d.taxonomyCode} {Math.round(d.confidence * 100)}%</em>
          </span>
        ))}
      </div>
      <figcaption>
        {ai.status === 'REAL' && best.length > 0 && <>AI melihat: <strong>{best[0].label}</strong>, keyakinan {Math.round(best[0].confidence * 100)}% <Chip kind="AI_ESTIMATE" /></>}
        {ai.status === 'REAL' && best.length === 0 && <>AI tidak melihat kerusakan di foto ini. Koordinator akan memeriksanya.</>}
        {ai.status === 'MODEL_UNAVAILABLE' && <>Pemeriksaan AI sedang tidak tersedia. Koordinator akan melihat fotonya.</>}
                <span className="v5-caption">Wajah disamarkan otomatis. Plat nomor belum.</span>
      </figcaption>
    </figure>
  );
}

export const apiUrl = (p: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${p}`;
