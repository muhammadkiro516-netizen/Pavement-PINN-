import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 loads its worker from a separate module. Resolving it through the bundler keeps
// the URL correct in the dev server (pre-bundled dependencies) and in the production build.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { AlertTriangle } from 'lucide-react';
import { LeafletMap, type LeafletMapProps, createActivePinMarkerHtml } from './LeafletMap';
import { prefersReducedMotion } from '../ui/motion';
import { paviMarkerHtml } from '../brand/Pavi';
import { distanceMeters } from '../../domain/workflow/screening';
import { readPaviHelmet, readPavi } from '../brand/paviPrefs';
import type { DamageReport, RoadSegment } from '../../types';
import {
  LocationSelection,
  createLocationSelection,
  resolveRoadSelection,
  isValidCoordinate,
  DEFAULT_ROAD_SEARCH_RADIUS_METERS
} from '../../domain/geo/locationSelection';
import { INITIAL_TILE_HEALTH, TileHealth, recordTileError, recordTileLoad } from './basemap';
import { BasemapCandidate, basemapCandidates } from './vectorBasemap';
import { CLUSTER_MAX_ZOOM, SEGMENT_LINE_MIN_ZOOM, clusterByPixelDistance } from './mapDetail';
import { SEVERITY_COLOR, lngLatBounds, reportsToGeoJson, segmentsToGeoJson, toLngLat } from './mapGeoJson';
import { DEMO_DATA_LABEL, DEMO_DATA_NOTE } from '../../data/provenance';
import { selectRegularUserDensity } from '../../features/community-reports/reportDensity';
import { getCanonicalRoadGeometry, toLeafletPolyline } from '../../domain/geo/canonicalRoadGeometry';
import { assetUrl, NO_COVERAGE_PATH, reportPhotoCaption } from '../../domain/reports/datasetImages';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

/**
 * MapLibre counts zoom on 512 px tiles, the thresholds in mapDetail on 256 px tiles:
 * the same ground scale is one zoom level lower here.
 */
const ZOOM_OFFSET = 1;
const LINE_MIN_ZOOM = SEGMENT_LINE_MIN_ZOOM - ZOOM_OFFSET;
const REPORT_MAX_CLUSTER_ZOOM = CLUSTER_MAX_ZOOM - ZOOM_OFFSET;
/** Below this zoom a tap on empty map is navigation, not the start of a report. */
const PICK_POINT_MIN_ZOOM = 11;
/** Centre of the bundled demo data (Karawang), used when no device position is available. */
const DATA_REGION: [number, number] = [107.318, -6.305];
const HOME_ZOOM = 11;

/** Camera state machine phases for the cinematic entry animation */
export type MapCameraPhase =
  | 'IDLE'
  | 'GLOBE_ROTATION'
  | 'INDONESIA_TRANSITION'
  | 'JAVA_ZOOM'
  | 'REGIONAL_READY';

/** Initial 3D Globe camera settings (Reference 1: Asia, Southeast Asia, Indonesia, Australia in view) */
export const GLOBE_INITIAL_CENTER: [number, number] = [115.0, 10.0];
export const GLOBE_INITIAL_ZOOM = 1.85;

/** Intermediate Indonesia viewpoint (Phase B) */
export const INDONESIA_INTERMEDIATE_CENTER: [number, number] = [108.5, -6.8];
export const INDONESIA_INTERMEDIATE_ZOOM = 5.2;

/** Regional Java bounding box (Reference 2: Jabodetabek, Bekasi, Karawang, Purwakarta) */
export const REGIONAL_JAVA_BOUNDS: [[number, number], [number, number]] = [
  [106.2, -6.9], // Southwest [west, south]
  [108.0, -5.8]  // Northeast [east, north]
];

/** Zoom threshold: below this is 3D globe mode, above/equal is flat regional/local map */
export const GLOBE_MAX_ROTATION_ZOOM = 4.0;

/** Auto-rotation speed in degrees longitude per second (~3.5 deg/sec is gentle and natural) */
export const ROTATION_SPEED_DEG_PER_SEC = 3.5;

/** Cinematic Entry Animation Phase Durations in milliseconds (total sequence ~5.4s within the 4-6s target) */
export const PHASE_A_ROTATION_DURATION_MS = 1600;
export const PHASE_B_TRANSITION_DURATION_MS = 1800;
export const PHASE_C_ZOOM_DURATION_MS = 2000;

/** Cooldown in ms after user interaction before auto-rotation resumes */
const INTERACTION_RESUME_DELAY_MS = 1000;

/** Shown when a pin photo is missing or fails to load (never a stock photo). */
const NO_PHOTO_URL = assetUrl(NO_COVERAGE_PATH, import.meta.env.BASE_URL);

const SEGMENT_SOURCE = 'pp-segments';
const REPORT_SOURCE = 'pp-reports';
const DENSITY_SOURCE = 'pp-report-density';
/** With the density layer on, individual reports appear again from this (256 px) zoom. */
const DENSITY_MARKER_MIN_ZOOM = 13;
const LAYER = {
  density: 'pp-density',
  casing: 'pp-segment-selected-casing',
  line: 'pp-segment-line',
  selected: 'pp-segment-selected',
  hit: 'pp-segment-hit'
} as const;

const LINE_WIDTH = (extra: number): unknown => [
  'interpolate',
  ['linear'],
  ['zoom'],
  8,
  2 + extra,
  12,
  4 + extra,
  16,
  7 + extra
];

function filterReports(reports: DamageReport[], activeFilter: string): DamageReport[] {
  return reports.filter((report) => {
    if (activeFilter === 'CRITICAL') return report.severity === 'CRITICAL';
    if (activeFilter === 'MODERATE') return report.severity === 'SEVERE' || report.severity === 'MODERATE';
    if (activeFilter === 'MINOR') return report.severity === 'LIGHT';
    return true;
  });
}

/**
 * Public map on MapLibre GL JS: one camera from the globe down to street level.
 *
 * Road segments and report density are style layers; reports and their count markers
 * are DOM markers grouped by on-screen distance, so a count always equals the number of
 * reports it stands for. If WebGL is not available the Leaflet map is rendered instead.
 */
