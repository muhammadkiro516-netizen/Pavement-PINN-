/**
 * Citizen "Aman" page: Rute Aman (route alternatives ranked by verified hazards), Pantau Area Saya
 * (watched places and what changed there) and the reports waiting for signal (Lapor Offline).
 * Watched areas live on this device only; nothing here is sent except the route/place queries.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Glyph } from '../../components/ui/brand';
import { Empty, Pill, SnapButton, SnapCard, SnapPage } from '../../components/ui/snap';
import { caseToHazard, useLiveCases } from '../../features/roles/liveCases';
import { lastDeviceFix } from '../../features/location/deviceLocation';
import { areaAlerts, hazardWeight, rankRoutes, type HazardCase, type RankedRoute, type WatchArea } from '../../domain/routing/safeRoute';

const AREAS_KEY = 'pp-watch-areas';
const SEEN_KEY = 'pp-watch-seen';

const load = <T,>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '') as T;
  } catch {
    return d;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode: kept for this visit only */
  }
};

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) throw new Error(body?.error?.message ?? `Server menjawab ${res.status}.`);
  return body as T;
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
const min = (s: number) => `${Math.max(1, Math.round(s / 60))} mnt`;

function gpsNow(): Promise<[number, number]> {
  const fix = lastDeviceFix(2 * 60_000)?.coordinates;
  if (fix) return Promise.resolve(fix);
  return new Promise((ok, fail) =>
    navigator.geolocation.getCurrentPosition((p) => ok([p.coords.latitude, p.coords.longitude]), () => fail(new Error('Izinkan akses lokasi (GPS) untuk memakai fitur ini.')), { enableHighAccuracy: true, timeout: 10_000 })
  );
}

