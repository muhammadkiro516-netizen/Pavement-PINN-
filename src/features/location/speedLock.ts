/**
 * SPEC §0.6 / M1.4: the report camera is locked while the device moves faster than 10 km/h,
 * so nobody photographs road damage while riding or driving. Uses the GPS speed when the
 * browser reports it; otherwise derives it from two fixes.
 */
import { useEffect, useState } from 'react';

export const SPEED_LIMIT_KMH = 10;

export function speedFromFixes(a: { lat: number; lng: number; t: number }, b: { lat: number; lng: number; t: number }): number | null {
  const dt = (b.t - a.t) / 1000;
  if (dt < 1 || dt > 30) return null;
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return ((2 * R * Math.asin(Math.sqrt(h))) / dt) * 3.6;
}

export function isLocked(kmh: number | null): boolean {
  return kmh !== null && kmh > SPEED_LIMIT_KMH;
}

/** Current speed in km/h (null = unknown) and whether the camera must be locked. */
export function useSpeedLock(active: boolean): { kmh: number | null; locked: boolean } {
  const [kmh, setKmh] = useState<number | null>(null);
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !navigator.geolocation) return;
    let prev: { lat: number; lng: number; t: number } | null = null;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const cur = { lat: p.coords.latitude, lng: p.coords.longitude, t: p.timestamp };
        const gps = typeof p.coords.speed === 'number' && Number.isFinite(p.coords.speed) ? p.coords.speed * 3.6 : null;
        setKmh(gps ?? (prev ? speedFromFixes(prev, cur) : null));
        prev = cur;
      },
      () => setKmh(null),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);
  return { kmh, locked: isLocked(kmh) };
}
