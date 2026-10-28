/**
 * What the AI sees, drawn over the camera preview before the photo is taken: corner brackets
 * that lock onto each detected defect (with label + confidence), a rail of scene chips
 * (pothole, cracks, standing water, surface destroyed, not a road) and a one-line hint.
 */
import React, { useEffect, useRef, useState } from 'react';
import { mapBoxToScreen, useLiveDetection, type LiveResult } from './liveDetection';

const Bracket: React.FC<{ rect: { left: number; top: number; width: number; height: number }; label: string; strong: boolean }> = ({ rect, label, strong }) => {
  const c = strong ? '#FF6B2C' : '#FFFFFF';
  const arm = Math.max(14, Math.min(rect.width, rect.height) * 0.22);
  const corner = (pos: React.CSSProperties, b: React.CSSProperties) => (
    <span className="absolute" style={{ width: arm, height: arm, borderColor: c, borderStyle: 'solid', borderWidth: 0, ...pos, ...b }} />
  );
  return (
    <div
      className="absolute transition-all duration-300 ease-out"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, opacity: strong ? 1 : 0.6 }}
    >
      {corner({ left: 0, top: 0 }, { borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 })}
      {corner({ right: 0, top: 0 }, { borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 })}
      {corner({ left: 0, bottom: 0 }, { borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 })}
      {corner({ right: 0, bottom: 0 }, { borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 })}
      {strong && <span className="absolute inset-0 rounded-[10px] bg-[#FF6B2C]/10" />}
      <span
        className="pp-pop absolute -top-8 left-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-extrabold"
        style={{ background: strong ? '#FF6B2C' : 'rgba(0,0,0,0.6)', color: '#FFFFFF' }}
      >
        {label}
      </span>
    </div>
  );
};

function chips(r: LiveResult | null): Array<{ key: string; text: string; tone: string }> {
  if (!r) return [];
  const out: Array<{ key: string; text: string; tone: string }> = [];
  const accepted = r.boxes.filter((b) => b.accepted);
  const kinds = new Map<string, number>();
  for (const b of accepted) kinds.set(b.label.replace(/\s*\(.*\)/, ''), Math.max(kinds.get(b.label) ?? 0, b.confidence));
  for (const [label, p] of kinds) out.push({ key: label, text: `${label} ${Math.round(p * 100)}%`, tone: '#FF6B2C' });
  const sc = r.scene;
  if (sc) {
    if (!sc.isRoad) out.push({ key: 'nr', text: 'Bukan foto jalan?', tone: '#FF4D5E' });
    if (sc.water.flooded) out.push({ key: 'w', text: `Genangan ${Math.round(sc.water.p * 100)}%`, tone: '#38BDF8' });
    if (sc.isRoad && sc.surfaceTop && sc.surfaceTop.key !== 'good' && !out.some((c) => c.text.startsWith(sc.surfaceTop!.label))) {
      out.push({ key: 's', text: `${sc.surfaceTop.label} ${Math.round(sc.surfaceTop.p * 100)}%`, tone: sc.surfaceTop.key === 'broken' ? '#FF4D5E' : '#FFD60A' });
    }
    if (sc.isRoad && sc.surfaceTop?.key === 'broken' && r.surfaceIndex >= 60) out.push({ key: 'rt', text: 'Rusak total?', tone: '#FF4D5E' });
  }
  return out;
}

export const LiveAiOverlay: React.FC<{ video: HTMLVideoElement | null; active: boolean }> = ({ video, active }) => {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const { result, state } = useLiveDetection(video, active);
  const buzzed = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const strong = result?.boxes.some((b) => b.accepted) ?? false;
  useEffect(() => {
    if (strong && !buzzed.current) {
      buzzed.current = true;
      navigator.vibrate?.(18);
    }
    if (!strong) buzzed.current = false;
  }, [strong]);

  if (!active) return null;
  const vw = video?.videoWidth ?? 0;
  const vh = video?.videoHeight ?? 0;
  const list = chips(result);
  const hint =
    state === 'unavailable'
      ? 'AI langsung tidak aktif. Tetap bisa memotret.'
      : state === 'paused'
        ? 'Pratinjau AI dijeda untuk hemat kuota. Silakan ambil foto.'
        : result?.scene && !result.scene.isRoad
          ? 'Arahkan kamera ke permukaan jalan'
          : strong
            ? 'Kerusakan terlihat. Ambil foto sekarang.'
            : 'Arahkan kamera ke kerusakan jalan';

  return (
    <div ref={box} className="pointer-events-none absolute inset-0 z-10">
      {!strong && state === 'running' && <div className="pp-scanline opacity-60" />}
      {result && vw > 0 &&
        result.boxes.map((b, i) => (
          <Bracket
            key={i}
            rect={mapBoxToScreen(b.bbox, result.frame, { w: vw, h: vh }, size)}
            label={`${b.label.replace(/\s*\(.*\)/, '')} · ${Math.round(b.confidence * 100)}%`}
            strong={b.accepted}
          />
        ))}
      <div className="absolute inset-x-0 top-20 flex flex-wrap justify-center gap-2 px-4">
        {list.map((c) => (
          <span key={c.key} className="pp-pop rounded-full px-3 py-1.5 text-xs font-extrabold text-[#0B0D10] shadow-lg" style={{ background: c.tone }}>
            {c.text}
          </span>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-40 flex justify-center px-6">
        <span className="flex items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-sm font-bold text-white backdrop-blur">
          <span className={`h-2 w-2 rounded-full ${strong ? 'bg-[#FF6B2C]' : 'pp-dot bg-[#4C8DFF]'}`} />
          {hint}
          {result && <span className="text-white/50">· {Math.round(result.ms.total)} ms</span>}
        </span>
      </div>
    </div>
  );
};