/** Small SVG preview of the alternatives with hazard dots; the recommended route is drawn on top. */
const RoutePreview: React.FC<{ routes: RankedRoute[]; pick: number }> = ({ routes, pick }) => {
  const pts = routes.flatMap((r) => r.line);
  const lat = pts.map((p) => p[0]);
  const lng = pts.map((p) => p[1]);
  const [y0, y1, x0, x1] = [Math.min(...lat), Math.max(...lat), Math.min(...lng), Math.max(...lng)];
  const s = 300 / Math.max(y1 - y0, x1 - x0, 1e-6);
  const xy = (p: [number, number]) => `${((p[1] - x0) * s + 10).toFixed(1)},${((y1 - p[0]) * s + 10).toFixed(1)}`;
  const order = routes.map((_, i) => i).sort((a, b) => (a === pick ? 1 : b === pick ? -1 : 0));
  return (
    <svg viewBox={`0 0 ${(x1 - x0) * s + 20} ${(y1 - y0) * s + 20}`} className="h-44 w-full rounded-2xl bg-[#0B0D10]" role="img" aria-label="Pratinjau rute">
      {order.map((i) => (
        <polyline key={i} points={routes[i].line.map(xy).join(' ')} fill="none" stroke={i === pick ? '#FFD60A' : '#3A3F47'} strokeWidth={i === pick ? 4 : 3} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {routes[pick]?.hazards.map((h) => {
        const [x, y] = xy(h.at).split(',');
        return <circle key={h.id} cx={x} cy={y} r={5} fill={h.water ? '#38BDF8' : '#FF4D5E'} stroke="#0B0D10" strokeWidth={1.5} />;
      })}
    </svg>
  );
};

const SafeRoute: React.FC<{ cases: HazardCase[] }> = ({ cases }) => {
  const [q, setQ] = useState('');
  const [places, setPlaces] = useState<Array<{ name: string; at: [number, number] }>>([]);
  const [routes, setRoutes] = useState<RankedRoute[]>([]);
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dest, setDest] = useState<[number, number] | null>(null);

  const search = async () => {
    setErr(null);
    setBusy(true);
    try {
      setPlaces((await api<{ places: typeof places }>(`/api/route/geocode?q=${encodeURIComponent(q)}`)).places);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const go = async (to: [number, number]) => {
    setErr(null);
    setBusy(true);
    setPlaces([]);
    setDest(to);
    try {
      const from = await gpsNow();
      const r = await api<{ routes: Array<{ distanceM: number; durationS: number; line: Array<[number, number]> }> }>(`/api/route/alternatives?from=${from.join(',')}&to=${to.join(',')}`);
      const ranked = rankRoutes(cases, r.routes);
      setRoutes(ranked);
      setPick(Math.max(0, ranked.findIndex((x) => x.recommended)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const chosen = routes[pick];
  const gmaps = chosen && dest
    ? `https://www.google.com/maps/dir/?api=1&destination=${dest.join(',')}&travelmode=two-wheeler&waypoints=${[0.33, 0.66].map((f) => chosen.line[Math.floor(f * (chosen.line.length - 1))].join(',')).join('|')}`
    : null;

  return (
    <SnapCard>
      <p className="font-extrabold">Rute Aman</p>
      <p className="text-sm text-[#A1A1AA]">Bandingkan rute ke tujuan berdasarkan bahaya yang sudah diverifikasi petugas di sepanjang jalan (±30 m).</p>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3) void search(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tujuan, mis. Stasiun Karawang" className="min-h-11 min-w-0 flex-1 rounded-2xl border border-white/10 bg-[#0B0D10] px-3 text-sm text-white outline-none focus:border-[#FFD60A]" />
        <SnapButton type="submit" disabled={busy || q.trim().length < 3}>Cari</SnapButton>
      </form>
      {places.length > 0 && (
        <ul className="mt-2 space-y-1">
          {places.map((p) => (
            <li key={p.name}>
              <button type="button" onClick={() => void go(p.at)} className="w-full cursor-pointer rounded-xl bg-white/5 px-3 py-2 text-left text-xs hover:bg-white/10">{p.name}</button>
            </li>
          ))}
        </ul>
      )}
      {busy && <p className="mt-2 text-xs text-[#A1A1AA]">Menghitung…</p>}
      {err && <p className="mt-2 text-xs text-[#FF4D5E]">{err}</p>}
      {routes.length > 0 && (
        <div className="mt-3 space-y-2">
          <RoutePreview routes={routes} pick={pick} />
          {routes.map((r, i) => (
            <button key={i} type="button" onClick={() => setPick(i)} className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-left ${i === pick ? 'border-[#FFD60A] bg-[#FFD60A]/10' : 'border-white/10 bg-white/5'}`}>
              <span>
                <span className="block text-sm font-bold">Rute {i + 1} · {km(r.distanceM)} · {min(r.durationS)}</span>
                <span className="block text-xs text-[#A1A1AA]">
                  {r.hazards.length === 0 ? 'Tidak ada bahaya terverifikasi' : `${r.hazards.length} bahaya: ${r.hazards.slice(0, 3).map((h) => h.label + (h.water ? ' (genangan)' : '')).join(', ')}${r.hazards.length > 3 ? '…' : ''}`}
                </span>
              </span>
              {r.recommended ? <Pill tone="green">Paling aman</Pill> : <span className="text-xs text-[#A1A1AA]">skor {r.score}</span>}
            </button>
          ))}
          {chosen && chosen.hazards.some((h) => hazardWeight(h) >= 3) && <p className="text-xs text-[#FFD60A]">Hati-hati: ada bahaya berat atau genangan tanpa rambu di rute ini.</p>}
          {gmaps && (
            <a href={gmaps} target="_blank" rel="noopener noreferrer" className="block rounded-2xl bg-[#FFD60A] py-3 text-center text-sm font-extrabold text-[#0B0D10]">Arahkan lewat rute ini</a>
          )}
          <p className="text-[10px] text-[#71717A]">Rute: OSRM · © OpenStreetMap contributors. Bahaya: laporan warga yang sudah diverifikasi petugas; jalan tanpa laporan belum tentu bebas kerusakan.</p>
        </div>
      )}
    </SnapCard>
  );
};

const WatchAreas: React.FC<{ cases: HazardCase[] }> = ({ cases }) => {
  const [areas, setAreas] = useState<WatchArea[]>(() => load(AREAS_KEY, []));
  const [seenAt] = useState<string | null>(() => load<string | null>(SEEN_KEY, null));
  const [name, setName] = useState('');
  const [radius, setRadius] = useState(500);
  const [err, setErr] = useState<string | null>(null);
  const alerts = useMemo(() => areaAlerts(cases, areas, seenAt), [cases, areas, seenAt]);
  useEffect(() => () => save(SEEN_KEY, new Date().toISOString()), []);

  const add = async () => {
    setErr(null);
    try {
      const center = await gpsNow();
      const next = [...areas, { id: `${Date.now()}`, name: name.trim() || `Area ${areas.length + 1}`, center, radiusM: radius }];
      setAreas(next);
      save(AREAS_KEY, next);
      setName('');
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const remove = (id: string) => {
    const next = areas.filter((a) => a.id !== id);
    setAreas(next);
    save(AREAS_KEY, next);
  };

  return (
    <SnapCard>
      <p className="font-extrabold">Pantau Area Saya</p>
      <p className="text-sm text-[#A1A1AA]">Tandai tempat penting (rumah, sekolah, kantor). Bahaya baru yang terverifikasi dan perbaikan yang selesai di sekitarnya muncul di sini setiap kali Anda membuka halaman ini.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama, mis. Rumah" className="min-h-11 min-w-0 flex-1 rounded-2xl border border-white/10 bg-[#0B0D10] px-3 text-sm text-white outline-none focus:border-[#FFD60A]" />
        <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="min-h-11 rounded-2xl border border-white/10 bg-[#0B0D10] px-2 text-sm text-white">
          {[300, 500, 1000, 2000].map((r) => <option key={r} value={r}>{km(r)}</option>)}
        </select>
        <SnapButton type="button" onClick={() => void add()}>Tandai lokasi saya</SnapButton>
      </div>
      {err && <p className="mt-2 text-xs text-[#FF4D5E]">{err}</p>}
      {areas.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {areas.map((a) => (
            <span key={a.id} className="flex items-center gap-1 rounded-full bg-white/5 px-3 py-1 text-xs">
              {a.name} · {km(a.radiusM)}
              <button type="button" onClick={() => remove(a.id)} aria-label={`Hapus ${a.name}`} className="cursor-pointer px-1 text-[#A1A1AA]">×</button>
            </span>
          ))}
        </div>
      )}
      {areas.length > 0 && (
        <ul className="mt-3 space-y-2">
          {alerts.length === 0 && <li className="text-xs text-[#A1A1AA]">Belum ada bahaya terverifikasi atau perbaikan di area ini.</li>}
          {alerts.slice(0, 20).map((a) => (
            <li key={`${a.areaId}-${a.caseId}`} className="flex items-center justify-between gap-2 rounded-2xl bg-white/5 px-3 py-2">
              <span className="text-sm">
                <span className="font-bold">{a.kind === 'HAZARD' ? a.label : `${a.label} sudah diperbaiki`}</span>
                <span className="block text-xs text-[#A1A1AA]">{a.areaName} · {km(a.distanceM)} dari titik</span>
              </span>
              <span className="flex items-center gap-1">
                {a.fresh && <Pill tone="orange">Baru</Pill>}
                <Pill tone={a.kind === 'HAZARD' ? 'red' : 'green'}>{a.kind === 'HAZARD' ? 'Bahaya' : 'Selesai'}</Pill>
              </span>
            </li>
          ))}
        </ul>
      )}
    </SnapCard>
  );
};

export const SafetyPage: React.FC = () => {
  const live = useLiveCases();
  const cases = useMemo(() => live.map(caseToHazard), [live]);
  return (
    <SnapPage title="Aman" subtitle="Rute aman dan area yang Anda pantau.">
      <SafeRoute cases={cases} />
      <WatchAreas cases={cases} />
      {cases.length === 0 && <Empty icon={<Glyph name="map" size={26} />} title="Belum ada laporan" text="Bahaya muncul di sini setelah petugas memastikan laporan warga." />}
    </SnapPage>
  );
};
