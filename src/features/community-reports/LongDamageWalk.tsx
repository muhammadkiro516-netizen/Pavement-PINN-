/**
 * "Kerusakan panjang": Mulai, berjalan sepanjang kerusakan, Selesai. The length comes from live GPS,
 * and poor fixes do not count (same 20 m limit as the server's trace check, 05 §6.4).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Footprints, MapPin } from 'lucide-react';
import { Pavi } from '../../components/brand/Pavi';
import { readPaviHelmet } from '../../components/brand/paviPrefs';

export interface LongDamageTrace {
  lengthM: number;
  points: { lat: number; lon: number; accuracyM: number; t: number }[];
  start: { lat: number; lon: number; accuracyM: number };
}

const MIN_LENGTH_M = 10;
const MAX_FIX_ACCURACY_M = 20;

export function traceLengthM(points: readonly { lat: number; lon: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dy = (points[i].lat - points[i - 1].lat) * 111_320;
    const dx = (points[i].lon - points[i - 1].lon) * 111_320 * Math.cos((points[i].lat * Math.PI) / 180);
    total += Math.hypot(dx, dy);
  }
  return total;
}

export const LongDamageWalk: React.FC<{ onDone: (trace: LongDamageTrace) => void; onCancel: () => void }> = ({ onDone, onCancel }) => {
  const [walking, setWalking] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [denied, setDenied] = useState(false);
  const [points, setPoints] = useState<LongDamageTrace['points']>([]);
  const walkingRef = useRef(false);
  walkingRef.current = walking;

  useEffect(() => {
    if (!navigator.geolocation) { setDenied(true); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setDenied(false);
        setAccuracy(p.coords.accuracy);
        if (walkingRef.current && p.coords.accuracy <= MAX_FIX_ACCURACY_M) {
          setPoints((list) => [...list, { lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: p.coords.accuracy, t: p.timestamp }]);
        }
      },
      () => setDenied(true),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const lengthM = traceLengthM(points);
  const gpsReady = accuracy !== null && accuracy <= MAX_FIX_ACCURACY_M;
  const pct = Math.min(100, (lengthM / MIN_LENGTH_M) * 100);

  return (
    <div className="pp-rise space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4" data-testid="long-walk">
      <div className="flex items-center gap-3">
        <Pavi size={56} mood={walking ? 'walk' : 'idle'} helmet={readPaviHelmet()} />
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold text-white">{walking ? 'Terus berjalan di sepanjang kerusakan' : 'Berdiri di ujung kerusakan'}</p>
          <p className="text-xs text-slate-400">Jalan di tepi atau trotoar. Jangan berdiri di tengah lalu lintas.</p>
        </div>
      </div>

      {walking ? (
        <div className="text-center">
          <p className="tabular text-[44px] font-extrabold leading-none text-[#FFD60A]" data-testid="long-walk-length">{Math.round(lengthM)} m</p>
          <p className="mt-1 text-xs text-slate-400">panjang yang sudah Anda jalani</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[#FFD60A] transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
          {lengthM < MIN_LENGTH_M && <p className="mt-1.5 text-xs text-slate-400">Minimal {MIN_LENGTH_M} m. Kurang {Math.ceil(MIN_LENGTH_M - lengthM)} m lagi.</p>}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-slate-200" data-testid="long-walk-gps">
          <MapPin className="h-4 w-4 shrink-0 text-[#FFD60A]" aria-hidden="true" />
          {denied ? 'Lokasi belum diizinkan. Izinkan lokasi di pengaturan browser.' : gpsReady ? 'Lokasi Anda sudah akurat. Siap mulai.' : 'Mencari lokasi yang akurat. Coba ke tempat terbuka.'}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={onCancel} className="h-12 cursor-pointer rounded-2xl border border-white/[0.1] bg-white/[0.04] text-sm font-medium text-slate-100">Batal</button>
        {walking ? (
          <button type="button" disabled={lengthM < MIN_LENGTH_M} onClick={() => onDone({ lengthM: Math.round(lengthM * 10) / 10, points, start: points[0] })} className="h-12 cursor-pointer rounded-2xl bg-[#FFD60A] text-sm font-extrabold text-[#0B0D10] disabled:cursor-not-allowed disabled:opacity-40" data-testid="long-walk-end">Selesai jalan</button>
        ) : (
          <button type="button" disabled={!gpsReady} onClick={() => { setPoints([]); setWalking(true); }} className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#FFD60A] text-sm font-extrabold text-[#0B0D10] disabled:cursor-not-allowed disabled:opacity-40" data-testid="long-walk-start"><Footprints className="h-4 w-4" aria-hidden="true" /> Mulai</button>
        )}
      </div>
    </div>
  );
};
