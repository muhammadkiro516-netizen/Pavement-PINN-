/**
 * The device's GPS position, asked for as soon as the site opens (landing) and shared by the
 * map (fly to the visitor) and the report form (a report is filed at the visitor's position).
 */
export interface DeviceFix {
  coordinates: [number, number];
  accuracyM: number;
  at: number;
}

const KEY = 'pavement-pinn.last-fix';
let pending: Promise<DeviceFix | null> | null = null;

export function lastDeviceFix(maxAgeMs = 5 * 60_000): DeviceFix | null {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null') as DeviceFix | null;
    return v && Date.now() - v.at <= maxAgeMs ? v : null;
  } catch {
    return null;
  }
}

/** Ask the browser for a fresh, accurate position (shows the permission prompt the first time). */
export function requestDeviceLocation(): Promise<DeviceFix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  pending ??= new Promise<DeviceFix | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const fix: DeviceFix = {
          coordinates: [Number(pos.coords.latitude.toFixed(6)), Number(pos.coords.longitude.toFixed(6))],
          accuracyM: pos.coords.accuracy,
          at: Date.now()
        };
        try {
          window.sessionStorage.setItem(KEY, JSON.stringify(fix));
        } catch {
          // storage blocked: the fix is still returned
        }
        resolve(fix);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 }
    );
  }).finally(() => {
    pending = null;
  });
  return pending;
}
