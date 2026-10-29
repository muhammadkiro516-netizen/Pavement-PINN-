/** Rainfall at a point from the server's Open-Meteo relay (server/services/weather.ts). */
import { useEffect, useState } from 'react';
import { apiUrl } from '../../services/api/client';

export interface Weather {
  monthly: Array<{ month: string; mm: number }>;
  annualMm: number;
  wetMonths: number;
  forecast: Array<{ date: string; mm: number; probability: number | null }>;
  forecastMm: number;
  heavyDays: number;
  source: string;
}

export function useWeather(at: [number, number] | null | undefined): { weather: Weather | null; error: string | null } {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = at ? `${at[0].toFixed(3)},${at[1].toFixed(3)}` : '';
  useEffect(() => {
    if (!key) return;
    let live = true;
    fetch(apiUrl(`/api/weather?at=${key}`))
      .then(async (r) => {
        const b = await r.json().catch(() => null);
        if (!r.ok || !b?.success) throw new Error(b?.error?.message ?? `HTTP ${r.status}`);
        if (live) setWeather(b.weather as Weather);
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [key]);
  return { weather, error };
}