const MapLibreMap: React.FC<LeafletMapProps> = (props) => {
  const {
    roadSegments,
    selectedSegment,
    onSelectSegment,
    communityReports = [],
    activeFilter = 'ALL',
    showDensity = false,
    language = 'id',
    baseMapStyle = 'LIGHT',
    onSelectReport,
    onSelectCluster,
    onViewportChange,
    onOpenReportModalWithLocation,
    recenterKey = 0,
    highlightReportId = null,
    mapCenterTarget = null,
    signedReportIds,
    userLocation = null,
    bottomInsetPx = 0,
    activePinCoordinates = null,
    onActivePinChange,
    compact = false,
    isTabActive = true,
    entryAnimationKey = 0
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const styleReadyRef = useRef(false);
  const candidatesRef = useRef<BasemapCandidate[]>([]);
  const stageRef = useRef(0);
  const healthRef = useRef<TileHealth>(INITIAL_TILE_HEALTH);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  // A report at the user's own spot is held by Pavi instead of drawn as a separate pin.
  const heldRef = useRef<{ photoUrl: string; color: string } | null>(null);
  const pickPopupRef = useRef<maplibregl.Popup | null>(null);
  const pickMarkerRef = useRef<maplibregl.Marker | null>(null);
  const pickAbortControllerRef = useRef<AbortController | null>(null);
  const pickRequestIdRef = useRef<string | null>(null);
  const zoomBucketRef = useRef<number>(-1);
  const viewBeforeSelectionRef = useRef<{ center: maplibregl.LngLat; zoom: number } | null>(null);
  const mountedRef = useRef(false);

  // Auto-rotation and camera state tracking
  const isInteractingRef = useRef(false);
  const resumeTimerRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const fixedLatRef = useRef<number | null>(null);
  const isAutoRotatingRef = useRef(false);

  // Cinematic globe-to-Java camera state machine refs
  const cameraPhaseRef = useRef<MapCameraPhase>('IDLE');
  const phaseTimerRef = useRef<number | null>(null);
  const cancellationTokenRef = useRef(0);
  const prevEntryKeyRef = useRef<number>(entryAnimationKey);
  const prevTabActiveRef = useRef<boolean>(isTabActive);

  const [unsupported, setUnsupported] = useState(false);
  const [basemapStage, setBasemapStage] = useState(0);
  const [localHighlightId, setLocalHighlightId] = useState<string | null>(null);

  // Latest props for handlers that are registered once
  const latest = useRef({
    roadSegments,
    selectedSegment,
    onSelectSegment,
    reports: filterReports(communityReports, activeFilter),
    densityReports: selectRegularUserDensity(communityReports, activeFilter).reports,
    showDensity,
    language,
    onSelectReport,
    onSelectCluster,
    onViewportChange,
    onOpenReportModalWithLocation,
    highlightReportId,
    bottomInsetPx,
    activePinCoordinates,
    onActivePinChange,
    userLocation,
    signedReportIds
  });
  latest.current = {
    roadSegments,
    selectedSegment,
    onSelectSegment,
    reports: filterReports(communityReports, activeFilter),
    densityReports: selectRegularUserDensity(communityReports, activeFilter).reports,
    showDensity,
    language,
    onSelectReport,
    onSelectCluster,
    onViewportChange,
    onOpenReportModalWithLocation,
    highlightReportId,
    bottomInsetPx,
    activePinCoordinates,
    onActivePinChange,
    userLocation,
    signedReportIds
  };

  const applyCandidate = (index: number) => {
    const map = mapRef.current;
    const candidate = candidatesRef.current[index];
    if (!map || !candidate) return;
    stageRef.current = index;
    styleReadyRef.current = false;
    healthRef.current = INITIAL_TILE_HEALTH;
    setBasemapStage(index);
    map.setStyle(candidate.style as maplibregl.StyleSpecification | string, { diff: false });
  };

  const tryNextCandidate = () => {
    if (stageRef.current < candidatesRef.current.length - 1) applyCandidate(stageRef.current + 1);
  };

  const reportViewport = (moving: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    latest.current.onViewportChange?.({
      zoom: map.getZoom() + ZOOM_OFFSET,
      bounds: [
        [bounds.getSouth(), bounds.getWest()],
        [bounds.getNorth(), bounds.getEast()]
      ],
      moving
    });
  };

  // Stop any active camera intro animation immediately and transition to REGIONAL_READY
  const cancelIntroAnimation = (reason = 'user_interrupted') => {
    if (cameraPhaseRef.current === 'REGIONAL_READY') return;
    cancellationTokenRef.current += 1;
    if (phaseTimerRef.current !== null) {
      window.clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (mapRef.current) {
      mapRef.current.stop();
    }
    cameraPhaseRef.current = 'REGIONAL_READY';
  };

  // Smooth westward globe rotation loop across 3D globe mode (surface moving to the left)
  const startRotationLoop = () => {
    if (rafIdRef.current !== null) return;
    let lastTime = performance.now();

    const frame = (time: number) => {
      rafIdRef.current = requestAnimationFrame(frame);

      const dt = (time - lastTime) / 1000;
      lastTime = time;

      const currentMap = mapRef.current;
      if (!currentMap || !styleReadyRef.current) return;

      // Only allow auto-rotation during GLOBE_ROTATION phase or when settled at REGIONAL_READY with manual zoom < 4.0
      if (cameraPhaseRef.current !== 'GLOBE_ROTATION' && cameraPhaseRef.current !== 'REGIONAL_READY') {
        return;
      }

      // 1. Check projection: must be globe
      const projection = currentMap.getProjection();
      const isGlobe = projection?.type === 'globe' || (projection as { name?: string })?.name === 'globe';
      if (!isGlobe) return;

      // 2. Check zoom: if zoom >= GLOBE_MAX_ROTATION_ZOOM, mode is FLAT MAP -> STOP ROTATION COMPLETELY
      const currentZoom = currentMap.getZoom();
      if (currentZoom >= GLOBE_MAX_ROTATION_ZOOM) return;

      // 3. Check user interaction: paused while user is touching/dragging/zooming,
      //    and while a report is selected (its detail is open), so the pin stays put
      if (isInteractingRef.current || latest.current.highlightReportId) return;

      // 4. Check if map is running a programmatic easeTo/flyTo
      if (currentMap.isMoving() && !isAutoRotatingRef.current) return;

      // 5. Delta time safety clamp (avoids huge jump when tab was backgrounded or frozen)
      if (dt > 1) return;
      const clampedDt = Math.min(Math.max(dt, 0), 0.1);
      if (clampedDt <= 0) return;

      const center = currentMap.getCenter();
      if (fixedLatRef.current === null || isNaN(fixedLatRef.current)) {
        fixedLatRef.current = center.lat;
      }

      const dLng = ROTATION_SPEED_DEG_PER_SEC * clampedDt;
      let nextLng = center.lng + dLng;
      // Wrap longitude within [-180, 180]
      nextLng = ((((nextLng + 180) % 360) + 360) % 360) - 180;

      isAutoRotatingRef.current = true;
      try {
        currentMap.jumpTo(
          { center: [nextLng, fixedLatRef.current] },
          { autoRotation: true }
        );
      } finally {
        isAutoRotatingRef.current = false;
      }
    };

    rafIdRef.current = requestAnimationFrame(frame);
  };

  // Phase D: Settle and Ready — camera has arrived at regional Java bounds
  const settleToReady = (token: number) => {
    if (cancellationTokenRef.current !== token) return;
    cameraPhaseRef.current = 'REGIONAL_READY';
    phaseTimerRef.current = null;
    reportViewport(false);
  };

  // Phase C: Regional Zoom — smooth zoom into Jabodetabek, Bekasi, Karawang, Purwakarta
  const transitionToPhaseC = (token: number) => {
    const map = mapRef.current;
    if (!map || cancellationTokenRef.current !== token) return;

    cameraPhaseRef.current = 'JAVA_ZOOM';

    const padding = { top: 70, bottom: 80, left: 40, right: 40 };
    const cubicOut = (t: number) => 1 - Math.pow(1 - t, 3);

    const targetCam = map.cameraForBounds(REGIONAL_JAVA_BOUNDS, { padding, maxZoom: 9.6 });
    if (targetCam) {
      map.easeTo({
        center: targetCam.center,
        zoom: targetCam.zoom,
        duration: PHASE_C_ZOOM_DURATION_MS,
        easing: cubicOut,
        essential: true
      });
    } else {
      map.fitBounds(REGIONAL_JAVA_BOUNDS, {
        padding,
        maxZoom: 9.6,
        duration: PHASE_C_ZOOM_DURATION_MS,
        essential: true
      });
    }

    phaseTimerRef.current = window.setTimeout(() => {
      if (cancellationTokenRef.current !== token) return;
      settleToReady(token);
    }, PHASE_C_ZOOM_DURATION_MS + 20);
  };

  // Phase B: Transition to Indonesia — decelerate horizontal rotation and orient towards Indonesia & Java
  const transitionToPhaseB = (token: number) => {
    const map = mapRef.current;
    if (!map || cancellationTokenRef.current !== token) return;

    // Gracefully stop horizontal rotation loop so jumpTo does not fight easeTo
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    cameraPhaseRef.current = 'INDONESIA_TRANSITION';

    const cubicInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    map.easeTo({
      center: INDONESIA_INTERMEDIATE_CENTER,
      zoom: INDONESIA_INTERMEDIATE_ZOOM,
      duration: PHASE_B_TRANSITION_DURATION_MS,
      easing: cubicInOut,
      essential: true
    });

    phaseTimerRef.current = window.setTimeout(() => {
      if (cancellationTokenRef.current !== token) return;
      transitionToPhaseC(token);
    }, PHASE_B_TRANSITION_DURATION_MS + 20);
  };

  // Phase A: Globe Reveal — starts 3D globe showing Southeast Asia & Indonesia and rotates slowly
  const startCameraSequence = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;

    if (compact || prefersReducedMotion()) {
      cameraPhaseRef.current = 'REGIONAL_READY';
      const padding = { top: 70, bottom: 80, left: 40, right: 40 };
      const targetCam = map.cameraForBounds(REGIONAL_JAVA_BOUNDS, { padding, maxZoom: 9.6 });
      if (targetCam) {
        map.jumpTo({ center: targetCam.center, zoom: targetCam.zoom });
      } else {
        map.fitBounds(REGIONAL_JAVA_BOUNDS, { padding, maxZoom: 9.6, duration: 0 });
      }
      reportViewport(false);
      return;
    }

    cancellationTokenRef.current += 1;
    const token = cancellationTokenRef.current;

    if (phaseTimerRef.current !== null) {
      window.clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    map.setProjection({ type: 'globe' });

    // Ensure camera starts on Reference 1 outer space globe view
    const currentZ = map.getZoom();
    if (currentZ > 4.0 || Math.abs(currentZ - GLOBE_INITIAL_ZOOM) > 0.5) {
      map.jumpTo({ center: GLOBE_INITIAL_CENTER, zoom: GLOBE_INITIAL_ZOOM });
    }

    // Phase A: GLOBE_ROTATION
    cameraPhaseRef.current = 'GLOBE_ROTATION';
    fixedLatRef.current = GLOBE_INITIAL_CENTER[1];
    startRotationLoop();

    phaseTimerRef.current = window.setTimeout(() => {
      if (cancellationTokenRef.current !== token) return;
      transitionToPhaseB(token);
    }, PHASE_A_ROTATION_DURATION_MS);
  };

  const renderMarkers = () => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    const { reports, showDensity: densityOn, language: lang, highlightReportId: propHighlighted } = latest.current;
    const effectiveHighlightId = propHighlighted || localHighlightId;
    // Density hides the markers at area scale; closer in, the individual reports come back
    if (densityOn && map.getZoom() + ZOOM_OFFSET < DENSITY_MARKER_MIN_ZOOM) return;

    const clusters = clusterByPixelDistance(reports, (report) => report.coordinates, map.getZoom() + ZOOM_OFFSET);
    for (const cluster of clusters) {
      const element = document.createElement('button');
      element.type = 'button';
      element.style.cssText =
        'padding:0;border:2px solid #ffffff;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(15,23,42,0.35);';

      if (cluster.items.length > 1) {
        const count = cluster.items.length;
        const size = count >= 10 ? 44 : count >= 5 ? 38 : 32;
        const label =
          lang === 'en'
            ? `${count} reports here (a count of reports, not a damage level)`
            : `${count} laporan di sini (jumlah laporan, bukan tingkat kerusakan)`;
        element.className = 'report-cluster-marker';
        element.setAttribute('aria-label', label);
        element.title = label;
        element.textContent = String(count);
        element.style.cssText += `width:${size}px;height:${size}px;background:#1e293b;color:#ffffff;font:700 13px system-ui,-apple-system,sans-serif;`;
        element.addEventListener('click', (event) => {
          event.stopPropagation();
          cancelIntroAnimation('cluster_click');
          const bounds = lngLatBounds(cluster.items.map((report) => report.coordinates));
          if (!bounds) return;
          const samePosition = bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1];
          if (samePosition && latest.current.onSelectCluster) {
            latest.current.onSelectCluster(cluster.items);
            return;
          }
          const currentZoom = map.getZoom();
          const isPoint = Math.abs(bounds[0][0] - bounds[1][0]) < 0.0001 && Math.abs(bounds[0][1] - bounds[1][1]) < 0.0001;
          if (isPoint) {
            const nextZoom = Math.min(Math.max(currentZoom + 2.5, 14), 16);
            map.flyTo({
              center: toLngLat(cluster.center),
              zoom: nextZoom,
              duration: 700
            });
          } else {
            map.fitBounds(bounds, { padding: 80, maxZoom: REPORT_MAX_CLUSTER_ZOOM + 1, duration: 750 });
          }
        });
      } else {
        const report = cluster.items[0];
        const here = latest.current.userLocation?.coordinates;
        if (here && distanceMeters(here, report.coordinates) <= 30) {
          heldRef.current = { photoUrl: report.photoUrl, color: report.status === 'REPAIRED' ? '#2BD67B' : SEVERITY_COLOR[report.severity] };
          element.style.display = 'none';
          const um = userMarkerRef.current?.getElement();
          if (um) um.innerHTML = paviMarkerHtml(readPavi().helmet, readPavi().vest, heldRef.current);
        }
        const color = report.status === 'REPAIRED' ? '#57ae78' : SEVERITY_COLOR[report.severity];
        const isHighlighted = report.id === effectiveHighlightId;
        // The badge says something true about the report: repaired, warning sign on site, or water.
        const badge =
          report.status === 'REPAIRED'
            ? { bg: '#2BD67B', fg: '#0B0D10', text: '&#10003;', title: 'Sudah diperbaiki' }
            : latest.current.signedReportIds?.has(report.id)
            ? { bg: '#FF6B2C', fg: '#0B0D10', text: '!', title: 'Rambu sementara terpasang' }
            : report.cvAssessment?.hazards?.includes('GENANGAN')
            ? { bg: '#38BDF8', fg: '#0B0D10', text: '~', title: 'Genangan' }
            : null;

        element.className = 'clean-damage-pin-marker report-marker';
        element.dataset.reportId = report.id;
        element.setAttribute('aria-label', `${report.damageTypeLabel} (${report.id})`);
        element.title = `${report.damageTypeLabel} — ${reportPhotoCaption(report, 'Foto ilustrasi')}`;
        // Height fits the content so the element's bottom edge is the pin's tip: anchored at
        // 'bottom', the tip sits exactly on the report's coordinates at every zoom and projection.
        element.style.cssText = `width:52px;display:flex;justify-content:center;cursor:pointer;padding:0;border:0;background:none;${isHighlighted ? 'z-index:30;' : ''}`;

        const markerShadow = isHighlighted
          ? '0 0 0 3px #f59e0b, 0 0 20px rgba(245,158,11,0.9), 0 4px 10px rgba(0,0,0,0.5)'
          : '0 2px 6px rgba(0,0,0,0.22)';

        element.innerHTML = `
          <div class="pp-pin-inner" style="position:relative;display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 4px 10px rgba(0,0,0,0.3));transform-origin:50% 100%;${isHighlighted ? 'transform:scale(1.15);' : ''}">
            <div style="position:relative;width:40px;height:40px;border-radius:50%;background:#ffffff;border:3px solid ${isHighlighted ? '#f59e0b' : color};box-shadow:${markerShadow};display:flex;align-items:center;justify-content:center;">
              ${report.status !== 'REPAIRED' && (report.severity === 'SEVERE' || report.severity === 'CRITICAL') ? `<span class="pp-pin-pulse" style="border-color:${color}"></span>` : ''}
              <img src="${report.photoUrl}" alt="${report.damageTypeLabel}" decoding="async" onerror="this.onerror=null;this.src='${NO_PHOTO_URL}'" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" />
              ${badge ? `<div title="${badge.title}" style="position:absolute;top:-5px;right:-5px;width:18px;height:18px;border-radius:999px;background-color:${badge.bg};color:${badge.fg};font-size:11px;font-weight:900;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;border:2px solid #0B0D10;box-shadow:0 2px 4px rgba(0,0,0,0.3);z-index:10;line-height:1;">${badge.text}</div>` : ''}
            </div>
            <div style="width:0;height:0;border-left:5.5px solid transparent;border-right:5.5px solid transparent;border-top:7px solid ${isHighlighted ? '#f59e0b' : color};margin-top:-1px;"></div>
          </div>
        `;

        element.addEventListener('click', (event) => {
          event.stopPropagation();
          cancelIntroAnimation('report_marker_click');
          setLocalHighlightId(report.id);
          const currentZoom = map.getZoom();
          const targetZoom = Math.max(currentZoom, 15);
          map.flyTo({
            center: toLngLat(report.coordinates),
            zoom: targetZoom,
            duration: 700
          });
          latest.current.onSelectReport?.(report);
        });
      }

      // MapLibre moves a marker by rewriting its root element's transform every frame, so the root
      // carries no transition or transform of its own (either would make pins lag or jump while the
      // map scrolls/zooms). The highlight scale sits on the inner pin, growing from the tip.
      // Cluster circles are centred on their group; a single report pin points with its tip.
      const anchor = cluster.items.length > 1 ? 'center' : 'bottom';
      markersRef.current.push(new maplibregl.Marker({ element, anchor }).setLngLat(toLngLat(cluster.center)).addTo(map));
    }
  };

  const syncLayers = () => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    const segmentSource = map.getSource(SEGMENT_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const reportSource = map.getSource(REPORT_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!segmentSource || !reportSource) return;
    const { roadSegments: segments, reports, showDensity: densityOn, selectedSegment: selected } = latest.current;
    segmentSource.setData(segmentsToGeoJson(segments) as never);
    reportSource.setData(reportsToGeoJson(reports) as never);
    (map.getSource(DENSITY_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
      reportsToGeoJson(latest.current.densityReports) as never
    );
    map.setLayoutProperty(LAYER.density, 'visibility', densityOn ? 'visible' : 'none');
    const selectedFilter = ['==', ['get', 'id'], selected?.id ?? ''] as never;
    map.setFilter(LAYER.casing, selectedFilter);
    map.setFilter(LAYER.selected, selectedFilter);
  };

  const installLayers = () => {
    const map = mapRef.current;
    if (!map) return;
    // Below the first label layer, so place and road names stay readable on top of the data
    const beforeId = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
    const empty = { type: 'FeatureCollection', features: [] } as never;
    map.addSource(SEGMENT_SOURCE, { type: 'geojson', data: empty });
    map.addSource(REPORT_SOURCE, { type: 'geojson', data: empty });
    map.addSource(DENSITY_SOURCE, { type: 'geojson', data: empty });

    map.addLayer(
      {
        id: LAYER.density,
        type: 'heatmap',
        source: DENSITY_SOURCE,
        layout: { visibility: 'none' },
        paint: {
          // Uniform weight: the layer shows how many reports there are, not how severe they are
          'heatmap-weight': 1,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 12, 1.2],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 10, 8, 26, 14, 48],
          // Fades as individual reports take over at street scale
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.75, 14, 0.3],
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0,
            'rgba(6,182,212,0)',
            0.2,
            '#8296b0',
            0.4,
            '#57ae78',
            0.6,
            '#e8b23a',
            0.8,
            '#e2823d',
            1,
            '#d9655d'
          ]
        }
      } as never,
      beforeId
    );

    const lineLayout = { 'line-cap': 'round', 'line-join': 'round' };
    const noSelection = ['==', ['get', 'id'], ''];
    map.addLayer(
      {
        id: LAYER.casing,
        type: 'line',
        source: SEGMENT_SOURCE,
        minzoom: LINE_MIN_ZOOM,
        filter: noSelection,
        layout: lineLayout,
        paint: { 'line-color': '#ffffff', 'line-width': LINE_WIDTH(7) }
      } as never,
      beforeId
    );
    map.addLayer(
      {
        id: LAYER.line,
        type: 'line',
        source: SEGMENT_SOURCE,
        minzoom: LINE_MIN_ZOOM,
        layout: lineLayout,
        paint: { 'line-color': ['get', 'color'], 'line-width': LINE_WIDTH(0), 'line-opacity': 0.9 }
      } as never,
      beforeId
    );
    map.addLayer(
      {
        id: LAYER.selected,
        type: 'line',
        source: SEGMENT_SOURCE,
        minzoom: LINE_MIN_ZOOM,
        filter: noSelection,
        layout: lineLayout,
        paint: { 'line-color': ['get', 'color'], 'line-width': LINE_WIDTH(2) }
      } as never,
      beforeId
    );
    // Wide, practically invisible line so a segment can be tapped on a touch screen
    map.addLayer({
      id: LAYER.hit,
      type: 'line',
      source: SEGMENT_SOURCE,
      minzoom: LINE_MIN_ZOOM,
      layout: lineLayout,
      paint: { 'line-color': '#000000', 'line-opacity': 0.001, 'line-width': 24 }
    } as never);
  };

  const showPickPopup = (lngLat: maplibregl.LngLat) => {
    const map = mapRef.current;
    const { roadSegments: segments, onOpenReportModalWithLocation: openReport, language: lang } = latest.current;
    if (!map || !openReport || segments.length === 0) return;

    pickAbortControllerRef.current?.abort();
    const controller = new AbortController();
    pickAbortControllerRef.current = controller;

    pickPopupRef.current?.remove();
    pickPopupRef.current = null;

    const point: [number, number] = [Number(lngLat.lat.toFixed(6)), Number(lngLat.lng.toFixed(6))];
    if (!isValidCoordinate(point)) return;

    const selection = createLocationSelection(point);
    pickRequestIdRef.current = selection.requestId;

    const isEn = lang === 'en';
    const titleText = isEn ? 'SELECTED LOCATION' : 'LOKASI TERPILIH';
    const nearestLabel = isEn ? 'NEAREST ROAD CORRIDOR:' : 'RUAS JALAN TERDEKAT:';
    const approveText = isEn ? 'Approve Location' : 'Setujui Lokasi';
    const cancelText = isEn ? 'Cancel' : 'Batal';
    const closeTitle = isEn ? 'Close' : 'Tutup';
    const retryText = isEn ? 'Retry' : 'Coba Lagi';
    const searchingText = isEn ? 'Searching road corridor...' : 'Mencari ruas jalan...';
    const notIdentifiedText = isEn ? 'Road segment not found within search range' : 'Ruas jalan tidak ditemukan dalam jangkauan pencarian';
    const failedText = isEn ? 'Failed to fetch road data' : 'Gagal mengambil data ruas jalan';
    const ambiguousText = isEn ? 'Ambiguous road segment detected' : 'Ruas jalan terdeteksi ambigu';

    const content = document.createElement('div');
    content.className = 'location-card-content';

    const renderCardHtml = (sel: LocationSelection) => {
      let roadHtml = '';
      if (sel.status === 'RESOLVING') {
        roadHtml = `<span class="location-card-road-resolving">⏳ ${searchingText}</span>`;
      } else if (sel.status === 'RESOLVED' && sel.segment) {
        const distBadge =
          sel.distanceMeters !== null
            ? `<span class="location-card-distance-badge">± ${Math.round(sel.distanceMeters)} m ${isEn ? 'from corridor' : 'dari ruas'}</span>`
            : '';
        roadHtml = `
          <span class="location-card-road-name" title="${sel.segment.name}" role="button" tabindex="0">
            ${sel.segment.name}
          </span>
          <span class="location-card-road-id-sub">(${sel.segment.id})</span>
          ${distBadge}
        `;
      } else if (sel.status === 'AMBIGUOUS' && sel.segment) {
        const distBadge =
          sel.distanceMeters !== null
            ? `<span class="location-card-distance-badge">± ${Math.round(sel.distanceMeters)} m ${isEn ? 'from corridor' : 'dari ruas'}</span>`
            : '';
        roadHtml = `
          <span class="location-card-road-name" title="${sel.segment.name}" role="button" tabindex="0">
            ${sel.segment.name}
          </span>
          <span class="location-card-road-id-sub">(${sel.segment.id})</span>
          <span class="location-card-ambiguous-badge">⚠️ ${ambiguousText}</span>
          ${distBadge}
        `;
      } else if (sel.status === 'NO_ROAD_FOUND') {
        roadHtml = `<span class="location-card-road-unidentified">⚠️ ${notIdentifiedText}</span>`;
      } else {
        roadHtml = `
          <div class="location-card-road-error-group">
            <span class="location-card-road-error">⚠️ ${sel.errorMessage || failedText}</span>
            <button id="pop-retry-btn" class="location-card-retry-btn" type="button">
              🔄 ${retryText}
            </button>
          </div>
        `;
      }

      const isApproveDisabled = sel.status === 'RESOLVING' || !sel.isValid;

      return `
        <div class="location-card-header">
          <div class="location-card-title-group">
            <span class="location-card-pin-icon" aria-hidden="true">
              <svg width="20" height="24" viewBox="0 0 24 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M12 1.5C6.75329 1.5 2.5 5.75329 2.5 11C2.5 17.5 12 26.5 12 26.5C12 26.5 21.5 17.5 21.5 11C21.5 5.75329 17.2467 1.5 12 1.5ZM12 14.5C10.067 14.5 8.5 12.933 8.5 11C8.5 9.067 10.067 7.5 12 7.5C13.933 7.5 15.5 9.067 15.5 11C15.5 12.933 13.933 14.5 12 14.5Z" fill="#DC2626"/>
              </svg>
            </span>
            <h3 class="location-card-title">${titleText}</h3>
          </div>
          <button id="pop-close-btn" class="location-card-close-btn" aria-label="Close" title="${closeTitle}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="location-card-divider"></div>

        <div class="location-card-coord-box">
          <span class="location-card-coords">${sel.coordinates[0].toFixed(6)}, ${sel.coordinates[1].toFixed(6)}</span>
        </div>

        <div class="location-card-road-box">
          <span class="location-card-road-label">${nearestLabel}</span>
          ${roadHtml}
        </div>

        <div class="location-card-actions">
          <button id="pop-approve-btn" class="location-card-approve-btn" ${isApproveDisabled ? 'disabled' : ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>${approveText}</span>
          </button>
          <button id="pop-cancel-btn" class="location-card-cancel-btn" aria-label="Cancel" title="${cancelText}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `;
    };

    content.innerHTML = renderCardHtml(selection);

    // Update or create active pin marker
    if (pickMarkerRef.current) {
      pickMarkerRef.current.setLngLat(lngLat);
    } else {
      const markerEl = document.createElement('div');
      markerEl.className = 'active-location-pin-marker';
      markerEl.innerHTML = createActivePinMarkerHtml('maplibre-active-pin');
      pickMarkerRef.current = new maplibregl.Marker({
        element: markerEl,
        anchor: 'center'
      })
        .setLngLat(lngLat)
        .addTo(map);
    }
    latest.current.onActivePinChange?.([point[0], point[1]], null);

    let currentSelection = selection;

    const bindButtonEvents = () => {
      const approveBtn = content.querySelector('#pop-approve-btn') as HTMLButtonElement | null;
      const cancelBtn = content.querySelector('#pop-cancel-btn') as HTMLButtonElement | null;
      const closeBtn = content.querySelector('#pop-close-btn') as HTMLButtonElement | null;
      const retryBtn = content.querySelector('#pop-retry-btn') as HTMLButtonElement | null;
      const roadNameEl = content.querySelector('.location-card-road-name') as HTMLElement | null;

      if (roadNameEl && currentSelection.segment) {
        roadNameEl.style.cursor = 'pointer';
        roadNameEl.onclick = (e) => {
          e.stopPropagation();
          if (currentSelection.segment) {
            props.onSelectSegment?.(currentSelection.segment);
          }
        };
      }

      if (retryBtn) {
        retryBtn.onclick = (e) => {
          e.stopPropagation();
          showPickPopup(lngLat);
        };
      }

      let isApproving = false;
      if (approveBtn && currentSelection.status !== 'RESOLVING') {
        approveBtn.onclick = () => {
          if (isApproving) return;
          isApproving = true;
          approveBtn.disabled = true;
          pickPopupRef.current?.remove();
          pickPopupRef.current = null;
          openReport(currentSelection.segment || segments[0], currentSelection.coordinates);
        };
      }
      const handleClose = () => {
        pickAbortControllerRef.current?.abort();
        pickRequestIdRef.current = null;
        pickPopupRef.current?.remove();
        pickPopupRef.current = null;
        pickMarkerRef.current?.remove();
        pickMarkerRef.current = null;
        latest.current.onActivePinChange?.(null);
      };
      if (cancelBtn) cancelBtn.onclick = handleClose;
      if (closeBtn) closeBtn.onclick = handleClose;
    };

    bindButtonEvents();

    pickPopupRef.current = new maplibregl.Popup({
      closeButton: false,
      maxWidth: '360px',
      offset: 14,
      className: 'compact-location-approval-popup'
    })
      .setLngLat(lngLat)
      .setDOMContent(content)
      .addTo(map);

    resolveRoadSelection(selection, segments, {
      signal: controller.signal,
      maxRadiusMeters: DEFAULT_ROAD_SEARCH_RADIUS_METERS
    })
      .then((resolved) => {
        if (pickRequestIdRef.current !== selection.requestId) return;
        currentSelection = resolved;
        content.innerHTML = renderCardHtml(resolved);
        bindButtonEvents();
        latest.current.onActivePinChange?.([point[0], point[1]], resolved.segment);
      })
      .catch((err) => {
        if (err.name === 'AbortError' || pickRequestIdRef.current !== selection.requestId) return;
        currentSelection = {
          ...selection,
          status: 'ERROR',
          state: 'error',
          errorMessage: failedText
        };
        content.innerHTML = renderCardHtml(currentSelection);
        bindButtonEvents();
      });
  };


  // Synchronize pick marker with external activePinCoordinates
  useEffect(() => {
    if (activePinCoordinates === null && pickMarkerRef.current) {
      pickMarkerRef.current.remove();
      pickMarkerRef.current = null;
    }
  }, [activePinCoordinates]);

  // Create the map once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    candidatesRef.current = basemapCandidates(baseMapStyle, import.meta.env.VITE_MAPTILER_KEY);

    const shouldStartRegional = compact || prefersReducedMotion();
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: candidatesRef.current[0].style as maplibregl.StyleSpecification | string,
        center: shouldStartRegional ? [107.10, -6.35] : GLOBE_INITIAL_CENTER,
        zoom: shouldStartRegional ? 9.3 : GLOBE_INITIAL_ZOOM,
        minZoom: 0,
        maxZoom: 19,
        attributionControl: false
      });
    } catch {
      // No WebGL: the Leaflet map takes over
      setUnsupported(true);
      return;
    }
    mapRef.current = map;
    // Development only: lets browser checks compare marker positions and control camera
    if (import.meta.env.DEV) {
      const w = window as unknown as {
        __pavementMap?: maplibregl.Map;
        __pavementCameraPhase?: () => MapCameraPhase;
        __pavementReplayIntro?: () => void;
      };
      w.__pavementMap = map;
      w.__pavementCameraPhase = () => cameraPhaseRef.current;
      w.__pavementReplayIntro = () => startCameraSequence();
    }

    // Attribution (required by the tile and data licences).
    // - Phones: always-open, one quiet line of text (index.css), no (i) toggle button.
    // - Larger screens: compact, starts collapsed, expandable on click.
    const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches;
    const attribControl = new maplibregl.AttributionControl({ compact: !phone });
    map.addControl(attribControl, 'bottom-right');
    const containerEl = (attribControl as unknown as { _container: HTMLElement })._container;
    if (containerEl && !phone) {
      containerEl.classList.add('maplibregl-compact');
      containerEl.classList.remove('maplibregl-compact-show');
      const origUpdateCompact = (attribControl as unknown as { _updateCompact: () => void })._updateCompact;
      (attribControl as unknown as { _updateCompact: () => void })._updateCompact = function() {
        const wasOpen = containerEl.classList.contains('maplibregl-compact-show');
        origUpdateCompact.call(this);
        if (!wasOpen) {
          containerEl.classList.remove('maplibregl-compact-show');
        }
      };
    }

    const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (coarsePointer) {
      // No on-screen compass on phones, so the map stays north-up and flat there
      map.touchZoomRotate.disableRotation();
      map.touchPitch.disable();
    } else {
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right');
    }

    // User interaction detection: cancel intro animation and pause auto-rotation immediately when user starts navigating,
    // and resume only after manual interaction finishes (with a 1s cooldown).
    const handleInteractionStart = (e?: { originalEvent?: unknown }) => {
      // Ignore programmatic movements (where originalEvent is undefined)
      if (e && 'originalEvent' in e && !e.originalEvent) return;
      cancelIntroAnimation('user_drag_or_zoom');
      isInteractingRef.current = true;
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };

    const handleInteractionEnd = () => {
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
      }
      resumeTimerRef.current = window.setTimeout(() => {
        isInteractingRef.current = false;
        if (mapRef.current) {
          fixedLatRef.current = mapRef.current.getCenter().lat;
          if (cameraPhaseRef.current === 'REGIONAL_READY' && mapRef.current.getZoom() < GLOBE_MAX_ROTATION_ZOOM) {
            startRotationLoop();
          }
        }
      }, INTERACTION_RESUME_DELAY_MS);
    };

    map.on('dragstart', handleInteractionStart);
    map.on('mousedown', handleInteractionStart);
    map.on('touchstart', handleInteractionStart);
    map.on('wheel', handleInteractionStart);

    map.on('dragend', handleInteractionEnd);
    map.on('mouseup', handleInteractionEnd);
    map.on('touchend', handleInteractionEnd);

    map.on('style.load', () => {
      styleReadyRef.current = true;
      map.setProjection({ type: 'globe' });
      installLayers();
      syncLayers();
      renderMarkers();
      reportViewport(false);
      (attribControl as unknown as { _updateCompactMinimize?: () => void })._updateCompactMinimize?.();

      if (compact || prefersReducedMotion()) {
        cameraPhaseRef.current = 'REGIONAL_READY';
        const padding = { top: 70, bottom: 80, left: 40, right: 40 };
        const targetCam = map.cameraForBounds(REGIONAL_JAVA_BOUNDS, { padding, maxZoom: 9.6 });
        if (targetCam) {
          map.jumpTo({ center: targetCam.center, zoom: targetCam.zoom });
        }
        reportViewport(false);
      } else {
        startCameraSequence();
      }
    });

    map.on('click', () => {
      (attribControl as unknown as { _updateCompactMinimize?: () => void })._updateCompactMinimize?.();
    });
    map.on('touchstart', () => {
      (attribControl as unknown as { _updateCompactMinimize?: () => void })._updateCompactMinimize?.();
    });
    map.on('dragstart', () => {
      (attribControl as unknown as { _updateCompactMinimize?: () => void })._updateCompactMinimize?.();
    });

    map.on('error', (event) => {
      const sourceId = (event as { sourceId?: string }).sourceId;
      if (!styleReadyRef.current) {
        // The style itself could not be loaded
        tryNextCandidate();
        return;
      }
      if (!sourceId || sourceId.startsWith('pp-')) return;
      const previous = healthRef.current;
      healthRef.current = recordTileError(previous);
      if (healthRef.current.stage !== previous.stage) tryNextCandidate();
    });

    map.on('sourcedata', (event) => {
      const { sourceId, tile } = event as { sourceId?: string; tile?: unknown };
      if (tile && sourceId && !sourceId.startsWith('pp-')) healthRef.current = recordTileLoad(healthRef.current);
    });

    // Only report viewport changes to React when it is a manual user move or programmatic navigation,
    // not on every 60fps auto-rotation tick (which would cause excessive React re-renders).
    map.on('movestart', (e) => {
      if ((e as { autoRotation?: boolean }).autoRotation) return;
      reportViewport(true);
    });
    map.on('moveend', (e) => {
      if ((e as { autoRotation?: boolean }).autoRotation) return;
      reportViewport(false);
      handleInteractionEnd();
    });

    map.on('zoom', () => {
      // Regroup markers every half zoom level, not on every animation frame
      const bucket = Math.round(map.getZoom() * 2);
      if (bucket !== zoomBucketRef.current) {
        zoomBucketRef.current = bucket;
        renderMarkers();
      }
    });

    map.on('click', (event) => {
      if (!styleReadyRef.current) return;
      const hits = map.getLayer(LAYER.hit) ? map.queryRenderedFeatures(event.point, { layers: [LAYER.hit] }) : [];
      const hitId = hits[0]?.properties?.id as string | undefined;
      const segment = hitId ? latest.current.roadSegments.find((s) => s.id === hitId) : undefined;
      if (segment) {
        pickPopupRef.current?.remove();
        latest.current.onSelectSegment(segment);
        return;
      }
      // With density on, a tap on the area zooms towards the reports there
      if (latest.current.showDensity && map.getZoom() + ZOOM_OFFSET < DENSITY_MARKER_MIN_ZOOM) {
        map.easeTo({ center: event.lngLat, zoom: Math.min(map.getZoom() + 2, DENSITY_MARKER_MIN_ZOOM - ZOOM_OFFSET), duration: 600 });
        return;
      }
      if (map.getZoom() >= PICK_POINT_MIN_ZOOM) showPickPopup(event.lngLat);
    });
    map.on('mouseenter', LAYER.hit, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', LAYER.hit, () => {
      map.getCanvas().style.cursor = '';
    });

    const handleDocumentClick = (e: MouseEvent) => {
      if (containerEl && !containerEl.contains(e.target as Node)) {
        (attribControl as unknown as { _updateCompactMinimize?: () => void })._updateCompactMinimize?.();
      }
    };
    document.addEventListener('click', handleDocumentClick);

    // Keep MapLibre canvas size strictly in sync with its DOM container
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      if (mapRef.current && container.isConnected) {
        mapRef.current.resize();
      }
    }) : null;
    if (resizeObserver && container) {
      resizeObserver.observe(container);
    }

    return () => {
      resizeObserver?.disconnect();
      cancellationTokenRef.current += 1;
      if (phaseTimerRef.current !== null) {
        window.clearTimeout(phaseTimerRef.current);
        phaseTimerRef.current = null;
      }
      document.removeEventListener('click', handleDocumentClick);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      userMarkerRef.current = null;
      pickMarkerRef.current?.remove();
      pickMarkerRef.current = null;
      styleReadyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Cinematic Entry Animation Trigger: re-run intro when tab becomes active or entryAnimationKey increments
  useEffect(() => {
    if (!mountedRef.current || !mapRef.current || !styleReadyRef.current) return;
    if (compact) return;
    if (isTabActive === false) {
      cancelIntroAnimation('tab_inactive');
      return;
    }
    startCameraSequence();
  }, [entryAnimationKey, isTabActive, compact]);

  // Data, filter, layer and selection changes: never a new map, never a camera move
  useEffect(() => {
    syncLayers();
    renderMarkers();
  }, [roadSegments, communityReports, activeFilter, showDensity, selectedSegment, highlightReportId, localHighlightId, language, signedReportIds]);

  // Basemap choice
  useEffect(() => {
    if (!mountedRef.current || !mapRef.current) return;
    candidatesRef.current = basemapCandidates(baseMapStyle, import.meta.env.VITE_MAPTILER_KEY);
    applyCandidate(0);
  }, [baseMapStyle]);

  // Selected segment: framed above an open sheet, and the earlier view restored when it closes
  const hasBottomInset = bottomInsetPx > 0;
  useEffect(() => {
    const map = mapRef.current;
    if (!mountedRef.current || !map || !selectedSegment) return;

    cancelIntroAnimation('selected_segment');

    if (hasBottomInset) {
      if (!viewBeforeSelectionRef.current) {
        viewBeforeSelectionRef.current = { center: map.getCenter(), zoom: map.getZoom() };
      }
      const canonical = getCanonicalRoadGeometry(selectedSegment.id);
      const polyline =
        canonical && canonical.geometry.coordinates.length > 1
          ? toLeafletPolyline(canonical.geometry.coordinates)
          : selectedSegment.polyline;
      const bounds = lngLatBounds(
        polyline.length > 1 ? polyline : [selectedSegment.coordinates]
      );
      if (bounds) {
        map.fitBounds(bounds, {
          padding: { top: 130, left: 36, right: 36, bottom: bottomInsetPx + 24 },
          maxZoom: 14,
          duration: 900
        });
      }
      return;
    }

    if (viewBeforeSelectionRef.current) {
      const previous = viewBeforeSelectionRef.current;
      viewBeforeSelectionRef.current = null;
      map.easeTo({ center: previous.center, zoom: previous.zoom, duration: 600 });
      return;
    }

    // No sheet over the map (wide screens): bring the segment into view without zooming out
    map.flyTo({ center: toLngLat(selectedSegment.coordinates), zoom: Math.max(map.getZoom(), 11), duration: 1200 });
  }, [selectedSegment, hasBottomInset]);

  // Locate without a device position: back to the region the demo data covers
  useEffect(() => {
    if (recenterKey > 0) {
      cancelIntroAnimation('recenter');
      mapRef.current?.flyTo({ center: DATA_REGION, zoom: HOME_ZOOM, duration: 1400 });
    }
  }, [recenterKey]);

  // Device position, only when the Geolocation API returned one
  useEffect(() => {
    userMarkerRef.current?.remove();
    userMarkerRef.current = null;
    if (!userLocation) return;
    // The position often arrives before the map has finished loading: wait for it, then fly.
    let cancelled = false;
    let timer = 0;
    const flyWhenReady = (tries: number) => {
      const map = mapRef.current;
      if (cancelled) return;
      if (!map || !map.isStyleLoaded()) {
        if (tries < 60) timer = window.setTimeout(() => flyWhenReady(tries + 1), 150);
        return;
      }
      flyToUser(map);
    };
    const flyToUser = (map: maplibregl.Map) => {
    cancelIntroAnimation('user_location');
    // Pavi, the mascot, stands where the user is (Snap-Map style); helmet colour is the user's choice.
    const element = document.createElement('div');
    element.className = 'user-location-marker';
    element.title = 'Lokasi Anda';
    element.innerHTML = paviMarkerHtml(readPavi().helmet, readPavi().vest, heldRef.current);
    userMarkerRef.current = new maplibregl.Marker({ element, anchor: 'bottom' })
      .setLngLat(toLngLat(userLocation.coordinates))
      .addTo(map);
    // Smooth arc from wherever the camera is to the visitor's street.
    map.flyTo({ center: toLngLat(userLocation.coordinates), zoom: 16, duration: 2600, curve: 1.5, speed: 0.9, essential: true });
    };
    flyWhenReady(0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userLocation]);

  // Explicit camera target (a report chosen from a list, a newly created report)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapCenterTarget) return;
    cancelIntroAnimation('target_report');
    const narrow = typeof window !== 'undefined' && window.innerWidth < 768;
    map.flyTo({
      center: toLngLat(mapCenterTarget.coords),
      zoom: (mapCenterTarget.zoom ?? 17) - ZOOM_OFFSET,
      // Keep the point in the part of the map a half-open sheet leaves visible
      offset: narrow ? [0, -150] : [0, 0],
      duration: 750
    });
  }, [mapCenterTarget]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (unsupported) return <LeafletMap {...props} />;

  const stageProvider = candidatesRef.current[basemapStage]?.provider;

  return (
    <div className="relative w-full h-full min-h-0 overflow-hidden bg-[#0b1220]">
      {/* MapLibre sets position: relative on its container, so the size comes from width/height */}
      <div ref={containerRef} data-testid="vector-map" className="w-full h-full" />

      {/* Provenance: demo indicator is already displayed in header user pill; hidden here to clear bottom UI */}
      <div
        data-testid="demo-data-badge"
        title={DEMO_DATA_NOTE[language]}
        className="hidden"
      >
        {DEMO_DATA_LABEL[language]}
      </div>

      {/* Basemap status: shown only when the selected style could not be used */}
      {basemapStage > 0 && (
        <div
          role="status"
          data-testid="basemap-status"
          className="absolute bottom-[136px] md:bottom-16 left-1/2 -translate-x-1/2 z-20 w-max max-w-[calc(100%-1.5rem)] flex items-center gap-2 bg-slate-900/95 border border-amber-400/50 text-white text-xs font-bold px-3 py-2 rounded-2xl shadow-lg"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            {stageProvider === 'NONE'
              ? language === 'en'
                ? 'Basemap unavailable. Map data is still shown.'
                : 'Peta dasar tidak tersedia. Data tetap ditampilkan.'
              : language === 'en'
              ? 'Backup basemap in use.'
              : 'Memakai peta dasar cadangan.'}
          </span>
          <button
            type="button"
            onClick={() => applyCandidate(0)}
            className="shrink-0 whitespace-nowrap underline text-amber-300 cursor-pointer"
          >
            {language === 'en' ? 'Retry' : 'Coba lagi'}
          </button>
        </div>
      )}
    </div>
  );
};

export default MapLibreMap;
