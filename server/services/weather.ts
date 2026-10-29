/**
 * Rainfall from Open-Meteo (no key; ERA5 reanalysis archive + forecast), cached per ~11 km cell.
 * - climate: monthly rainfall of the last 12 complete months -> wet months (Oldeman 1975:
 *   a month with >= 200 mm is wet), the input PINN uses for the saturated-subgrade share.
 * - forecast: daily rain for 7 days, for the coordinator's "rain is coming" warning.
 */
import { UA } from "./authorityResolver";

export const WET_MONTH_MM = 200;
export const HEAVY_DAY_MM = 20;
const CLIMATE_TTL = 24 * 3600_000;
const FORECAST_TTL = 3 * 3600_000;

export interface MonthRain { month: string; mm: number }
export interface DayRain { date: string; mm: number; probability: number | null }
export interface WeatherSummary {
  at: [number, number];
  monthly: MonthRain[];
  annualMm: number;
  wetMonths: number;
  forecast: DayRain[];
  forecastMm: number;
  heavyDays: number;
  source: string;
  fetchedAt: string;
}

const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  return res.json();
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Pure: daily rain -> monthly totals of complete months, wet-month count. */
export function monthlyRain(dates: string[], mm: Array<number | null>): { monthly: MonthRain[]; annualMm: number; wetMonths: number } {
  const by = new Map<string, number>();
  dates.forEach((d, i) => by.set(d.slice(0, 7), (by.get(d.slice(0, 7)) ?? 0) + (mm[i] ?? 0)));
  const monthly = [...by.entries()].map(([month, v]) => ({ month, mm: Math.round(v) }));
  return { monthly, annualMm: monthly.reduce((s, m) => s + m.mm, 0), wetMonths: monthly.filter((m) => m.mm >= WET_MONTH_MM).length };
}

export async function weatherAt(lat: number, lng: number, now = new Date()): Promise<WeatherSummary> {
  const cell = [Math.round(lat * 10) / 10, Math.round(lng * 10) / 10] as [number, number];
  const key = cell.join(",");
  const climate = await cached(`c:${key}`, CLIMATE_TTL, async () => {
    // 12 complete months ending with the month before last (the archive lags a few days).
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 0));
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
    const d = await getJson(`https://archive-api.open-meteo.com/v1/archive?latitude=${cell[0]}&longitude=${cell[1]}&start_date=${iso(start)}&end_date=${iso(end)}&daily=precipitation_sum&timezone=Asia%2FJakarta`);
    return monthlyRain(d.daily.time, d.daily.precipitation_sum);
  });
  const forecast = await cached(`f:${key}`, FORECAST_TTL, async () => {
    const d = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${cell[0]}&longitude=${cell[1]}&daily=precipitation_sum,precipitation_probability_max&forecast_days=7&timezone=Asia%2FJakarta`);
    return (d.daily.time as string[]).map((date, i) => ({ date, mm: Math.round((d.daily.precipitation_sum[i] ?? 0) * 10) / 10, probability: d.daily.precipitation_probability_max?.[i] ?? null }));
  });
  return {
    at: cell,
    ...climate,
    forecast,
    forecastMm: Math.round(forecast.reduce((s, f) => s + f.mm, 0)),
    heavyDays: forecast.filter((f) => f.mm >= HEAVY_DAY_MM).length,
    source: "Open-Meteo (ERA5 reanalysis & forecast) · CC BY 4.0",
    fetchedAt: new Date().toISOString()
  };
}
