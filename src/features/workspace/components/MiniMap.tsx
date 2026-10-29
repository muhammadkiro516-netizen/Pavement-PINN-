/**
 * Small MapLibre map of the report's objects (severity colour; grey = not assessed). Same globe and SATELLITE
 * basemap chain as Peta Jalan (MapTiler hybrid with a key, else Esri World Imagery); opens on the globe and flies to the report. Click a point =
 * select that object in every tab.
 */
import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { basemapCandidates } from '../../../components/maps/vectorBasemap';
import type { DamageObject } from '../../../domain/workspace/types';

// Same worker wiring as components/maps/MapLibreMap.tsx (MapLibre 6 loads its worker separately).
maplibregl.setWorkerUrl(maplibreWorkerUrl);

const SEVERITY_COLOR: Record<string, string> = { high: '#EF4444', medium: '#F59E0B', low: '#22C55E' };

export const MiniMap: React.FC<{ objects: DamageObject[]; activeId: string | null; onSelect: (id: string) => void }> = ({ objects, activeId, onSelect }) => {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!ref.current || objects.length === 0) return;
    // Same basemap chain and globe projection as the public road map (Peta Jalan):
    // MapTiler when a key is set, otherwise OpenFreeMap, then the next candidate on error.
    const candidates = basemapCandidates('SATELLITE', import.meta.env.VITE_MAPTILER_KEY);
    let stage = 0;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: ref.current,
        style: candidates[0].style as maplibregl.StyleSpecification | string,
        center: [objects[0].location.lon, 0],
        zoom: 1.6,
        attributionControl: { compact: true }
      });
    } catch {
      return; // no WebGL: the object table beside the map still lists every object
    }
    mapRef.current = map;
    const target = () => {
      if (objects.length > 1) {
        const b = new maplibregl.LngLatBounds();
        objects.forEach((o) => b.extend([o.location.lon, o.location.lat]));
        map.fitBounds(b, { padding: 60, maxZoom: 18, duration: 3500 });
      } else map.flyTo({ center: [objects[0].location.lon, objects[0].location.lat], zoom: 17, duration: 3500 });
    };
    map.on('style.load', () => {
      map.setProjection({ type: 'globe' });
      target();
    });
    map.on('error', (e) => {
      // Basemap failed: try the next provider (same fallback order as Peta Jalan).
      if (!/style|source|tile/i.test(String(e?.error?.message ?? '')) || stage >= candidates.length - 1) return;
      stage += 1;
      map.setStyle(candidates[stage].style as maplibregl.StyleSpecification | string);
    });
    return () => map.remove();
  }, [objects.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markers.current.forEach((m) => m.remove());
    markers.current = objects.map((o) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.title = o.objectId;
      el.setAttribute('aria-label', o.objectId);
      const active = o.objectId === activeId;
      el.style.cssText = `width:${active ? 18 : 13}px;height:${active ? 18 : 13}px;border-radius:9999px;background:${SEVERITY_COLOR[o.severity.value ?? ''] ?? '#94A3B8'};border:2px solid ${active ? '#FFD60A' : '#0A0F14'};cursor:pointer`;
      el.onclick = () => onSelect(o.objectId);
      return new maplibregl.Marker({ element: el }).setLngLat([o.location.lon, o.location.lat]).addTo(map);
    });
  }, [objects, activeId, onSelect]);

  return <div ref={ref} className="h-72 w-full overflow-hidden rounded-xl bg-[#0B121A]" data-testid="mini-map" />;
};
