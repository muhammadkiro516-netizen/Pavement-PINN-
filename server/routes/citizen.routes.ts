import type { Request, Response, Router } from "express";
import { rateLimit } from "../middleware/rateLimit";
import { actorFrom } from "../auth/actor";
import { UA } from "../services/authorityResolver";
import type { WorkflowRuntime } from "../services/workflowRuntime";

/**
 * "Rute Aman": place search (Nominatim) and route alternatives (OSRM public server), both
 * OpenStreetMap data. The app ranks the alternatives against verified hazards on the device,
 * with the same case list Radar Bahaya uses. Coordinates go to these services; nothing is stored.
 */
function fail(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ success: false, error: { code, message } });
}

const coord = (v: unknown): [number, number] | null => {
  const [lat, lng] = String(v ?? "").split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
};

async function getJson(url: string, ms: number): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Keeps at most `max` points of a long polyline (first and last always kept). */
function thin(line: Array<[number, number]>, max = 400): Array<[number, number]> {
  if (line.length <= max) return line;
  const step = (line.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => line[Math.round(i * step)]);
}

export function registerCitizenRoutes(router: Router, runtime: WorkflowRuntime): void {
  const limit = rateLimit("safe-route", 30, 60_000, (req) => actorFrom(req, runtime)?.id ?? null);

  router.get("/api/route/geocode", limit, async (req: Request, res: Response) => {
    if (!actorFrom(req, runtime)) return fail(res, 401, "UNAUTHENTICATED", "Masuk untuk memakai Rute Aman.");
    const q = String(req.query.q ?? "").trim().slice(0, 120);
    if (q.length < 3) return fail(res, 422, "VALIDATION", "Ketik minimal 3 huruf.");
    try {
      const rows = await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=id&limit=5&accept-language=id&q=${encodeURIComponent(q)}`, 5000);
      res.json({ success: true, places: (rows as any[]).map((r) => ({ name: String(r.display_name), at: [Number(r.lat), Number(r.lon)] })) });
    } catch {
      fail(res, 503, "GEOCODER_UNAVAILABLE", "Pencarian alamat sedang tidak tersedia. Coba lagi.");
    }
  });

  router.get("/api/route/alternatives", limit, async (req: Request, res: Response) => {
    if (!actorFrom(req, runtime)) return fail(res, 401, "UNAUTHENTICATED", "Masuk untuk memakai Rute Aman.");
    const from = coord(req.query.from);
    const to = coord(req.query.to);
    if (!from || !to) return fail(res, 422, "VALIDATION", "Titik awal dan tujuan wajib (lat,lng).");
    try {
      const d = await getJson(`https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?alternatives=3&overview=full&geometries=geojson`, 8000);
      if (d.code !== "Ok") return fail(res, 422, "NO_ROUTE", "Rute tidak ditemukan.");
      const routes = (d.routes as any[]).map((r) => ({
        distanceM: Math.round(r.distance),
        durationS: Math.round(r.duration),
        line: thin((r.geometry.coordinates as Array<[number, number]>).map(([lng, lat]) => [lat, lng] as [number, number]))
      }));
      res.json({ success: true, routes, source: "OSRM · © OpenStreetMap contributors" });
    } catch {
      fail(res, 503, "ROUTER_UNAVAILABLE", "Layanan rute sedang tidak tersedia. Coba lagi.");
    }
  });
}
