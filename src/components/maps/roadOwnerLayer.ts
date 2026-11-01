/**
 * Road-owner colours on the map, as one optional layer: colour says who owns the road, line style
 * says how sure we are. Colours are the app's own palette on the dark base map.
 */
import type * as maplibregl from 'maplibre-gl';
import { apiUrl } from '../../services/api/client';

export const ROAD_OWNER_COLORS: Record<string, string> = {
  NASIONAL: '#4C8DFF',
  TOL: '#F5F7FA',
  PROVINSI: '#FF6B2C',
  KABUPATEN: '#38BDF8',
  KOTA: '#38BDF8',
  DESA: '#2BD67B',
  KHUSUS: '#8E8E93',
  UNKNOWN: '#8E8E93'
};

export interface RoadOwnerTap { name: string | null; status: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW' }

const SOURCE = 'road-owner';
const MIN_ZOOM = 11;
const DASH: Record<string, number[] | undefined> = { HIGH: undefined, MEDIUM: [3, 2], LOW: [0.6, 2] };

let visible = false;
let attached: maplibregl.Map | null = null;
let onTap: ((road: RoadOwnerTap) => void) | null = null;
const zoomListeners = new Set<(tooFar: boolean) => void>();

const layerIds = Object.keys(DASH).map((c) => `${SOURCE}-${c}`);

function colorExpression(): maplibregl.ExpressionSpecification {
  const stops = Object.entries(ROAD_OWNER_COLORS).flat();
  return ['match', ['get', 'status'], ...stops, '#8E8E93'] as unknown as maplibregl.ExpressionSpecification;
}

async function refresh() {
  const map = attached;
  if (!map || !visible) return;
  zoomListeners.forEach((fn) => fn(map.getZoom() < MIN_ZOOM));
  if (map.getZoom() < MIN_ZOOM) return;
  const b = map.getBounds();
  const reply = await fetch(apiUrl(`/api/v5/public/segments?bbox=${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`)).then((r) => r.json()).catch(() => null);
  const source = attached?.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (reply?.success && source && visible) source.setData(reply.data);
}

// A style change drops the layers but keeps the map's listeners, so listeners bind only once.
const bound = new WeakSet<maplibregl.Map>();

export function attachRoadOwners(map: maplibregl.Map) {
  if (map.getSource(SOURCE)) return;
  attached = map;
  const firstTime = !bound.has(map);
  bound.add(map);
  map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  for (const [confidence, dash] of Object.entries(DASH)) {
    const id = `${SOURCE}-${confidence}`;
    map.addLayer({
      id,
      type: 'line',
      source: SOURCE,
      filter: ['==', ['get', 'confidence'], confidence],
      layout: { visibility: visible ? 'visible' : 'none', 'line-cap': dash ? 'butt' : 'round' },
      paint: {
        'line-color': colorExpression(),
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 6],
        'line-opacity': confidence === 'LOW' ? 0.75 : 0.95,
        ...(dash ? { 'line-dasharray': dash } : {})
      }
    });
    if (firstTime) {
      map.on('click', id, (e) => {
        const p = e.features?.[0]?.properties as RoadOwnerTap | undefined;
        if (p) onTap?.({ name: p.name && p.name !== 'null' ? p.name : null, status: p.status, confidence: p.confidence });
      });
    }
  }
  if (firstTime) map.on('moveend', () => void refresh());
  void refresh();
}

export function setRoadOwnersVisible(on: boolean) {
  visible = on;
  const map = attached;
  if (map) for (const id of layerIds) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  void refresh();
}

export function onRoadOwnerTap(fn: ((road: RoadOwnerTap) => void) | null) {
  onTap = fn;
}

/** Tells the page when the map is too far out to show road colours. */
export function onRoadOwnerZoom(fn: (tooFar: boolean) => void): () => void {
  zoomListeners.add(fn);
  return () => { zoomListeners.delete(fn); };
}
