/**
 * Live camera recognition (before the photo is taken): a small frame from the <video> goes to
 * POST /api/cv/live every ~400 ms (detector + scene model on the server, OpenVINO); the answer
 * is drawn over the preview. One request in flight at a time; stale answers are dropped.
 * These are hints for aiming the camera: the captured photo still goes through the full
 * pipeline (/api/cv/jobs) as evidence.
 */
import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../services/api/client';

export interface LiveBox {
  bbox: [number, number, number, number];
  taxonomyCode: string;
  label: string;
  confidence: number;
  accepted: boolean;
}

export interface LiveScene {
  isRoad: boolean;
  surfaceTop?: { key: string; label: string; p: number };
  water: { flooded: boolean; p: number };
  calibrated: false;
}

export interface LiveResult {
  frame: { w: number; h: number };
  boxes: LiveBox[];
  scene: LiveScene | null;
  surfaceIndex: number;
  quality: { warnings: string[] };
  ms: { total: number; scene: number };
}

/**
 * Frame pixel box -> container pixels for a video shown with `object-fit: cover`.
 * frame: the (downscaled) frame sent to the server; video: intrinsic size; box: container size.
 */
export function mapBoxToScreen(
  bbox: [number, number, number, number],
  frame: { w: number; h: number },
  video: { w: number; h: number },
  box: { w: number; h: number }
): { left: number; top: number; width: number; height: number } {
  const f = video.w / frame.w; // frame -> video pixels (same aspect ratio)
  const s = Math.max(box.w / video.w, box.h / video.h); // cover scale
  const ox = (box.w - video.w * s) / 2;
  const oy = (box.h - video.h * s) / 2;
  const x1 = ox + bbox[0] * f * s;
  const y1 = oy + bbox[1] * f * s;
  const x2 = ox + bbox[2] * f * s;
  const y2 = oy + bbox[3] * f * s;
  return { left: x1, top: y1, width: x2 - x1, height: y2 - y1 };
}

/** Frame size to send: long side 640 (480 on saving-data connections). */
export function frameSize(vw: number, vh: number, lowData: boolean): { w: number; h: number } {
  const long = lowData ? 480 : 640;
  const k = Math.min(1, long / Math.max(vw, vh));
  return { w: Math.round(vw * k), h: Math.round(vh * k) };
}

type Conn = { saveData?: boolean; effectiveType?: string };

export function useLiveDetection(video: HTMLVideoElement | null, active: boolean) {
  const [result, setResult] = useState<LiveResult | null>(null);
  const [state, setState] = useState<'idle' | 'running' | 'paused' | 'unavailable'>('idle');
  const seq = useRef(0);

  useEffect(() => {
    if (!active || !video) {
      setState('idle');
      return;
    }
    const conn = (navigator as Navigator & { connection?: Conn }).connection;
    const lowData = !!conn?.saveData || conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g';
    const interval = lowData ? 1000 : 400;
    const startedAt = Date.now();
    const canvas = document.createElement('canvas');
    let timer = 0;
    let stopped = false;
    let controller: AbortController | null = null;
    setState('running');

    const tick = async () => {
      if (stopped) return;
      if (document.hidden || video.readyState < 2 || !video.videoWidth) {
        timer = window.setTimeout(tick, interval);
        return;
      }
      if (Date.now() - startedAt > 90_000) {
        setState('paused'); // save data: the user can still take the photo
        return;
      }
      const t0 = performance.now();
      const size = frameSize(video.videoWidth, video.videoHeight, lowData);
      canvas.width = size.w;
      canvas.height = size.h;
      canvas.getContext('2d')?.drawImage(video, 0, 0, size.w, size.h);
      const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', lowData ? 0.6 : 0.7));
      const mine = ++seq.current;
      if (blob && !stopped) {
        controller = new AbortController();
        try {
          const res = await fetch(apiUrl('/api/cv/live'), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'image/jpeg' },
            body: blob,
            signal: controller.signal
          });
          if (res.status === 503 || res.status === 401) {
            setState('unavailable');
            return;
          }
          const json = await res.json().catch(() => null);
          if (res.ok && json?.success && mine === seq.current && !stopped) setResult(json.live as LiveResult);
        } catch {
          if (stopped) return;
        }
      }
      timer = window.setTimeout(tick, Math.max(0, interval - (performance.now() - t0)));
    };
    timer = window.setTimeout(tick, 250);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      controller?.abort();
      setResult(null);
    };
  }, [active, video]);

  return { result, state };
}
