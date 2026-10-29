/** SPEC M9: Radar Bahaya toggle on the map (opt-in; uses GPS, vibration and a short tone). */
import React, { useEffect, useRef, useState } from 'react';
import { alertPattern, COOLDOWN_MS, hazardsNear, RADIUS_M, type RadarCase, type RadarHit } from './hazardRadar';

function beep(weight: number) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.15 * Math.min(3, weight));
  } catch {
    /* audio blocked: vibration and banner still work */
  }
}

export const HazardRadar: React.FC<{ cases: RadarCase[] }> = ({ cases }) => {
  const [on, setOn] = useState(false);
  const [hits, setHits] = useState<RadarHit[]>([]);
  const last = useRef(new Map<string, number>());
  const latest = useRef(cases);
  latest.current = cases;
  useEffect(() => {
    if (!on || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const h = hazardsNear(latest.current, [p.coords.latitude, p.coords.longitude]);
        setHits(h);
        const now = Date.now();
        for (const x of h) {
          if (now - (last.current.get(x.id) ?? 0) < COOLDOWN_MS) continue;
          last.current.set(x.id, now);
          navigator.vibrate?.(alertPattern(x.weight));
          beep(x.weight);
          break;
        }
      },
      () => setHits([]),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [on]);
  return (
    <div className="pointer-events-auto">
      <button type="button" onClick={() => setOn((v) => !v)} className={`min-h-10 rounded-full px-4 text-xs font-extrabold shadow-lg ${on ? 'bg-[#FF4D5E] text-[#0B0D10]' : 'bg-[#15181D]/90 text-white'}`}>
        {on ? `Radar Bahaya aktif · ${RADIUS_M} m` : 'Radar Bahaya'}
      </button>
      {on && hits[0] && (
        <div className="mt-2 max-w-[260px] rounded-2xl bg-[#FF4D5E] p-3 text-[#0B0D10]" role="alert">
          <p className="text-sm font-extrabold">{hits[0].label} ±{hits[0].distanceM} m di depan</p>
          {hits[0].reasons.length > 0 && <p className="text-xs">{hits[0].reasons.join(' · ')}</p>}
        </div>
      )}
    </div>
  );
};
