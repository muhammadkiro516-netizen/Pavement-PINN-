import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
import { attachMapResizeRecovery, mapHasSize, safeFitBounds, safeFlyTo } from './mapViewport';
import {
  BASEMAP_SOURCES,
  BasemapSource,
  INITIAL_TILE_HEALTH,
  TileHealth,
  TileStage,
  recordTileError,
  recordTileLoad,
  sourceForStage
} from './basemap';
import {
  CLUSTER_MAX_ZOOM,
  LatLngBounds,
  SEGMENT_LINE_MIN_ZOOM,
  SEGMENT_PIN_MIN_ZOOM,
  boundsOf,
  clusterByPixelDistance,
  minZoomForViewportHeight
} from './mapDetail';
import { DamageReport, DamageType, ReportMutationHandler, ReportSeverity, RoadSegment, UserRole } from '../../types';
import { getCanonicalRoadGeometry, toLeafletPolyline } from '../../domain/geo/canonicalRoadGeometry';
import {
  LocationSelection,
  createLocationSelection,
  resolveRoadSelection,
  isValidCoordinate,
  DEFAULT_ROAD_SEARCH_RADIUS_METERS
} from '../../domain/geo/locationSelection';
import { UserAccount } from '../../features/authentication/demoAccounts';
import { ALL_BINA_MARGA_WIM_STATIONS } from '../../data/reference/indonesianRoads';
import { ReportDetailModal } from '../../features/community-reports/ReportDetailModal';
import { resolveLiveReport } from '../../features/community-reports/reportState';
import { MapAnalyticsPanel } from './MapAnalyticsPanel';
import { Language, TRANSLATIONS } from '../../i18n/translations';
import { selectRegularUserDensity } from '../../features/community-reports/reportDensity';
import { createSessionReport, ReportCreationError } from '../../features/community-reports/reportFactory';
import { settleMutation } from '../../features/community-reports/reportMutations';
import { prefersReducedMotion } from '../ui/motion';
import {
  Filter,
  Search,
  Sparkles,
  BarChart2,
  AlertTriangle,
  Truck,
  MapPin,
  ShieldAlert,
  Camera,
  PlusCircle,
  Send,
  ThumbsUp,
  X,
  Info,
  ChevronDown,
  CheckCircle,
  CornerUpRight,
  CornerUpLeft,
  Flag,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Volume2,
  VolumeX,
  Navigation,
  CheckCircle2
} from 'lucide-react';

/**
 * Camera move for this map. Leaflet's flyTo keeps tiles and markers aligned through the
 * zoom events it fires on the way; a flight that starts and ends on the same zoom fires
 * none when the browser skips its frames (hidden tab, throttled rendering) and leaves the
 * layers out of register. Same-zoom moves therefore pan instead.
 */
function moveCamera(map: L.Map, center: L.LatLngExpression, zoom: number, options?: L.ZoomPanOptions): void {
  // Reduced motion: jump instead of flying (setView without animation keeps layers aligned).
  if (mapHasSize(map) && prefersReducedMotion()) {
    map.setView(center, zoom, { animate: false });
    return;
  }
  if (mapHasSize(map) && map.getZoom() === zoom) {
    map.setView(center, zoom, { duration: options?.duration });
    return;
  }
  safeFlyTo(map, center, zoom, options);
}

/**
 * Renders a circular, ultra-smooth radial heatmap cloud around an active pin coordinate.
 * Matches existing color ramp: Yellow (#e8b23a) -> Lime (#84cc16) -> Green (#57ae78) -> Transparent.
 * Smooth animated color transition: Green -> Light Green -> Yellow -> Green.
 * Zero hard outlines, zero black border, zero thick neon box-shadow, retaining 100% road label legibility.
 */
export function createActivePinHeatmapSvg(id: string, size = 150): string {
  const half = size / 2;
  const radius = half - 6;
  return `
    <div class="active-pin-heatmap-aura" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: ${size}px; height: ${size}px; pointer-events: none; z-index: 1;">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%; display: block; overflow: visible;">
        <defs>
          <radialGradient id="active-pin-heat-${id}" cx="50%" cy="50%" r="50%">
            <!-- Center Core: Warm golden yellow shifting to fresh green -->
            <stop offset="0%" stop-color="#e8b23a" stop-opacity="0.82">
              <animate attributeName="stop-color" values="#e8b23a;#84cc16;#57ae78;#a3e635;#e8b23a" dur="5.5s" repeatCount="indefinite" />
            </stop>
            <!-- Inner Zone: Light Green / Lime -->
            <stop offset="30%" stop-color="#84cc16" stop-opacity="0.66">
              <animate attributeName="stop-color" values="#84cc16;#57ae78;#a3e635;#e8b23a;#84cc16" dur="5.5s" repeatCount="indefinite" />
            </stop>
            <!-- Mid Zone: Soft Emerald Green -->
            <stop offset="56%" stop-color="#57ae78" stop-opacity="0.44">
              <animate attributeName="stop-color" values="#57ae78;#a3e635;#e8b23a;#84cc16;#57ae78" dur="5.5s" repeatCount="indefinite" />
            </stop>
            <!-- Outer Diffusion: Soft Slate/Cyan fading out -->
            <stop offset="78%" stop-color="#8296b0" stop-opacity="0.18">
              <animate attributeName="stop-color" values="#8296b0;#06b6d4;#8296b0;#06b6d4;#8296b0" dur="5.5s" repeatCount="indefinite" />
            </stop>
            <!-- Edge: Completely transparent boundary (zero hard lines) -->
            <stop offset="100%" stop-color="#06b6d4" stop-opacity="0" />
          </radialGradient>
          <filter id="active-pin-blur-${id}" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        <circle cx="${half}" cy="${half}" r="${radius}" fill="url(#active-pin-heat-${id})" filter="url(#active-pin-blur-${id})" />
      </svg>
    </div>
  `;
}

export function createActivePinMarkerHtml(id: string): string {
  const heatmapSvg = createActivePinHeatmapSvg(id, 150);
  return `
    <div class="active-pin-marker-wrapper" style="position: relative; width: 150px; height: 150px; display: flex; align-items: center; justify-content: center; pointer-events: auto;">
      <!-- Layer 1: Dedicated Active Pin Point Radial Heatmap Aura (underneath marker) -->
      ${heatmapSvg}

      <!-- Layer 2: Clean Pin Marker (centered precisely at exact geographic coordinates) -->
      <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -100%); z-index: 10; display: flex; flex-direction: column; align-items: center; cursor: pointer; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.3));">
        <div style="width: 34px; height: 34px; border-radius: 50%; background: #10b981; border: 2.5px solid #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,0.22); display: flex; align-items: center; justify-content: center;">
          <svg width="15" height="18" viewBox="0 0 24 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M12 1.5C6.75329 1.5 2.5 5.75329 2.5 11C2.5 17.5 12 26.5 12 26.5C12 26.5 21.5 17.5 21.5 11C21.5 5.75329 17.2467 1.5 12 1.5ZM12 14.5C10.067 14.5 8.5 12.933 8.5 11C8.5 9.067 10.067 7.5 12 7.5C13.933 7.5 15.5 9.067 15.5 11C15.5 12.933 13.933 14.5 12 14.5Z" fill="#ffffff"/>
          </svg>
        </div>
        <div style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 6.5px solid #10b981; margin-top: -1px;"></div>
      </div>
    </div>
  `;
}

export interface LeafletMapProps {
  roadSegments: RoadSegment[];
  selectedSegment: RoadSegment | null;
  onSelectSegment: (segment: RoadSegment) => void;
  onLaunchSimulation?: (segment: RoadSegment) => void;
  activeRole?: UserRole;
  onNavigateToDashboard?: () => void;
  communityReports?: DamageReport[];
  onAddReport?: ReportMutationHandler;
  onUpvoteReport?: (reportId: string) => void;
  currentAccount?: UserAccount;
  isCommunityReportCardOpen?: boolean;
  onToggleCommunityReportCard?: () => void;
  onOpenReportModalWithLocation?: (segment: RoadSegment | null, coords: [number, number]) => void;
  activeFilter?: string;
  theme?: 'light' | 'dark';
  language?: Language;
  baseMapStyle?: 'DARK' | 'SATELLITE' | 'LIGHT';
  onSelectReport?: (report: DamageReport) => void;
  recenterKey?: number;
  highlightReportId?: string | null;
  mapCenterTarget?: { coords: [number, number]; zoom?: number; timestamp: number } | null;
  /** Reports with a temporary warning sign on site (MARK_HAZARD); their pins get a sign badge. */
  signedReportIds?: ReadonlySet<string>;
  /** Report-density overlay. A layer, independent of the severity filter. */
  showDensity?: boolean;
  /** Active pin coordinates for newly picking, confirming or creating reports with dedicated heatmap */
  activePinCoordinates?: [number, number] | null;
  onActivePinChange?: (coords: [number, number] | null, segment?: RoadSegment | null) => void;
  /** Called when the map starts moving and when it comes to rest. */
  onViewportChange?: (viewport: { zoom: number; bounds: LatLngBounds; moving: boolean }) => void;
  /** Device position from the Geolocation API; never a placeholder. */
  userLocation?: { coordinates: [number, number]; accuracyM: number } | null;
  /** Height of a bottom sheet covering the map; the selected segment is framed above it. */
  bottomInsetPx?: number;
  /** Reports that share one position and cannot be separated by zooming. */
  onSelectCluster?: (reports: DamageReport[]) => void;
  activeNavigationTask?: {
    report: DamageReport;
    startCoords: [number, number];
    startLabel?: string;
  } | null;
  onCompleteNavigation?: () => void;
  onCancelNavigation?: () => void;
  onStartNavigationToReport?: (report: DamageReport) => void;
  /** Dashboard tile: no report creation from the map, starts directly in regional ready view. */
  compact?: boolean;
  /** Staff cards (filters, selected segment, stats). PavementMap sets false for pages that pass no role and bring their own overlays. */
  staffCards?: boolean;
  /** Whether the map tab is active/visible. */
  isTabActive?: boolean;
  /** Key incremented each time the user navigates/opens the map tab to trigger cinematic globe-to-Java intro. */
  entryAnimationKey?: number;
}

export const LeafletMap: React.FC<LeafletMapProps> = ({
  roadSegments,
  selectedSegment,
  onSelectSegment,
  onLaunchSimulation = (_segment: RoadSegment) => {},
  activeRole = 'FIELD_ENGINEER',
  onNavigateToDashboard = () => {},
  communityReports = [],
  onAddReport,
  onUpvoteReport,
  currentAccount,
  isCommunityReportCardOpen,
  onToggleCommunityReportCard,
  onOpenReportModalWithLocation,
  activeFilter = 'ALL',
  theme = 'dark',
  language = 'id',
  baseMapStyle = 'LIGHT',
  onSelectReport,
  recenterKey = 0,
  highlightReportId = null,
  mapCenterTarget = null,
  showDensity,
  activePinCoordinates = null,
  onActivePinChange,
  onViewportChange,
  userLocation = null,
  bottomInsetPx = 0,
  onSelectCluster,
  activeNavigationTask = null,
  compact = false,
  staffCards = true,
  onCompleteNavigation,
  onCancelNavigation,
  onStartNavigationToReport
}) => {
  const onSelectClusterRef = useRef(onSelectCluster);
  onSelectClusterRef.current = onSelectCluster;
  const viewBeforeSelectionRef = useRef<{ center: L.LatLng; zoom: number } | null>(null);
  const densityOn = showDensity ?? activeFilter === 'HEATMAP';
  const [zoom, setZoom] = useState<number>(12);
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const userLayerRef = useRef<L.LayerGroup | null>(null);
  const t = TRANSLATIONS[language];
  const isEn = language === 'en';

  const onSelectSegmentRef = useRef(onSelectSegment);
  onSelectSegmentRef.current = onSelectSegment;
  const roadSegmentsRef = useRef(roadSegments);
  roadSegmentsRef.current = roadSegments;
  const onActivePinChangeRef = useRef(onActivePinChange);
  onActivePinChangeRef.current = onActivePinChange;
  const onOpenReportModalWithLocationRef = useRef(onOpenReportModalWithLocation);
  onOpenReportModalWithLocationRef.current = onOpenReportModalWithLocation;
  const isEnRef = useRef(isEn);
  isEnRef.current = isEn;
  const tRef = useRef(t);
  tRef.current = t;

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const tileHealthRef = useRef<TileHealth>(INITIAL_TILE_HEALTH);
  const baseMapStyleRef = useRef(baseMapStyle);
  baseMapStyleRef.current = baseMapStyle;
  const [tileStage, setTileStage] = useState<TileStage>('primary');

  // Point the existing tile layer at another source and keep the attribution in step.
  const applyBasemapSource = (source: BasemapSource) => {
    const tileLayer = tileLayerRef.current;
    const map = mapInstanceRef.current;
    if (!tileLayer) return;
    const previousAttribution = tileLayer.options.attribution;
    if (map?.attributionControl && typeof previousAttribution === 'string') {
      map.attributionControl.removeAttribution(previousAttribution);
      map.attributionControl.addAttribution(source.attribution);
    }
    tileLayer.options.attribution = source.attribution;
    tileLayer.setUrl(source.url);
  };

  const resetBasemap = () => {
    tileHealthRef.current = INITIAL_TILE_HEALTH;
    setTileStage('primary');
    applyBasemapSource(BASEMAP_SOURCES[baseMapStyleRef.current]);
  };

  // Filters State
  const [provinceFilter, setProvinceFilter] = useState<string>('ALL');
  const [conditionFilter, setConditionFilter] = useState<string>('ALL');
  const [showWimOnly, setShowWimOnly] = useState<boolean>(false);
  // Phones: secondary map filters fold behind one Filter button so the map stays visible.
  const [showMapFilters, setShowMapFilters] = useState<boolean>(false);
  const [showCommunityReports, setShowCommunityReports] = useState<boolean>(true);
  const [showAllCommunityReports, setShowAllCommunityReports] = useState<boolean>(false);
  const [wimStatusFilter, setWimStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Mobile Card Collapse State - Hidden by default on mobile screen format
  const [isMobileCardCollapsed, setIsMobileCardCollapsed] = useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  // Sync mobile report card state when toggled from Navbar disamping Dashboard button
  useEffect(() => {
    if (isCommunityReportCardOpen !== undefined) {
      setIsMobileCardCollapsed(!isCommunityReportCardOpen);
    }
  }, [isCommunityReportCardOpen]);

  // Report Detail Modal State
  const [detailModalReport, setDetailModalReport] = useState<DamageReport | null>(null);

  // Active Navigation Route Waypoints & Metrics Calculation (Google Maps style)
  const navRouteWaypoints = useMemo<[number, number][]>(() => {
    if (!activeNavigationTask) return [];
    const start = activeNavigationTask.startCoords;
    const end = activeNavigationTask.report.coordinates;
    const points: [number, number][] = [start];
    const steps = 16;
    const [lat1, lng1] = start;
    const [lat2, lng2] = end;

    for (let i = 1; i < steps; i++) {
      const frac = i / steps;
      let lat = lat1 + (lat2 - lat1) * frac;
      let lng = lng1 + (lng2 - lng1) * frac;
      // Realistic arterial roadway curve offset
      const offset = Math.sin(frac * Math.PI) * 0.0035;
      lat += (i % 2 === 0 ? 0.6 : -0.4) * offset;
      lng += (i % 3 === 0 ? -0.5 : 0.7) * offset;
      points.push([lat, lng]);
    }
    points.push(end);
    return points;
  }, [activeNavigationTask]);

  const navDistanceKm = useMemo(() => {
    if (!activeNavigationTask) return 0;
    const [lat1, lon1] = activeNavigationTask.startCoords;
    const [lat2, lon2] = activeNavigationTask.report.coordinates;
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.max(1.8, +(R * c * 1.25).toFixed(1));
  }, [activeNavigationTask]);

  const navEstimatedMinutes = useMemo(() => {
    return Math.max(3, Math.round((navDistanceKm / 38) * 60));
  }, [navDistanceKm]);

  const [navStepProgress, setNavStepProgress] = useState<number>(0);
  const [isNavVoiceMuted, setIsNavVoiceMuted] = useState<boolean>(false);
  const [manualStepIndex, setManualStepIndex] = useState<number | null>(null);

  // Reset navigation steps and progress when navigation ends
  useEffect(() => {
    if (!activeNavigationTask) {
      setManualStepIndex(null);
      setNavStepProgress(0);
    }
  }, [activeNavigationTask]);

  // Dynamic Google Maps Turn-by-Turn Maneuvers sequence
  interface NavManeuver {
    action: 'TURN_RIGHT' | 'TURN_LEFT' | 'KEEP_STRAIGHT' | 'ROUNDABOUT' | 'UTURN' | 'ARRIVE';
    maneuverTitle: string;
    distanceDisplay: string;
    roadName: string;
    detailGuidance: string;
  }

  const navManeuvers = useMemo<NavManeuver[]>(() => {
    if (!activeNavigationTask) return [];
    const rep = activeNavigationTask.report;
    const segName = rep.segmentName || 'Jalur Arteri Pantura';
    const corridor = rep.corridor || 'Koridor Utama';
    const damageName = rep.damageTypeLabel || rep.damageType || 'Lubang Jalan';
    const kmPost = (rep as any).kmPost || 'KM 54+200';

    return [
      {
        action: 'TURN_RIGHT',
        maneuverTitle: 'Belok Kanan',
        distanceDisplay: '450 m',
        roadName: `Jl. Akses Posko & ${segName.split('(')[0].trim()}`,
        detailGuidance: `Mulai bergerak dari Posko F.E menuju gerbang akses arteri`
      },
      {
        action: 'KEEP_STRAIGHT',
        maneuverTitle: 'Lurus Terus',
        distanceDisplay: '1.2 km',
        roadName: `${segName} (${corridor})`,
        detailGuidance: `Tetap di lajur tengah melewati jembatan & pos pantau WIM`
      },
      {
        action: 'TURN_LEFT',
        maneuverTitle: 'Belok Kiri',
        distanceDisplay: '300 m',
        roadName: `Bahu Jalan / Ruas ${segName.split('(')[0].trim()}`,
        detailGuidance: `Kurangi kecepatan dan pasang lampu hazard mendekati zona kerja`
      },
      {
        action: 'ARRIVE',
        maneuverTitle: 'Tiba di Lokasi Tugas',
        distanceDisplay: '50 m',
        roadName: `Titik Kerusakan: ${damageName} (${kmPost})`,
        detailGuidance: `Lokasi tugas #${rep.id} tepat berada di sisi kiri Anda. Siapkan APD & penanganan.`
      }
    ];
  }, [activeNavigationTask]);

  // Derived active maneuver index based on GPS vehicle progress
  const autoStepIndex = useMemo(() => {
    if (navManeuvers.length === 0) return 0;
    if (navRouteWaypoints.length <= 1) return 0;
    const ratio = navStepProgress / (navRouteWaypoints.length - 1);
    const idx = Math.min(Math.floor(ratio * navManeuvers.length), navManeuvers.length - 1);
    return idx;
  }, [navManeuvers, navRouteWaypoints.length, navStepProgress]);

  const activeManeuverIndex = manualStepIndex !== null ? manualStepIndex : autoStepIndex;
  const currentManeuver = navManeuvers[activeManeuverIndex] || navManeuvers[0];

  // Web Audio chime helper for auditory feedback
  const playNavChime = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const ctx = new AudioContextClass();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch {
      // Ignore audio context errors
    }
  };

  // Text-to-speech voice navigation engine
  const speakNavGuidance = (maneuver: NavManeuver) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (isNavVoiceMuted) return;

    try {
      window.speechSynthesis.cancel();
      playNavChime();

      let textToSpeak = '';
      const cleanRoad = maneuver.roadName.replace(/^ke\s+/i, '').replace(/^di\s+/i, '');
      if (maneuver.action === 'TURN_RIGHT') {
        textToSpeak = `Dalam ${maneuver.distanceDisplay}, belok kanan ke ${cleanRoad}`;
      } else if (maneuver.action === 'TURN_LEFT') {
        textToSpeak = `Dalam ${maneuver.distanceDisplay}, belok kiri ke ${cleanRoad}`;
      } else if (maneuver.action === 'KEEP_STRAIGHT') {
        textToSpeak = `Lurus terus sejauh ${maneuver.distanceDisplay} di ${cleanRoad}`;
      } else if (maneuver.action === 'ARRIVE') {
        textToSpeak = `Tiba di lokasi tugas. ${maneuver.roadName}`;
      } else {
        textToSpeak = `${maneuver.maneuverTitle}. ${maneuver.roadName}`;
      }

      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.rate = 1.02;
      utterance.pitch = 1.0;
      utterance.lang = 'id-ID';

      const voices = window.speechSynthesis.getVoices();
      const idVoice = voices.find(
        (v) => v.lang.includes('id') || v.lang.includes('ID') || v.name.toLowerCase().includes('indonesia')
      );
      if (idVoice) {
        utterance.voice = idVoice;
      }

      window.speechSynthesis.speak(utterance);
    } catch {
      // Fallback silently if speech synthesis error occurs
    }
  };

  const lastSpokenManeuverRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activeNavigationTask || !currentManeuver) {
      lastSpokenManeuverRef.current = null;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      return;
    }

    if (!isNavVoiceMuted && lastSpokenManeuverRef.current !== activeManeuverIndex) {
      lastSpokenManeuverRef.current = activeManeuverIndex;
      speakNavGuidance(currentManeuver);
    }
  }, [activeNavigationTask, activeManeuverIndex, isNavVoiceMuted, currentManeuver]);

  // Animate simulated vehicle along route waypoints
  useEffect(() => {
    if (!activeNavigationTask || navRouteWaypoints.length === 0) {
      setNavStepProgress(0);
      return;
    }
    const interval = setInterval(() => {
      setNavStepProgress((prev) => {
        if (prev < navRouteWaypoints.length - 1) {
          return prev + 1;
        }
        return prev;
      });
    }, 2200);
    return () => clearInterval(interval);
  }, [activeNavigationTask, navRouteWaypoints]);

  // Active Animation States for Newly Created Reports (Zoom-out Karawang -> Fly-in -> Sprout / Grow Pin)
  const [hiddenPinReportId, setHiddenPinReportId] = useState<string | null>(null);
  const [sproutingPinReportId, setSproutingPinReportId] = useState<string | null>(null);
  const [activeBlinkReportId, setActiveBlinkReportId] = useState<string | null>(highlightReportId);

  // Center & zoom map when mapCenterTarget is set (With cinematic zoom-out from Karawang -> zoom-in to position -> sprout pin)
  useEffect(() => {
    if (mapCenterTarget && mapInstanceRef.current) {
      const map = mapInstanceRef.current;
      const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;
      const targetZoom = mapCenterTarget.zoom || 17;
      let targetCoords: [number, number] = mapCenterTarget.coords;

      if (isMobile) {
        // Project coordinates into pixel space to calculate an exact vertical offset for mobile.
        // On mobile, the bottom card occupies ~48% of screen height.
        // Offsetting the map center downwards along the Y-axis by ~195px ensures the pin point
        // is positioned perfectly in the upper visible section of the map, clearly above the top of the bottom card.
        const targetPoint = map.project(mapCenterTarget.coords, targetZoom);
        const offsetPoint = L.point(targetPoint.x, targetPoint.y + 195);
        const unprojected = map.unproject(offsetPoint, targetZoom);
        targetCoords = [unprojected.lat, unprojected.lng];
      }

      if (highlightReportId) {
        // Step 1: Hide the new pin initially so the map flies into an empty coordinate without pin
        setHiddenPinReportId(highlightReportId);
        setSproutingPinReportId(null);
        setActiveBlinkReportId(null);

        // Step 2: Set map view to zoomed-out Karawang regional view (Karawang default center: [-6.305, 107.300], zoom 11)
        map.setView([-6.305, 107.300], 11, { animate: false });

        // Step 3: Fly from Karawang regional view into the target location with close range (Zoom in)
        const flyTimeout = setTimeout(() => {
          moveCamera(map, targetCoords, targetZoom, {
            duration: 2.2,
            easeLinearity: 0.25
          });
        }, 120);

        // Step 4: After zoom-in finishes (2400ms), reveal and sprout / grow the pin point at the location
        const sproutTimeout = setTimeout(() => {
          setHiddenPinReportId(null);
          setSproutingPinReportId(highlightReportId);
          setActiveBlinkReportId(highlightReportId);
        }, 2450);

        // Step 5: Settle to normal pin state after animation finishes
        const settleTimeout = setTimeout(() => {
          setSproutingPinReportId(null);
          setActiveBlinkReportId(null);
        }, 8000);

        return () => {
          clearTimeout(flyTimeout);
          clearTimeout(sproutTimeout);
          clearTimeout(settleTimeout);
        };
      } else {
        // Standard navigation flyTo
        moveCamera(map, targetCoords, targetZoom, {
          duration: 1.4
        });
      }
    }
  }, [mapCenterTarget, highlightReportId]);

  // Report Modal Form State & Click-on-Map Custom Coordinates
  const [isReportFormOpen, setIsReportFormOpen] = useState<boolean>(false);
  const [customCoordinates, setCustomCoordinates] = useState<[number, number] | null>(null);
  const [formSegmentId, setFormSegmentId] = useState<string>(roadSegments[0]?.id || '');
  const [formDamageType, setFormDamageType] = useState<DamageType>('POTHOLE');
  const [formSeverity, setFormSeverity] = useState<ReportSeverity>('SEVERE');
  const [formEstimatedDepth, setFormEstimatedDepth] = useState<number>(12);
  const [formEstimatedArea, setFormEstimatedArea] = useState<number>(4.5);
  const [formDescription, setFormDescription] = useState<string>('');
  const [formPhotoIndex, setFormPhotoIndex] = useState<number>(0);

  // Selected Segment for Form WIM Correlation
  const activeFormSegment = roadSegments.find((s) => s.id === formSegmentId) || roadSegments[0] || selectedSegment;


  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDescription.trim()) {
      alert('Mohon masukkan deskripsi kerusakan jalan!');
      return;
    }

    const damageLabels: Record<DamageType, string> = {
      POTHOLE: 'Lubang Dalam (Pothole)',
      ALLIGATOR_CRACK: 'Retak Buaya (Alligator Cracking)',
      RUTTING: 'Ambles & Deformasi Alur (Rutting)',
      CORRUGATION: 'Kerusakan Gelombang (Corrugation)',
      SUBSIDENCE: 'Penurunan Pondasi (Subsidence)',
      CRACK: 'Retak Permukaan (Surface Crack)',
      SURFACE_DAMAGE: 'Kerusakan Permukaan (Surface Damage)',
      ROAD_DEFORMATION: 'Deformasi Jalan (Road Deformation)',
      DEPRESSION: 'Ambles Lokal (Depression)',
      PATCHING: 'Tambalan (Patching)',
      FLOODING: 'Genangan / Banjir (Flooding)'
    };

    const photoPresets = [
      'https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&q=80&w=600',
      'https://images.unsplash.com/photo-1584467735871-8e85353a8413?auto=format&fit=crop&q=80&w=600',
      'https://images.unsplash.com/photo-1517649763962-0c623266ddc0?auto=format&fit=crop&q=80&w=600'
    ];

    let newReport: DamageReport;
    try {
      newReport = createSessionReport({
      reporterName: currentAccount?.name || 'Masyarakat Pelapor',
      reporterRole:
        activeRole === 'PUBLIC_REPORTER'
          ? 'Pelapor Terverifikasi'
          : activeRole === 'PUBLIC_VIEWER'
          ? 'Pengamat Komunitas'
          : 'Petugas Lapangan',
      reporterAvatar:
        currentAccount?.avatarUrl ||
        'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200',
      timestamp: new Date().toLocaleString('id-ID', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }),
      segmentId: activeFormSegment.id,
      segmentName: activeFormSegment.name,
      corridor: activeFormSegment.corridor,
      province: activeFormSegment.province,
      coordinates: customCoordinates || activeFormSegment.coordinates,
      damageType: formDamageType,
      damageTypeLabel: damageLabels[formDamageType],
      severity: formSeverity,
      estimatedDepthCm: Number(formEstimatedDepth),
      estimatedAreaM2: Number(formEstimatedArea),
      photoUrl: photoPresets[formPhotoIndex] || photoPresets[0],
      description: formDescription,
      upvotesCount: 1,
      userUpvoted: true
      }, currentAccount);
    } catch (error) {
      if (error instanceof ReportCreationError) {
        alert(error.message);
        return;
      }
      throw error;
    }

    if (onAddReport) {
      const outcome = await settleMutation(onAddReport(newReport), newReport);
      if (outcome.ok === false) {
        alert(`Laporan belum tersimpan: ${(outcome as { error: string }).error}`);
        return;
      }
      newReport = (outcome as { report: DamageReport }).report;
    }

    setIsReportFormOpen(false);
    setFormDescription('');

    // Trigger cinematic camera fly-in and sprout animation with ripple effect
    const targetCoords = newReport.coordinates;
    const map = mapInstanceRef.current;
    if (map) {
      setHiddenPinReportId(newReport.id);
      setSproutingPinReportId(null);
      setActiveBlinkReportId(null);
      map.setView([-6.305, 107.300], 11, { animate: false });
      setTimeout(() => {
        moveCamera(map, targetCoords, 17, { duration: 2.2, easeLinearity: 0.25 });
      }, 120);
      setTimeout(() => {
        setHiddenPinReportId(null);
        setSproutingPinReportId(newReport.id);
        setActiveBlinkReportId(newReport.id);
      }, 2450);
      setTimeout(() => {
        setSproutingPinReportId(null);
        setActiveBlinkReportId(null);
      }, 8000);
    }

    // Automatically slide up the report detail card from the bottom after pin finishes sprouting
    setTimeout(() => {
      if (onSelectReport) {
        onSelectReport(newReport);
      } else {
        setDetailModalReport(newReport);
      }
    }, 2800);
  };

  // Filtered Segments
  const filteredSegments = roadSegments.filter((seg) => {
    const matchProvince = provinceFilter === 'ALL' || seg.province === provinceFilter;
    const matchCondition =
      conditionFilter === 'ALL' || seg.conditionCategory === conditionFilter;
    const matchWim = !showWimOnly || seg.hasWimStation;
    const matchSearch =
      searchQuery === '' ||
      seg.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      seg.corridor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      seg.province.toLowerCase().includes(searchQuery.toLowerCase());
    return matchProvince && matchCondition && matchWim && matchSearch;
  });

  // Filtered WIM Stations
  const filteredWimStations = ALL_BINA_MARGA_WIM_STATIONS.filter((wim) => {
    if (!showWimOnly) return false;

    const matchProvince = provinceFilter === 'ALL' || wim.province === provinceFilter;
    const matchSearch =
      searchQuery === '' ||
      wim.stationName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      wim.corridor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      wim.province.toLowerCase().includes(searchQuery.toLowerCase()) ||
      wim.stationId.toLowerCase().includes(searchQuery.toLowerCase());

    let matchStatus = true;
    if (wimStatusFilter === 'EXTREME') {
      matchStatus = wim.overloadCategory === 'EXTREME' || wim.overloadPercent > 100;
    } else if (wimStatusFilter === 'HEAVY') {
      matchStatus = wim.overloadCategory === 'HEAVY' || (wim.overloadPercent > 50 && wim.overloadPercent <= 100);
    } else if (wimStatusFilter === 'MODERATE') {
      matchStatus = wim.overloadCategory === 'MODERATE' || (wim.overloadPercent > 20 && wim.overloadPercent <= 50);
    } else if (wimStatusFilter === 'LIGHT') {
      matchStatus = wim.overloadCategory === 'LIGHT' || (wim.overloadPercent > 0 && wim.overloadPercent <= 20);
    } else if (wimStatusFilter === 'NONE') {
      matchStatus = wim.overloadCategory === 'NONE' || wim.overloadPercent === 0;
    }

    return matchProvince && matchSearch && matchStatus;
  });

  // Calculate Map Summary Metrics
  const totalLengthKm = roadSegments.reduce((sum, s) => sum + (s.lengthKm || 0), 0) || 1;
  const damagedKm = roadSegments
    .filter((s) => s.conditionCategory === 'LIGHT_DAMAGE' || s.conditionCategory === 'HEAVY_DAMAGE')
    .reduce((sum, s) => sum + (s.lengthKm || 0), 0);
  const damagedPercent = ((damagedKm / totalLengthKm) * 100).toFixed(1);
  const activeRedAlertsCount = roadSegments.filter((s) => s.activeOdolAlert === 'RED').length;
  const avgPci = roadSegments.length
    ? Math.round(roadSegments.reduce((sum, s) => sum + (s.currentPci || 0), 0) / roadSegments.length)
    : 0;

  // Authoritative Location Selection State (Single Source of Truth)
  const [activeSelection, setActiveSelection] = useState<LocationSelection | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const activeLocationPopupRef = useRef<L.Popup | null>(null);

  // Confirmed Pin Point State (active across approval popup close and report form lifecycle)
  const [confirmedPinPoint, setConfirmedPinPoint] = useState<{
    coordinates: [number, number];
    nearestSegment: RoadSegment;
  } | null>(null);

  // Independent Location Approval Popup Visibility State
  const [isLocationPopupOpen, setIsLocationPopupOpen] = useState<boolean>(true);

  // Dedicated LayerGroup & Marker Ref for Active Pin (Separated from general map layers to prevent pan reset conflicts)
  const activePinLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const activePinMarkerRef = useRef<L.Marker | null>(null);
  const lastCenteredSegmentIdRef = useRef<string | null>(null);

  // Helper to remove and clean up any open location approval popup on the map
  const removeActiveLocationPopup = (map?: L.Map | null) => {
    if (activeLocationPopupRef.current) {
      activeLocationPopupRef.current.remove();
      activeLocationPopupRef.current = null;
    }
    const targetMap = map || mapInstanceRef.current;
    if (targetMap) {
      targetMap.eachLayer((layer) => {
        if (
          layer instanceof L.Popup &&
          layer.options.className?.includes('compact-location-approval-popup')
        ) {
          targetMap.closePopup(layer);
          layer.remove();
        }
      });
    }
  };

  // Triggers road identification for given coordinates with race condition cancellation
  const triggerLocationResolution = useCallback((coords: [number, number]) => {
    const map = mapInstanceRef.current;
    if (!map || !isValidCoordinate(coords)) return;

    activeAbortControllerRef.current?.abort();
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;

    removeActiveLocationPopup(map);
    setConfirmedPinPoint(null);
    setIsLocationPopupOpen(true);

    const newSelection = createLocationSelection(coords);
    activeRequestIdRef.current = newSelection.requestId;
    setActiveSelection(newSelection);
    onActivePinChangeRef.current?.(coords, null);

    resolveRoadSelection(newSelection, roadSegmentsRef.current, {
      signal: controller.signal,
      maxRadiusMeters: DEFAULT_ROAD_SEARCH_RADIUS_METERS
    })
      .then((resolved) => {
        if (activeRequestIdRef.current !== newSelection.requestId) return;
        setActiveSelection(resolved);
        onActivePinChangeRef.current?.(resolved.coordinates, resolved.segment);
      })
      .catch((err) => {
        if (err.name === 'AbortError' || activeRequestIdRef.current !== newSelection.requestId) return;
        setActiveSelection((prev) =>
          prev && prev.selectionId === newSelection.selectionId
            ? {
                ...prev,
                status: 'ERROR',
                state: 'error',
                errorMessage: isEnRef.current ? 'Failed to fetch road data' : 'Gagal mengambil data ruas jalan'
              }
            : prev
        );
      });
  }, []);

  const triggerLocationResolutionRef = useRef(triggerLocationResolution);
  triggerLocationResolutionRef.current = triggerLocationResolution;

  // Synchronize with external activePinCoordinates from parent (e.g. ReportRoadIssueCard or URL query)
  useEffect(() => {
    if (activePinCoordinates === null && confirmedPinPoint !== null) {
      setConfirmedPinPoint(null);
    } else if (
      activePinCoordinates &&
      isValidCoordinate(activePinCoordinates) &&
      (!activeSelection ||
        Math.abs(activeSelection.coordinates[0] - activePinCoordinates[0]) > 1e-5 ||
        Math.abs(activeSelection.coordinates[1] - activePinCoordinates[1]) > 1e-5)
    ) {
      triggerLocationResolution(activePinCoordinates);
    }
  }, [activePinCoordinates, triggerLocationResolution]);

  const tempMarkerRef = useRef<L.Marker | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [-6.3050, 107.3180],
        zoom: 12,
        zoomControl: false
      });

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // Keep the world at least as tall as the map and stop vertical panning past the poles,
      // so the map never shows as a strip with empty space above and below.
      const applyZoomFloor = () => {
        const height = map.getSize().y;
        if (height > 0) map.setMinZoom(minZoomForViewportHeight(height));
      };
      map.options.maxBoundsViscosity = 1;
      map.setMaxBounds([
        [-85.0511, -1800],
        [85.0511, 1800]
      ]);
      applyZoomFloor();
      map.on('resize', applyZoomFloor);

      // Select tile source based on baseMapStyle (DARK, SATELLITE, LIGHT)
      const source = BASEMAP_SOURCES[baseMapStyle];
      const tileLayer = L.tileLayer(source.url, {
        attribution: source.attribution,
        maxZoom: 19
      }).addTo(map);

      tileLayerRef.current = tileLayer;

      // A provider that serves nothing is replaced once; data layers are never removed.
      tileLayer.on('tileload', () => {
        tileHealthRef.current = recordTileLoad(tileHealthRef.current);
      });
      tileLayer.on('tileerror', () => {
        const previous = tileHealthRef.current;
        const next = recordTileError(previous);
        tileHealthRef.current = next;
        if (next.stage === previous.stage) return;
        if (next.stage === 'fallback') {
          applyBasemapSource(sourceForStage(baseMapStyleRef.current, 'fallback'));
        }
        setTileStage(next.stage);
      });

      // Map click event listener: Select point and set activeSelection
      // Completely decoupled from camera movement: never calls panTo, preserving user viewport
      map.on('click', (e: L.LeafletMouseEvent) => {
        const orig = e.originalEvent?.target as HTMLElement | null;
        if (
          orig &&
          (orig.closest('.leaflet-marker-icon') ||
            orig.closest('.leaflet-popup') ||
            orig.closest('.compact-location-approval-popup') ||
            orig.closest('.leaflet-control'))
        ) {
          return;
        }

        const clickedLat = parseFloat(e.latlng.lat.toFixed(6));
        const clickedLng = parseFloat(e.latlng.lng.toFixed(6));

        if (!isValidCoordinate([clickedLat, clickedLng])) return;

        triggerLocationResolutionRef.current([clickedLat, clickedLng]);
      });

      layerGroupRef.current = L.layerGroup().addTo(map);
      activePinLayerGroupRef.current = L.layerGroup().addTo(map);

      // Viewport reporting: detail level follows the zoom, surrounding UI follows movement.
      const reportViewport = (moving: boolean) => {
        // A pan/zoom animation can still fire after map.remove() (page switch); its panes are gone then.
        if (!map.getContainer().isConnected || !map.getPane('mapPane')) return;
        const b = map.getBounds();
        onViewportChangeRef.current?.({
          zoom: map.getZoom(),
          bounds: [
            [b.getSouth(), b.getWest()],
            [b.getNorth(), b.getEast()]
          ],
          moving
        });
      };
      map.on('movestart', () => reportViewport(true));
      map.on('moveend', () => {
        setZoom(map.getZoom());
        reportViewport(false);
      });
      map.whenReady(() => reportViewport(false));
      mapInstanceRef.current = map;
      attachMapResizeRecovery(map, mapContainerRef.current);
    }

    return () => {
      activeAbortControllerRef.current?.abort();
      removeActiveLocationPopup(mapInstanceRef.current);
      if (activePinLayerGroupRef.current) {
        activePinLayerGroupRef.current.clearLayers();
        activePinLayerGroupRef.current.remove();
        activePinLayerGroupRef.current = null;
      }
      activePinMarkerRef.current = null;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update tile layer url when baseMapStyle or theme changes
  useEffect(() => {
    if (tileLayerRef.current) {
      resetBasemap();
    }
  }, [baseMapStyle, theme]);

  // Render Polylines and Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    filteredSegments.forEach((segment) => {
      const canonical = getCanonicalRoadGeometry(segment.id);
      const polyline =
        canonical && canonical.geometry.coordinates.length > 1
          ? toLeafletPolyline(canonical.geometry.coordinates)
          : segment.polyline;

      const color =
        segment.conditionCategory === 'GOOD'
          ? '#57ae78'
          : segment.conditionCategory === 'MODERATE'
          ? '#e8b23a'
          : segment.conditionCategory === 'LIGHT_DAMAGE'
          ? '#e2823d'
          : '#d9655d';

      // Segment line (canonical centerline geometry), drawn once it is long enough to read
      if (zoom >= SEGMENT_LINE_MIN_ZOOM && polyline.length > 1) {
        const isSelectedLine = selectedSegment?.id === segment.id;
        const zoomDiff = Math.max(0, zoom - SEGMENT_LINE_MIN_ZOOM);
        const baseWeight = Math.max(3, Math.min(9, Math.round(3.5 + zoomDiff * 0.8)));
        const selectedWeight = baseWeight + 4;
        const casingWeight = selectedWeight + 5;

        if (isSelectedLine) {
          L.polyline(polyline, {
            color: '#ffffff',
            weight: casingWeight,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false
          }).addTo(layerGroup);
        }
        const line = L.polyline(polyline, {
          color,
          weight: isSelectedLine ? selectedWeight : baseWeight,
          opacity: isSelectedLine ? 1 : 0.88,
          lineCap: 'round',
          lineJoin: 'round',
          bubblingMouseEvents: false
        }).addTo(layerGroup);
        const geomStatus = canonical?.geometryStatus ?? segment.geometryStatus;
        const geomLabel = geomStatus === 'DIGITISED' ? 'OSM Centerline' : 'Garis perkiraan';
        line.bindTooltip(`${segment.name} · PCI ${segment.currentPci} (${geomLabel})`, { sticky: true });
        line.on('click', () => onSelectSegment(segment));
        // Invisible wider line so the segment can be tapped on a touch screen
        L.polyline(polyline, {
          color,
          weight: Math.max(24, casingWeight + 12),
          opacity: 0,
          lineCap: 'round',
          bubblingMouseEvents: false
        })
          .addTo(layerGroup)
          .on('click', () => onSelectSegment(segment));
      }

      // Pins and station markers would cover the area overview, so they start one level later.
      // On the public map the line itself is the segment; a pin on top of it would hide reports.
      if (zoom < SEGMENT_PIN_MIN_ZOOM || isRegularUser) return;

      // Render location pin marker with white circular background behind layer icon
      const customIconHtml = `
        <div style="position: relative; width: 34px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.38)); transition: transform 0.15s ease;">
          <!-- SVG Map Pin Shape -->
          <svg viewBox="0 0 384 512" width="32" height="42" fill="${color}" xmlns="http://www.w3.org/2000/svg">
            <path d="M172.268 501.67C26.97 291.031 0 269.413 0 192 0 85.961 85.961 0 192 0s192 85.961 192 192c0 77.413-26.97 99.031-172.268 309.67-9.535 13.774-29.93 13.773-39.464 0z"/>
          </svg>
          <!-- Background Bulat Putih Dibelakang Layer Icon -->
          <div style="
            position: absolute;
            top: 5px;
            left: 50%;
            transform: translateX(-50%);
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background-color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 1px 3px rgba(0,0,0,0.25);
            z-index: 2;
          ">
            <span style="
              color: ${color};
              font-weight: 900;
              font-size: 10px;
              font-family: monospace;
              line-height: 1;
            ">
              ${segment.currentPci}
            </span>
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: customIconHtml,
        className: 'custom-leaflet-marker',
        iconSize: [34, 44],
        iconAnchor: [17, 42]
      });

      const marker = L.marker(segment.coordinates, { icon: customIcon, bubblingMouseEvents: false }).addTo(layerGroup);
      marker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onSelectSegment(segment);
      });

      // If segment has WIM station, render dedicated WIM Sensor Station Marker (ONLY for Official Roles)
      if (!isRegularUser && segment.hasWimStation && segment.wimDetails) {
        const wim = segment.wimDetails;
        const wimAlertColor =
          wim.alertSeverity === 'RED'
            ? '#d9655d'
            : wim.alertSeverity === 'YELLOW'
            ? '#e8b23a'
            : '#57ae78';

        const wimIconHtml = `
          <div style="
            position: relative;
            background-color: #0f172a;
            border: 2px solid ${wimAlertColor};
            border-radius: 12px;
            padding: 3px 6px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.6), 0 0 10px ${wimAlertColor}80;
            display: flex;
            align-items: center;
            gap: 4px;
            color: white;
            font-size: 10px;
            font-weight: 600;
            white-space: nowrap;
            cursor: pointer;
          ">
            <span style="
              width: 8px;
              height: 8px;
              border-radius: 50%;
              background-color: ${wimAlertColor};
              display: inline-block;
              box-shadow: 0 0 8px ${wimAlertColor};
            "></span>
            <span>⚖️ WIM: ${wim.stationId}</span>
          </div>
        `;

        const wimIcon = L.divIcon({
          html: wimIconHtml,
          className: 'custom-wim-leaflet-marker',
          iconSize: [110, 24],
          iconAnchor: [55, 12]
        });

        const wimMarker = L.marker(wim.coordinates, { icon: wimIcon }).addTo(layerGroup);

        const wimPopupHtml = `
          <div style="font-family: system-ui, -apple-system, sans-serif; padding: 6px; width: 280px; color: #0f172a;">
            <!-- Header -->
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; border-b: 1px solid #e2e8f0; padding-bottom: 6px;">
              <div style="display: flex; align-items: center; gap: 4px;">
                <span style="background-color: #f5bc2426; color: #1C1C1A; font-weight: 600; font-size: 10px; padding: 2px 6px; border-radius: 6px; font-family: monospace;">
                  ${wim.stationId}
                </span>
                <span style="font-size: 10px; font-weight: 700; color: #64748b;">STASIUN SENSOR WIM</span>
              </div>
              <span style="background-color: ${wimAlertColor}20; color: ${wimAlertColor}; border: 1px solid ${wimAlertColor}50; font-size: 9.5px; font-weight: 600; padding: 2px 8px; border-radius: 12px;">
                ${wim.alertSeverity === 'RED' ? '🔴 RED ALERT (ODOL)' : wim.alertSeverity === 'YELLOW' ? '🟡 WARNING' : '🟢 NORMAL PASS'}
              </span>
            </div>

            <!-- Station Title & Location -->
            <h4 style="font-size: 13px; font-weight: 600; color: #0f172a; margin: 0 0 2px 0;">${wim.stationName}</h4>
            <p style="font-size: 10.5px; color: #475569; margin: 0 0 8px 0; font-family: monospace;">
              📍 GPS: <strong style="color: #1C1C1A;">${wim.coordinates[0].toFixed(4)}, ${wim.coordinates[1].toFixed(4)}</strong> (${wim.province})
            </p>

            <!-- ANPR & Vehicle Load Telemetry -->
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px; font-size: 11px; margin-bottom: 8px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 4px;">
                <span style="color: #64748b;">Truk / ANPR:</span>
                <span style="font-weight: 600; color: #0f172a; font-family: monospace;">${wim.licensePlate} (${wim.speedKmh} km/h)</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: #64748b;">Golongan:</span>
                <span style="font-weight: 700; color: #334155; font-size: 10px;">${wim.vehicleClass}</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: #64748b;">Beban Sumbu Maks:</span>
                <span style="font-weight: 600; color: ${wim.maxAxleLoadTon > 10 ? '#d9655d' : '#57ae78'};">
                  ${wim.maxAxleLoadTon} Ton ${wim.maxAxleLoadTon > 10 ? `(+${wim.overloadPercent}% ODOL)` : ''}
                </span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #64748b;">Gross Weight:</span>
                <span style="font-weight: 700; color: #1e293b;">${wim.grossWeightTon} Ton (MST ${wim.legalLimitTon} Ton)</span>
              </div>
            </div>

            <!-- PINN Engineering Impact Correlation -->
            <div style="background-color: #f7f8fa; border: 1px solid #e3e6eb; border-radius: 10px; padding: 8px; font-size: 10.5px; color: #1C1C1A; margin-bottom: 8px;">
              <div style="font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
                <span>🧠 KORELASI PINN FISIKA PERKERASAN</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                <span>Defleksi Permukaan FWD:</span>
                <strong>${wim.fwdDeflectionMicron} µm</strong>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                <span>Indeks Induksi Kerusakan:</span>
                <strong style="color: #b91c1c;">${wim.pinnDamageImpactIndex} / 100</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>Rekomendasi Overlay AC-WC:</span>
                <strong>${wim.overlayRecommendationCm} cm</strong>
              </div>
            </div>

            <div style="display: flex; gap: 4px;">
              <button id="btn-wim-sim-${segment.id}" style="
                flex: 1;
                background: #1C1C1A;
                color: white;
                border: none;
                border-radius: 8px;
                padding: 7px 10px;
                font-size: 10.5px;
                font-weight: 700;
                cursor: pointer;
                box-shadow: 0 4px 10px rgba(2, 132, 199, 0.3);
              ">
                ⚡ Jalankan Simulasi PINN
              </button>
            </div>
          </div>
        `;

        wimMarker.bindPopup(wimPopupHtml);

        wimMarker.on('popupopen', () => {
          onSelectSegment(segment);
          const btnWimSim = document.getElementById(`btn-wim-sim-${segment.id}`);
          if (btnWimSim) {
            btnWimSim.onclick = () => onLaunchSimulation(segment);
          }
        });
      }

      const popupHtml = `
        <div style="font-family: system-ui, -apple-system, sans-serif; padding: 6px; min-width: 260px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <span style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">${segment.corridor}</span>
            <span style="background-color: ${color}20; color: ${color}; border: 1px solid ${color}40; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 12px;">
              PCI: ${segment.currentPci} (${segment.conditionCategory})
            </span>
          </div>
          <h4 style="font-size: 14px; font-weight: 600; color: #0f172a; margin: 0 0 2px 0;">${segment.name}</h4>
          <p style="font-size: 10.5px; color: #475569; margin: 0 0 8px 0; font-family: monospace;">
            📍 Koordinat GPS: <strong style="color: #1C1C1A;">${segment.coordinates[0].toFixed(4)}, ${segment.coordinates[1].toFixed(4)}</strong> | ${segment.kmPost}
          </p>
          
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 8px; font-size: 11px; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
              <span style="color: #64748b;">Subgrade CBR:</span>
              <span style="font-weight: 700; color: #1e293b;">${segment.defaultCbrPercent}%</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
              <span style="color: #64748b;">LHR Traffic:</span>
              <span style="font-weight: 700; color: #1e293b;">${(segment.dailyTrafficVolumeLhr ?? 0).toLocaleString('id-ID')} Kend/Hari</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b;">Beban Sumbu Rata-rata:</span>
              <span style="font-weight: 700; color: ${segment.defaultAxleLoadTon > 18 ? '#d9655d' : '#1C1C1A'};">
                ${segment.defaultAxleLoadTon} Ton ${segment.defaultAxleLoadTon > 10 ? '(ODOL)' : ''}
              </span>
            </div>
          </div>

          ${
            !isRegularUser && segment.hasWimStation && segment.wimDetails
              ? `<div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 6px 8px; font-size: 10.5px; color: #991b1b; margin-bottom: 8px;">
                  <div style="display: flex; items-center; justify-content: space-between; margin-bottom: 2px;">
                    <span style="font-weight: 600;">⚖️ ${segment.wimDetails.stationName}</span>
                    <span style="background-color: #d9655d; color: white; padding: 1px 5px; border-radius: 8px; font-weight: bold; font-size: 8.5px;">WIM ACTIVE</span>
                  </div>
                  <div style="font-size: 9.5px; color: #7f1d1d; font-family: monospace;">
                    📍 Sensor Lat/Lng: ${segment.wimDetails.coordinates[0].toFixed(4)}, ${segment.wimDetails.coordinates[1].toFixed(4)}
                  </div>
                  <div style="font-size: 9.5px; color: #991b1b; font-weight: bold; margin-top: 2px;">
                    Truk Terakhir: ${segment.wimDetails.licensePlate} (${segment.wimDetails.maxAxleLoadTon} Ton - ODOL +${segment.wimDetails.overloadPercent}%)
                  </div>
                </div>`
              : ''
          }

          <div style="display: flex; gap: 4px;">
            <button id="btn-sim-${segment.id}" style="
              flex: 1;
              background: #1C1C1A;
              color: white;
              border: none;
              border-radius: 10px;
              padding: 8px 10px;
              font-size: 11px;
              font-weight: 700;
              cursor: pointer;
              box-shadow: 0 4px 10px rgba(79, 70, 229, 0.3);
            ">
              ⚡ Simulasi PINN
            </button>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);

      marker.on('popupopen', () => {
        onSelectSegment(segment);
        const btnSim = document.getElementById(`btn-sim-${segment.id}`);
        if (btnSim) {
          btnSim.onclick = () => onLaunchSimulation(segment);
        }
      });
    });

    // Render Bina Marga National WIM Station Pin Points when showWimOnly is enabled (ONLY for Official Roles)
    if (!isRegularUser && showWimOnly) {
      filteredWimStations.forEach((wim) => {
        const pinColor =
          wim.overloadCategory === 'EXTREME' || wim.overloadPercent > 100
            ? '#d9655d' // Red
            : wim.overloadCategory === 'HEAVY' || wim.overloadPercent > 50
            ? '#8296b0' // Purple
            : wim.overloadCategory === 'MODERATE' || wim.overloadPercent > 20
            ? '#e2823d' // Orange
            : wim.overloadCategory === 'LIGHT' || wim.overloadPercent > 0
            ? '#e8b23a' // Yellow
            : '#57ae78'; // Green

        const pinCategoryText =
          wim.overloadCategory === 'EXTREME' || wim.overloadPercent > 100
            ? 'Overload Ekstrim (>100%)'
            : wim.overloadCategory === 'HEAVY' || wim.overloadPercent > 50
            ? 'Overload Berat (>50%)'
            : wim.overloadCategory === 'MODERATE' || wim.overloadPercent > 20
            ? 'Overload Sedang (20-50%)'
            : wim.overloadCategory === 'LIGHT' || wim.overloadPercent > 0
            ? 'Overload Ringan (5-20%)'
            : 'Tidak Overload';

        // Pin marker HTML (custom SVG pin matching Bina Marga Dashboard style)
        const wimPinHtml = `
          <div style="position: relative; width: 30px; height: 38px; cursor: pointer; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5));">
            <svg viewBox="0 0 384 512" width="30" height="38" fill="${pinColor}" xmlns="http://www.w3.org/2000/svg">
              <path d="M172.268 501.67C26.97 291.031 0 269.413 0 192 0 85.961 85.961 0 192 0s192 85.961 192 192c0 77.413-26.97 99.031-172.268 309.67-9.535 13.774-29.93 13.773-39.464 0z"/>
            </svg>
            <div style="
              position: absolute;
              top: 5px;
              left: 50%;
              transform: translateX(-50%);
              width: 18px;
              height: 18px;
              border-radius: 50%;
              background-color: white;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 10px;
              box-shadow: inset 0 1px 2px rgba(0,0,0,0.3);
            ">
              ⚖️
            </div>
          </div>
        `;

        const wimPinIcon = L.divIcon({
          html: wimPinHtml,
          className: 'bina-marga-wim-pin-marker',
          iconSize: [30, 38],
          iconAnchor: [15, 38]
        });

        const wimPinMarker = L.marker(wim.coordinates, { icon: wimPinIcon }).addTo(layerGroup);

        const wimPopupContent = `
          <div style="font-family: system-ui, -apple-system, sans-serif; padding: 6px; width: 285px; color: #0f172a;">
            <!-- Header -->
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
              <div style="display: flex; align-items: center; gap: 4px;">
                <span style="background-color: #f5bc2426; color: #1C1C1A; font-weight: 600; font-size: 10px; padding: 2px 6px; border-radius: 6px; font-family: monospace;">
                  ${wim.stationId}
                </span>
                <span style="font-size: 10px; font-weight: 700; color: #64748b;">STASIUN WIM BINA MARGA</span>
              </div>
              <span style="background-color: ${pinColor}20; color: ${pinColor}; border: 1px solid ${pinColor}50; font-size: 9.5px; font-weight: 600; padding: 2px 8px; border-radius: 12px;">
                ${pinCategoryText}
              </span>
            </div>

            <!-- Station Name & Corridor -->
            <h4 style="font-size: 13px; font-weight: 600; color: #0f172a; margin: 0 0 2px 0;">${wim.stationName}</h4>
            <p style="font-size: 10px; color: #64748b; font-weight: 600; margin: 0 0 4px 0;">${wim.corridor}</p>
            <p style="font-size: 10.5px; color: #475569; margin: 0 0 8px 0; font-family: monospace;">
              📍 GPS: <strong style="color: #1C1C1A;">${wim.coordinates[0].toFixed(4)}, ${wim.coordinates[1].toFixed(4)}</strong> (${wim.province})
            </p>

            <!-- Telemetry -->
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px; font-size: 11px; margin-bottom: 8px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 4px;">
                <span style="color: #64748b;">Truk / ANPR:</span>
                <span style="font-weight: 600; color: #0f172a; font-family: monospace;">${wim.licensePlate} (${wim.speedKmh} km/h)</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: #64748b;">Kelas Kendaraan:</span>
                <span style="font-weight: 700; color: #334155; font-size: 10px;">${wim.vehicleClass}</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: #64748b;">Beban Sumbu Maks:</span>
                <span style="font-weight: 600; color: ${wim.maxAxleLoadTon > 10 ? '#d9655d' : '#57ae78'};">
                  ${wim.maxAxleLoadTon} Ton ${wim.overloadPercent > 0 ? `(+${wim.overloadPercent}%)` : ''}
                </span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #64748b;">Gross Weight:</span>
                <span style="font-weight: 700; color: #1e293b;">${wim.grossWeightTon} Ton (MST ${wim.legalLimitTon} Ton)</span>
              </div>
            </div>

            <!-- PINN Physics Impact -->
            <div style="background-color: #f7f8fa; border: 1px solid #e3e6eb; border-radius: 10px; padding: 8px; font-size: 10.5px; color: #1C1C1A;">
              <div style="font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
                <span>🧠 KORELASI PINN FISIKA PERKERASAN</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                <span>Defleksi Permukaan FWD:</span>
                <strong>${wim.fwdDeflectionMicron} µm</strong>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                <span>Indeks Kerusakan Struktural:</span>
                <strong style="color: #b91c1c;">${wim.pinnDamageImpactIndex} / 100</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>Rekomendasi Tebal Overlay:</span>
                <strong>${wim.overlayRecommendationCm} cm</strong>
              </div>
            </div>
          </div>
        `;

        wimPinMarker.bindPopup(wimPopupContent);
      });
    }

    // Filter community reports based on activeFilter from public interface
    const visibleReports = (communityReports || []).filter((report) => {
      if (activeFilter === 'CRITICAL') return report.severity === 'CRITICAL';
      if (activeFilter === 'MODERATE') return report.severity === 'SEVERE' || report.severity === 'MODERATE';
      if (activeFilter === 'MINOR') return report.severity === 'LIGHT';
      return true; // 'ALL' or 'HEATMAP'
    });

    // OFFICIAL LEAFLET.HEAT PLUGIN IMPLEMENTATION: L.heatLayer(points, options)
    if (densityOn && visibleReports.length > 0) {
      // 1. Prepare data points using [latitude, longitude, intensity]
      // Regular User reports only, under the same severity filter as the markers
      const heatPoints: [number, number, number][] = selectRegularUserDensity(communityReports || [], activeFilter).reports.map((rep) => {
        // Uniform weight: the overlay shows how many reports there are, not how severe they are
        return [rep.coordinates[0], rep.coordinates[1], 0.6];
      });

      // 2. Initialize Leaflet.heat layer and pass data points into L.heatLayer()
      const heatLayerFn = (L as any).heatLayer || (window as any).L?.heatLayer;
      if (typeof heatLayerFn === 'function') {
        const heatLayer = heatLayerFn(heatPoints, {
          radius: 35,
          blur: 22,
          maxZoom: 16,
          max: 1.0,
          minOpacity: 0.35,
          gradient: {
            0.2: '#8296b0',
            0.4: '#57ae78',
            0.6: '#e8b23a',
            0.8: '#e2823d',
            1.0: '#d9655d'
          }
        });
        // 3. Add the heat layer to map/layerGroup
        heatLayer.addTo(layerGroup);
      }

      interface HeatCluster {
        center: [number, number];
        count: number;
        criticalCount: number;
        severeCount: number;
        moderateCount: number;
        lightCount: number;
        totalWeight: number;
        areaName: string;
        reports: DamageReport[];
      }

      const clusters: HeatCluster[] = [];
      const CLUSTER_RADIUS_DEG = 0.038; // ~4.2km cluster radius for organic density grouping

      visibleReports.forEach((rep) => {
        const repWeight =
          rep.severity === 'CRITICAL' ? 4 : rep.severity === 'SEVERE' ? 3 : rep.severity === 'MODERATE' ? 2 : 1;

        let matched = clusters.find((c) => {
          const dist = Math.hypot(c.center[0] - rep.coordinates[0], c.center[1] - rep.coordinates[1]);
          return dist <= CLUSTER_RADIUS_DEG;
        });

        if (matched) {
          matched.reports.push(rep);
          matched.count += 1;
          matched.totalWeight += repWeight;
          if (rep.severity === 'CRITICAL') matched.criticalCount += 1;
          else if (rep.severity === 'SEVERE') matched.severeCount += 1;
          else if (rep.severity === 'MODERATE') matched.moderateCount += 1;
          else matched.lightCount += 1;

          matched.center = [
            (matched.center[0] * (matched.count - 1) + rep.coordinates[0]) / matched.count,
            (matched.center[1] * (matched.count - 1) + rep.coordinates[1]) / matched.count
          ];
        } else {
          clusters.push({
            center: [rep.coordinates[0], rep.coordinates[1]],
            count: 1,
            criticalCount: rep.severity === 'CRITICAL' ? 1 : 0,
            severeCount: rep.severity === 'SEVERE' ? 1 : 0,
            moderateCount: rep.severity === 'MODERATE' ? 1 : 0,
            lightCount: rep.severity === 'LIGHT' ? 1 : 0,
            totalWeight: repWeight,
            areaName: rep.segmentName || rep.corridor || 'Wilayah Laporan',
            reports: [rep]
          });
        }
      });

      // Render interactive hotspot markers and comparison story badges
      clusters.forEach((cluster, clusterIdx) => {
        const representativeReport = cluster.reports[0];
        const previewPhoto = representativeReport.photoUrl;
        const shortTitle = cluster.areaName.split('(')[0].trim();

        // 1. Heatmap Pinpoint Marker (Pin Lokasi + Icon Tingkat Kerusakan dengan Background Bulat Putih)
        const heatmapPinHtml = `
          <div style="position: relative; width: 36px; height: 46px; display: flex; align-items: center; justify-content: center; cursor: pointer; filter: drop-shadow(0 4px 10px rgba(220,38,38,0.55)); transition: transform 0.15s ease;">
            <!-- SVG Map Pin in Crimson Red -->
            <svg viewBox="0 0 384 512" width="34" height="44" fill="#d9655d" xmlns="http://www.w3.org/2000/svg">
              <path d="M172.268 501.67C26.97 291.031 0 269.413 0 192 0 85.961 85.961 0 192 0s192 85.961 192 192c0 77.413-26.97 99.031-172.268 309.67-9.535 13.774-29.93 13.773-39.464 0z"/>
            </svg>
            <!-- Background Bulat Putih Dibelakang Layer Icon -->
            <div style="
              position: absolute;
              top: 5px;
              left: 50%;
              transform: translateX(-50%);
              width: 22px;
              height: 22px;
              border-radius: 50%;
              background-color: #ffffff;
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 1px 4px rgba(0,0,0,0.3);
              z-index: 2;
            ">
              <!-- Icon Tingkat Kerusakan Hotspot -->
              <span style="font-size: 12px; line-height: 1; display: flex; align-items: center; justify-content: center;">
                🔥
              </span>
            </div>
          </div>
        `;

        const heatmapPinIcon = L.divIcon({
          html: heatmapPinHtml,
          className: 'heatmap-cluster-pinpoint',
          iconSize: [36, 46],
          iconAnchor: [18, 44]
        });

        const pinMarker = L.marker(cluster.center, { icon: heatmapPinIcon }).addTo(layerGroup);

        // 2. Floating Story Chip Badge
        const snapchatChipHtml = `
          <div class="snapchat-story-chip" style="
            display: flex;
            align-items: center;
            gap: 8px;
            background: #ffffff;
            border-radius: 9999px;
            padding: 4px 12px 4px 4px;
            box-shadow: 0 12px 28px rgba(0,0,0,0.35), 0 0 16px rgba(239,68,68,0.4);
            border: 2px solid #ffffff;
            cursor: pointer;
            transform: translateY(-50%);
            white-space: nowrap;
          ">
            <img src="${previewPhoto}" alt="${shortTitle}" class="snapchat-story-avatar" style="
              width: 32px;
              height: 32px;
              border-radius: 50%;
              object-fit: cover;
              border: 2px solid #d9655d;
            " />
            <div style="text-align: left; line-height: 1.2;">
              <div style="font-size: 11px; font-weight: 600; color: #0f172a; max-width: 140px; overflow: hidden; text-overflow: ellipsis;">
                ${shortTitle}
              </div>
              <div style="display: flex; align-items: center; gap: 4px;">
                <span style="font-size: 9px; font-weight: 600; color: #d9655d;">🔥 ${cluster.count} ${isEn ? 'REPORTS' : 'LAPORAN'}</span>
                <span style="font-size: 8.5px; color: #64748b;">• HOTSPOT</span>
              </div>
            </div>
          </div>
        `;

        const snapchatIcon = L.divIcon({
          html: snapchatChipHtml,
          className: 'snapchat-heatmap-story-marker',
          iconSize: [180, 42],
          iconAnchor: [90, 21]
        });

        const snapMarker = L.marker(cluster.center, { icon: snapchatIcon }).addTo(layerGroup);

        // 3. Interactive Leaflet Popup for 2-step verification before opening full comparison modal
        const heatmapPopupContainer = document.createElement('div');
        heatmapPopupContainer.style.width = '290px';
        heatmapPopupContainer.style.fontFamily = 'system-ui, -apple-system, sans-serif';
        heatmapPopupContainer.style.padding = '4px';
        heatmapPopupContainer.style.color = '#0f172a';

        heatmapPopupContainer.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
            <span style="background-color: #fef2f2; color: #d9655d; font-weight: 600; font-size: 10.5px; padding: 2.5px 8px; border-radius: 12px; border: 1px solid #fecaca; display: flex; align-items: center; gap: 4px;">
              🔥 ${t.heatmapHotspots}
            </span>
            <span style="font-size: 10px; font-weight: 600; color: #475569; background: #f1f5f9; padding: 2px 7px; border-radius: 8px; border: 1px solid #e2e8f0;">
              ${cluster.count} ${isEn ? 'Reports' : 'Laporan'}
            </span>
          </div>

          <div style="display: flex; gap: 8px; margin-bottom: 8px; align-items: center;">
            <img src="${previewPhoto}" alt="${shortTitle}" style="width: 76px; height: 60px; object-fit: cover; border-radius: 8px; border: 1.5px solid #d9655d; flex-shrink: 0;" />
            <div style="flex: 1; min-width: 0;">
              <h4 style="font-size: 12px; font-weight: 600; color: #0f172a; margin: 0 0 2px 0; line-height: 1.3;">${shortTitle}</h4>
              <p style="font-size: 10px; color: #64748b; margin: 0 0 4px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${cluster.areaName}</p>
              <div style="font-size: 9.5px; font-weight: 600; color: #d9655d; font-family: monospace;">
                ${cluster.criticalCount} ${isEn ? 'Critical Potholes' : 'Lubang Kritis'}
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 4px; margin-bottom: 8px; font-size: 9.5px; font-weight: 700; font-family: monospace; flex-wrap: wrap;">
            ${cluster.criticalCount > 0 ? `<span style="background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 4px; border: 1px solid #fecaca;">🔴 ${cluster.criticalCount} ${isEn ? 'Critical' : 'Kritis'}</span>` : ''}
            ${cluster.severeCount > 0 ? `<span style="background: #ffedd5; color: #9a3412; padding: 2px 6px; border-radius: 4px; border: 1px solid #fed7aa;">🟠 ${cluster.severeCount} ${isEn ? 'Severe' : 'Parah'}</span>` : ''}
            ${cluster.moderateCount > 0 ? `<span style="background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 4px; border: 1px solid #fde68a;">🟡 ${cluster.moderateCount} ${isEn ? 'Moderate' : 'Sedang'}</span>` : ''}
            ${cluster.lightCount > 0 ? `<span style="background: #e0f2fe; color: #075985; padding: 2px 6px; border-radius: 4px; border: 1px solid #bae6fd;">🔵 ${cluster.lightCount} ${isEn ? 'Light' : 'Ringan'}</span>` : ''}
          </div>

          <p style="font-size: 10px; color: #475569; margin: 0 0 8px 0; line-height: 1.35; background: #f8fafc; padding: 5px 8px; border-radius: 6px; border: 1px solid #e2e8f0;">
            ${t.heatmapClickToCompare}
          </p>

          <button id="btn-open-compare-${clusterIdx}" style="
            width: 100%;
            background: #1C1C1A;
            color: #ffffff;
            border: none;
            padding: 8px 12px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 11px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            box-shadow: 0 2px 6px rgba(79, 70, 229, 0.35);
          ">
            <span>🔍 ${t.openDetailedComparison}</span>
          </button>
        `;

        const compareBtn = heatmapPopupContainer.querySelector(`#btn-open-compare-${clusterIdx}`);
        if (compareBtn) {
          compareBtn.addEventListener('click', () => {
            if (onSelectReport) {
              onSelectReport(representativeReport);
            } else {
              setDetailModalReport(representativeReport);
            }
            mapInstanceRef.current?.closePopup();
          });
        }

        pinMarker.bindPopup(heatmapPopupContainer, { maxWidth: 320 });
        snapMarker.bindPopup(heatmapPopupContainer, { maxWidth: 320 });
      });
    }

    // Render Community Damage Report Markers (Pin Point Format Sesuai Gambar: Circular Photo + Severity Border + Pointer + Count Badge + Heat Glow)
    if (showCommunityReports && visibleReports.length > 0 && !densityOn) {
      visibleReports.forEach((report, index) => {
        // Hide newly created pin during initial map zoom flight from Karawang overview
        if (hiddenPinReportId && report.id === hiddenPinReportId) {
          return;
        }

        const isRepaired = report.status === 'REPAIRED';

        const reportColor = isRepaired
          ? '#10b981'
          : report.severity === 'CRITICAL'
          ? '#ef4444'
          : report.severity === 'SEVERE'
          ? '#f97316'
          : report.severity === 'MODERATE'
          ? '#f59e0b'
          : '#10b981';

        const glowColor = isRepaired
          ? 'rgba(16, 185, 129, 0.4)'
          : report.severity === 'CRITICAL'
          ? 'rgba(239, 68, 68, 0.45)'
          : report.severity === 'SEVERE'
          ? 'rgba(249, 115, 22, 0.4)'
          : report.severity === 'MODERATE'
          ? 'rgba(245, 158, 11, 0.42)'
          : 'rgba(16, 185, 129, 0.38)';

        // Count badge representation (matching sample in image: 12, 5, 2)
        const badgeCount =
          report.severity === 'CRITICAL'
            ? 12
            : report.severity === 'SEVERE' || report.severity === 'MODERATE'
            ? 5
            : 2;

        // Check if this pin is sprouting or newly created
        const isSprouting = report.id === sproutingPinReportId;
        const isNewlyCreated = report.id === activeBlinkReportId || isSprouting;

        // Custom Pin Point with photo, border ring, pointer tip, top-right count badge, and soft heatmap aura
        const pinHtml = `
          <div class="${isSprouting ? 'newly-created-pin-sprout' : isNewlyCreated ? 'newly-created-pin-drop' : ''}" style="position: relative; width: 60px; height: 68px; display: flex; align-items: center; justify-content: center; cursor: pointer; transform-origin: bottom center;">
            <!-- Expanding Ping Halo Rings for Newly Created Pin -->
            ${isNewlyCreated ? `
              <div class="newly-created-pin-ring"></div>
              <div class="newly-created-pin-ring-delay"></div>
            ` : ''}

            <!-- Radial Heat Aura Glow behind pin -->
            ${
              isNewlyCreated || report.id === highlightReportId
                ? createActivePinHeatmapSvg('rep-' + report.id, 120)
                : `
            <div style="
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -46%);
              width: 68px;
              height: 68px;
              border-radius: 50%;
              background: radial-gradient(circle, ${glowColor} 0%, rgba(255,255,255,0) 70%);
              pointer-events: none;
              z-index: 1;
            "></div>
            `
            }

            <!-- Main Pin Body with optional blink highlight -->
            <div class="${isNewlyCreated ? 'newly-created-pin-blink' : ''}" style="
              position: relative;
              z-index: 2;
              display: flex;
              flex-direction: column;
              align-items: center;
              filter: drop-shadow(0 6px 12px rgba(0,0,0,0.32));
              transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
            ">
              <!-- Newly Created Top Floating Badge -->
              ${
                isNewlyCreated
                  ? `
                <div style="
                  position: absolute;
                  top: -16px;
                  left: 50%;
                  transform: translateX(-50%);
                  background: #f59e0b;
                  color: #0f172a;
                  font-size: 8px;
                  font-weight: 900;
                  padding: 1px 6px;
                  border-radius: 999px;
                  white-space: nowrap;
                  border: 1.5px solid #ffffff;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                  z-index: 30;
                  letter-spacing: 0.5px;
                ">
                  BARU DIBUAT
                </div>
              `
                  : ''
              }

              <!-- Pin Circular Head with Photo -->
              <div style="
                position: relative;
                width: 44px;
                height: 44px;
                border-radius: 50%;
                background: #ffffff;
                border: 3.5px solid ${isNewlyCreated ? '#f59e0b' : reportColor};
                box-shadow: ${isNewlyCreated ? '0 0 16px rgba(245,158,11,0.9)' : '0 2px 8px rgba(0,0,0,0.22)'};
                display: flex;
                align-items: center;
                justify-content: center;
              ">
                <img
                  src="${report.photoUrl}"
                  alt="${report.damageTypeLabel}"
                  style="
                    width: 100%;
                    height: 100%;
                    border-radius: 50%;
                    object-fit: cover;
                    display: block;
                  "
                />

                <!-- Top Right Number Badge Pill (e.g. 12, 5, 2) -->
                <div style="
                  position: absolute;
                  top: -5px;
                  right: -5px;
                  min-width: 18px;
                  height: 18px;
                  padding: 0 4px;
                  border-radius: 999px;
                  background-color: ${reportColor};
                  color: ${reportColor === '#f59e0b' ? '#0f172a' : '#ffffff'};
                  font-size: 10px;
                  font-weight: 900;
                  font-family: system-ui, -apple-system, sans-serif;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  border: 2px solid #ffffff;
                  box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                  z-index: 10;
                  line-height: 1;
                ">
                  ${badgeCount}
                </div>
              </div>

              <!-- Pin Pointer Tip Triangle -->
              <div style="
                width: 0;
                height: 0;
                border-left: 6.5px solid transparent;
                border-right: 6.5px solid transparent;
                border-top: 8px solid ${isNewlyCreated ? '#f59e0b' : reportColor};
                margin-top: -1.5px;
              "></div>
            </div>
          </div>
        `;

        const reportIcon = L.divIcon({
          html: pinHtml,
          className: `clean-damage-pin-marker ${isSprouting ? 'newly-created-pin-sprout' : ''} ${isNewlyCreated ? 'newly-created-pin-blink' : ''}`,
          iconSize: [60, 68],
          iconAnchor: [30, 58]
        });

        const reportMarker = L.marker(report.coordinates, { icon: reportIcon, bubblingMouseEvents: false }).addTo(layerGroup);

        // Click marker directly selects the report to open the bottom sheet drawer
        reportMarker.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;
          if (mapInstanceRef.current) {
            const map = mapInstanceRef.current;
            if (isMobile) {
              const targetZoom = 16;
              const targetPoint = map.project(report.coordinates, targetZoom);
              const offsetPoint = L.point(targetPoint.x, targetPoint.y + 195);
              const unprojected = map.unproject(offsetPoint, targetZoom);
              moveCamera(map, [unprojected.lat, unprojected.lng], targetZoom, { duration: 0.7 });
            } else {
              const targetZoom = Math.max(map.getZoom(), 15);
              moveCamera(map, report.coordinates, targetZoom, { duration: 0.7 });
            }
          }
          if (onSelectReport) {
            onSelectReport(report);
          } else {
            setDetailModalReport(report);
            // Without a report handler the segment selection is the only feedback
            const seg = roadSegments.find((s) => s.id === report.segmentId);
            if (seg) onSelectSegment(seg);
          }
        });
      });

      // Render User GPS Blue Location Marker on Map (as shown in reference image)
      const userGpsIconHtml = `
        <div style="position: relative; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;">
          <div style="position: absolute; width: 26px; height: 26px; border-radius: 50%; background: rgba(59, 130, 246, 0.3); border: 1px solid rgba(59, 130, 246, 0.5);"></div>
          <div style="width: 13px; height: 13px; border-radius: 50%; background-color: #2563eb; border: 2.5px solid #ffffff; box-shadow: 0 0 8px rgba(37, 99, 235, 0.85); z-index: 2;"></div>
        </div>
      `;
      const userGpsIcon = L.divIcon({
        html: userGpsIconHtml,
        className: 'user-gps-dot-marker',
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });
      L.marker([-6.3120, 107.3050], { icon: userGpsIcon }).addTo(layerGroup);
    }

    // Active pin point is managed in its own dedicated activePinLayerGroup effect below
    // to guarantee complete decoupling from general map layer redraws and viewport pans.

    // Render Active Google Maps-Style Navigation Route & Vehicle Marker
    if (activeNavigationTask && navRouteWaypoints.length > 0) {
      // 1. Route Outer Glow Polyline
      L.polyline(navRouteWaypoints, {
        color: '#1e3a8a',
        weight: 9,
        opacity: 0.7,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(layerGroup);

      // 2. Route Inner Vibrant Cyan/Blue Polyline
      L.polyline(navRouteWaypoints, {
        color: '#38bdf8',
        weight: 5.5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(layerGroup);

      // 3. Start Point Pin Marker (Posko F.E)
      const startPinHtml = `
        <div style="display: flex; flex-direction: column; align-items: center; cursor: pointer; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.5));">
          <div style="background: #10b981; color: white; padding: 3px 8px; border-radius: 9999px; font-size: 10px; font-weight: 800; border: 1.5px solid white; white-space: nowrap; margin-bottom: 2px;">
            🏁 Posko F.E (Start)
          </div>
          <div style="width: 15px; height: 15px; border-radius: 50%; background: #10b981; border: 3px solid white; box-shadow: 0 0 10px #10b981;"></div>
        </div>
      `;
      const startPinIcon = L.divIcon({
        html: startPinHtml,
        className: 'nav-start-pin-marker',
        iconSize: [120, 44],
        iconAnchor: [60, 38]
      });
      L.marker(activeNavigationTask.startCoords, { icon: startPinIcon }).addTo(layerGroup);

      // 4. Destination Point Pin Marker (Titik Kerusakan / Tugas yang Diselesaikan)
      const destPinHtml = `
        <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer; filter: drop-shadow(0 6px 16px rgba(239,68,68,0.75));">
          <!-- Top Destination Header Pill -->
          <div style="
            background: linear-gradient(135deg, #ef4444, #dc2626);
            color: #ffffff;
            padding: 3.5px 10px;
            border-radius: 9999px;
            font-size: 10px;
            font-weight: 900;
            border: 2px solid #ffffff;
            white-space: nowrap;
            margin-bottom: 3px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.35);
            display: flex;
            align-items: center;
            gap: 4px;
          ">
            <span>⚠️ Lokasi Tugas</span>
            <span style="background: rgba(0,0,0,0.35); padding: 1px 5px; border-radius: 6px; font-family: monospace; font-size: 9px;">#${activeNavigationTask.report.id}</span>
          </div>

          <!-- Circular Photo Pin Head -->
          <div style="
            position: relative;
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: #ffffff;
            border: 3.5px solid #ef4444;
            box-shadow: 0 0 18px rgba(239,68,68,0.85), 0 2px 10px rgba(0,0,0,0.35);
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <img
              src="${activeNavigationTask.report.photoUrl}"
              alt="${activeNavigationTask.report.damageType}"
              style="
                width: 100%;
                height: 100%;
                border-radius: 50%;
                object-fit: cover;
                display: block;
              "
            />
            <!-- Top Right Severity Alert Badge -->
            <div style="
              position: absolute;
              top: -5px;
              right: -5px;
              min-width: 18px;
              height: 18px;
              border-radius: 999px;
              background-color: #ef4444;
              color: #ffffff;
              font-size: 10px;
              font-weight: 900;
              display: flex;
              align-items: center;
              justify-content: center;
              border: 2px solid #ffffff;
              box-shadow: 0 2px 5px rgba(0,0,0,0.3);
              z-index: 10;
              line-height: 1;
            ">
              !
            </div>
          </div>

          <!-- Pointer Tip -->
          <div style="
            width: 0;
            height: 0;
            border-left: 6.5px solid transparent;
            border-right: 6.5px solid transparent;
            border-top: 8.5px solid #ef4444;
            margin-top: -2px;
          "></div>
        </div>
      `;
      const destPinIcon = L.divIcon({
        html: destPinHtml,
        className: 'nav-dest-pin-marker',
        iconSize: [140, 68],
        iconAnchor: [70, 62]
      });
      L.marker(activeNavigationTask.report.coordinates, { icon: destPinIcon }).addTo(layerGroup);

      // 5. Current Moving Vehicle Marker along Route
      const currentPos = navRouteWaypoints[navStepProgress] || activeNavigationTask.startCoords;
      const vehicleMarkerHtml = `
        <div style="position: relative; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;">
          <div style="position: absolute; width: 38px; height: 38px; border-radius: 50%; background: rgba(56, 189, 248, 0.35); border: 1.5px solid rgba(56, 189, 248, 0.7); animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <div style="width: 26px; height: 26px; border-radius: 50%; background: #0284c7; border: 3px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(2, 132, 199, 0.9); z-index: 10;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="1">
              <polygon points="12 2 19 21 12 17 5 21 12 2"></polygon>
            </svg>
          </div>
        </div>
      `;
      const vehicleMarkerIcon = L.divIcon({
        html: vehicleMarkerHtml,
        className: 'nav-vehicle-step-marker',
        iconSize: [38, 38],
        iconAnchor: [19, 19]
      });
      L.marker(currentPos, { icon: vehicleMarkerIcon }).addTo(layerGroup);

      // Auto fit bounds on initial load
      if (mapInstanceRef.current && navStepProgress === 0) {
        mapInstanceRef.current.fitBounds(L.latLngBounds(navRouteWaypoints), {
          padding: [90, 90],
          maxZoom: 15
        });
      }
    }
  }, [
    filteredSegments,
    filteredWimStations,
    communityReports,
    selectedSegment,
    showWimOnly,
    showCommunityReports,
    activeFilter,
    activeRole,
    hiddenPinReportId,
    sproutingPinReportId,
    activeBlinkReportId,
    zoom,
    densityOn,
    activeNavigationTask,
    navRouteWaypoints,
    navStepProgress
  ]);

  // Dedicated Active Pin Point Heatmap & Selection Card Lifecycle Effect
  // Completely decoupled from map pan/drag, zoom, and general layer redraws.
  useEffect(() => {
    const pinLayer = activePinLayerGroupRef.current;
    const map = mapInstanceRef.current;
    if (!pinLayer || !map) return;

    const activePoint =
      activeSelection ||
      confirmedPinPoint ||
      (activePinCoordinates
        ? {
            coordinates: activePinCoordinates,
            segment: null,
            segmentName: null
          }
        : null);

    if (!activePoint) {
      pinLayer.clearLayers();
      activePinMarkerRef.current = null;
      removeActiveLocationPopup(map);
      return;
    }

    let marker = activePinMarkerRef.current;
    if (!marker) {
      const activePinHtml = createActivePinMarkerHtml('active-pin-point');
      const activePinIcon = L.divIcon({
        html: activePinHtml,
        className: 'active-location-pin-marker',
        iconSize: [150, 150],
        iconAnchor: [75, 75]
      });
      marker = L.marker(activePoint.coordinates, { icon: activePinIcon, bubblingMouseEvents: false }).addTo(pinLayer);
      activePinMarkerRef.current = marker;
    } else {
      marker.setLatLng(activePoint.coordinates);
    }

    if (activeSelection) {
      removeActiveLocationPopup(map);

      if (isLocationPopupOpen) {
        const popupContainer = document.createElement('div');
        popupContainer.className = 'location-card-content';
        L.DomEvent.disableClickPropagation(popupContainer);
        L.DomEvent.disableScrollPropagation(popupContainer);

        const latStr = activeSelection.coordinates[0].toFixed(6);
        const lngStr = activeSelection.coordinates[1].toFixed(6);

        let roadContentHtml = '';
        if (activeSelection.status === 'RESOLVING') {
          roadContentHtml = `<span class="location-card-road-resolving">⏳ ${t.searchingRoad}</span>`;
        } else if (activeSelection.status === 'RESOLVED' && activeSelection.segment) {
          const distBadge =
            activeSelection.distanceMeters !== null
              ? `<span class="location-card-distance-badge">± ${Math.round(activeSelection.distanceMeters)} m ${isEn ? 'from corridor' : 'dari ruas'}</span>`
              : '';
          roadContentHtml = `
            <span class="location-card-road-name" title="${activeSelection.segment.name}" role="button" tabindex="0">
              ${activeSelection.segment.name}
            </span>
            <span class="location-card-road-id-sub">(${activeSelection.segment.id})</span>
            ${distBadge}
          `;
        } else if (activeSelection.status === 'AMBIGUOUS' && activeSelection.segment) {
          const distBadge =
            activeSelection.distanceMeters !== null
              ? `<span class="location-card-distance-badge">± ${Math.round(activeSelection.distanceMeters)} m ${isEn ? 'from corridor' : 'dari ruas'}</span>`
              : '';
          roadContentHtml = `
            <span class="location-card-road-name" title="${activeSelection.segment.name}" role="button" tabindex="0">
              ${activeSelection.segment.name}
            </span>
            <span class="location-card-road-id-sub">(${activeSelection.segment.id})</span>
            <span class="location-card-ambiguous-badge">⚠️ ${t.roadAmbiguous}</span>
            ${distBadge}
          `;
        } else if (activeSelection.status === 'NO_ROAD_FOUND') {
          roadContentHtml = `<span class="location-card-road-unidentified">⚠️ ${t.roadNotFoundInRange}</span>`;
        } else {
          roadContentHtml = `
            <div class="location-card-road-error-group">
              <span class="location-card-road-error">⚠️ ${activeSelection.errorMessage || t.roadFetchFailed}</span>
              <button id="pop-retry-btn" class="location-card-retry-btn" type="button">
                🔄 ${t.retry}
              </button>
            </div>
          `;
        }

        const isApproveDisabled = activeSelection.status === 'RESOLVING' || !activeSelection.isValid;

        popupContainer.innerHTML = `
          <div class="location-card-header">
            <div class="location-card-title-group">
              <span class="location-card-pin-icon" aria-hidden="true">
                <svg width="20" height="24" viewBox="0 0 24 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M12 1.5C6.75329 1.5 2.5 5.75329 2.5 11C2.5 17.5 12 26.5 12 26.5C12 26.5 21.5 17.5 21.5 11C21.5 5.75329 17.2467 1.5 12 1.5ZM12 14.5C10.067 14.5 8.5 12.933 8.5 11C8.5 9.067 10.067 7.5 12 7.5C13.933 7.5 15.5 9.067 15.5 11C15.5 12.933 13.933 14.5 12 14.5Z" fill="#DC2626"/>
                </svg>
              </span>
              <h3 class="location-card-title">${t.selectedLocation}</h3>
            </div>
            <button id="pop-close-btn" class="location-card-close-btn" aria-label="Close" title="${t.close}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <div class="location-card-divider"></div>

          <div class="location-card-coord-box">
            <span class="location-card-coords">${latStr}, ${lngStr}</span>
          </div>

          <div class="location-card-road-box">
            <span class="location-card-road-label">${isEn ? 'NEAREST ROAD CORRIDOR:' : 'RUAS JALAN TERDEKAT:'}</span>
            ${roadContentHtml}
          </div>

          <div class="location-card-actions">
            <button id="pop-approve-btn" class="location-card-approve-btn" ${isApproveDisabled ? 'disabled' : ''}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>${t.approveLocation}</span>
            </button>
            <button id="pop-cancel-btn" class="location-card-cancel-btn" aria-label="Cancel" title="${t.cancel}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        `;

        const newPopup = L.popup({
          offset: [0, -20],
          closeButton: false,
          className: 'compact-location-approval-popup',
          autoPan: false,
          autoClose: true,
          closeOnClick: false
        })
          .setLatLng(activeSelection.coordinates)
          .setContent(popupContainer);

        newPopup.openOn(map);
        activeLocationPopupRef.current = newPopup;

        const approveBtn = popupContainer.querySelector('#pop-approve-btn') as HTMLButtonElement | null;
        const cancelBtn = popupContainer.querySelector('#pop-cancel-btn') as HTMLButtonElement | null;
        const closeBtn = popupContainer.querySelector('#pop-close-btn') as HTMLButtonElement | null;
        const retryBtn = popupContainer.querySelector('#pop-retry-btn') as HTMLButtonElement | null;
        const roadNameEl = popupContainer.querySelector('.location-card-road-name') as HTMLElement | null;

        if (roadNameEl && activeSelection.segment) {
          roadNameEl.style.cursor = 'pointer';
          roadNameEl.onclick = (evt) => {
            evt.stopPropagation();
            if (activeSelection.segment) {
              onSelectSegmentRef.current(activeSelection.segment);
            }
          };
        }

        if (retryBtn) {
          retryBtn.onclick = (evt) => {
            evt.stopPropagation();
            triggerLocationResolutionRef.current(activeSelection.coordinates);
          };
        }

        let isApproving = false;
        if (approveBtn && !isApproveDisabled) {
          approveBtn.onclick = (evt) => {
            evt.stopPropagation();
            if (isApproving) return;
            isApproving = true;
            approveBtn.disabled = true;

            const confirmedCoords = activeSelection.coordinates;
            const confirmedSegment = activeSelection.segment || roadSegmentsRef.current[0] || null;
            removeActiveLocationPopup(map);
            setIsLocationPopupOpen(false);
            setActiveSelection(null);
            if (confirmedSegment) {
              setConfirmedPinPoint({
                coordinates: confirmedCoords,
                nearestSegment: confirmedSegment
              });
            }
            if (onOpenReportModalWithLocationRef.current) {
              onOpenReportModalWithLocationRef.current(activeSelection.segment, confirmedCoords);
            } else {
              setCustomCoordinates(confirmedCoords);
              if (confirmedSegment) setFormSegmentId(confirmedSegment.id);
              setIsReportFormOpen(true);
            }
          };
        }

        const handleDismiss = (evt: MouseEvent) => {
          evt.stopPropagation();
          activeAbortControllerRef.current?.abort();
          activeRequestIdRef.current = null;
          removeActiveLocationPopup(map);
          setIsLocationPopupOpen(false);
          setActiveSelection(null);
          setConfirmedPinPoint(null);
          onActivePinChangeRef.current?.(null);
        };

        if (cancelBtn) cancelBtn.onclick = handleDismiss;
        if (closeBtn) closeBtn.onclick = handleDismiss;

        marker.off('click');
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          setIsLocationPopupOpen(true);
        });
      }
    } else {
      // Confirmed pin point
      removeActiveLocationPopup(map);
      marker.off('click');
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        triggerLocationResolutionRef.current(activePoint.coordinates);
      });
    }
  }, [activeSelection, confirmedPinPoint, activePinCoordinates, isLocationPopupOpen, language]);

  // Center on selected segment (guarded so it only runs when selectedSegment actually changes)
  const hasBottomInset = bottomInsetPx > 0;
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!selectedSegment || !map) return;
    if (lastCenteredSegmentIdRef.current === selectedSegment.id && !hasBottomInset) return;
    lastCenteredSegmentIdRef.current = selectedSegment.id;

    if (hasBottomInset) {
      if (!viewBeforeSelectionRef.current) {
        viewBeforeSelectionRef.current = { center: map.getCenter(), zoom: map.getZoom() };
      }
      const canonical = getCanonicalRoadGeometry(selectedSegment.id);
      const polyline =
        canonical && canonical.geometry.coordinates.length > 1
          ? toLeafletPolyline(canonical.geometry.coordinates)
          : selectedSegment.polyline;
      const segmentBounds = boundsOf(polyline.length > 1 ? polyline : [selectedSegment.coordinates]);
      if (segmentBounds) {
        safeFitBounds(map, segmentBounds, {
          paddingTopLeft: [36, 130],
          paddingBottomRight: [36, bottomInsetPx + 24],
          maxZoom: 15
        });
      }
      return;
    }

    if (viewBeforeSelectionRef.current) {
      const previous = viewBeforeSelectionRef.current;
      viewBeforeSelectionRef.current = null;
      map.setView(previous.center, previous.zoom);
      return;
    }

    // Never zoom out of the level the user is working at
    moveCamera(map, selectedSegment.coordinates, Math.max(map.getZoom(), 12), { duration: 1.2 });
  }, [selectedSegment, hasBottomInset]);

  // Recenter Map to Karawang with wide view of Karawang Regency
  useEffect(() => {
    if (recenterKey > 0 && mapInstanceRef.current) {
      moveCamera(mapInstanceRef.current, [-6.3050, 107.3180], 12, {
        duration: 1.2
      });
    }
  }, [recenterKey]);

  // Device position: drawn only when the Geolocation API returned one
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    userLayerRef.current?.remove();
    userLayerRef.current = null;
    if (!userLocation) return;

    const group = L.layerGroup().addTo(map);
    L.circle(userLocation.coordinates, {
      radius: userLocation.accuracyM,
      color: '#1C1C1A',
      weight: 1,
      fillColor: '#8296b0',
      fillOpacity: 0.12,
      interactive: false
    }).addTo(group);
    L.circleMarker(userLocation.coordinates, {
      radius: 7,
      color: '#ffffff',
      weight: 2.5,
      fillColor: '#1C1C1A',
      fillOpacity: 1,
      interactive: false
    }).addTo(group);
    userLayerRef.current = group;
    moveCamera(map, userLocation.coordinates, Math.max(map.getZoom(), 15), { duration: 1.2 });
  }, [userLocation]);

  // Check if current logged-in role is a regular user account (Public Reporter / Viewer)
  const isRegularUser = activeRole === 'PUBLIC_REPORTER' || activeRole === 'PUBLIC_VIEWER';
  // Staff map cards (filters, selected segment, network stats): full map only, never on a compact
  // tile, and not where the page brings its own overlays (staffCards=false).
  const showStaffCards = staffCards && !isRegularUser && !compact && !activeNavigationTask;

  return (
    <div className="relative w-full h-full min-h-0 bg-slate-950 overflow-hidden flex flex-col">
      {/* Main Leaflet Canvas Container (Full Bleed Background) */}
      <div className="absolute inset-0 w-full h-full z-0">
        <div ref={mapContainerRef} className="w-full h-full" />
      </div>


      {/* Basemap status: shown only when the selected tile provider could not be used */}
      {tileStage !== 'primary' && (
        <div
          role="status"
          data-testid="basemap-status"
          className="absolute top-28 left-1/2 -translate-x-1/2 z-20 w-max max-w-[calc(100%-1.5rem)] flex items-center gap-2 bg-slate-900/95 border border-amber-400/50 text-white text-xs font-bold px-3 py-2 rounded-2xl shadow-xl"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            {tileStage === 'fallback'
              ? language === 'en'
                ? 'Backup basemap in use.'
                : 'Memakai peta dasar cadangan.'
              : language === 'en'
              ? 'Basemap unavailable. Map data is still shown.'
              : 'Peta dasar tidak tersedia. Data tetap ditampilkan.'}
          </span>
          <button
            type="button"
            onClick={resetBasemap}
            className="shrink-0 whitespace-nowrap underline text-amber-300 cursor-pointer"
          >
            {language === 'en' ? 'Retry' : 'Coba lagi'}
          </button>
        </div>
      )}

      {/* Top Floating Control Bar (Filters & Search) - ONLY for Official Roles when NOT navigating */}
      {showStaffCards && (
        <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-start gap-2 pointer-events-none">
          {/* Search & filters: wrap onto a second row when the map is narrow */}
          <div className="min-w-0 flex flex-wrap items-center gap-2 pointer-events-auto bg-slate-900 border border-slate-700 p-2 rounded-lg shadow-md max-w-full">
            {/* Search Box */}
            <div className="relative shrink-0">
              <Search className="w-4 h-4 absolute left-2.5 top-2 text-slate-400" />
              <input
                type="text"
                placeholder="Cari ruas jalan..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-950/80 border border-slate-800 text-slate-100 text-xs rounded-lg pl-8 pr-3 py-1 w-28 sm:w-40 focus:outline-none focus:border-slate-600 transition-all placeholder:text-slate-500 font-medium"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowMapFilters(!showMapFilters)}
              aria-expanded={showMapFilters}
              className="sm:hidden h-8 px-3 rounded-lg border border-slate-700 text-xs font-medium text-slate-200 inline-flex items-center gap-2 cursor-pointer"
            >
              <Filter className="w-4 h-4" />
              Filter
            </button>
            <div className={`${showMapFilters ? 'flex' : 'hidden'} sm:flex flex-wrap items-center gap-2 w-full sm:w-auto`}>
            {/* Province Filter */}
            <div className="flex items-center space-x-1 shrink-0">
              <Filter className="w-3 h-3 text-slate-400 ml-1 shrink-0" />
              <select
                value={provinceFilter}
                onChange={(e) => setProvinceFilter(e.target.value)}
                className="bg-slate-950/80 border border-slate-800 text-slate-200 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-slate-600 font-medium cursor-pointer"
              >
                <option value="ALL">Semua Provinsi</option>
                <option value="DKI Jakarta">DKI Jakarta</option>
                <option value="Banten">Banten (Bintaro)</option>
                <option value="Jawa Barat">Jawa Barat</option>
                <option value="Sumatera Selatan">Sumatera Selatan</option>
                <option value="Kalimantan Tengah">Kalimantan Tengah</option>
                <option value="Papua Pegunungan">Papua Pegunungan</option>
                <option value="Bali">Bali</option>
              </select>
            </div>

            {/* Condition Category Filter */}
            <select
              value={conditionFilter}
              onChange={(e) => setConditionFilter(e.target.value)}
              className="bg-slate-950/80 border border-slate-800 text-slate-200 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-slate-600 shrink-0 font-medium cursor-pointer"
            >
              <option value="ALL">Semua Kondisi PCI</option>
              <option value="GOOD">Kondisi Mantap (PCI &gt; 70)</option>
              <option value="MODERATE">Sedang (PCI 50 - 70)</option>
              <option value="LIGHT_DAMAGE">Rusak Ringan (PCI 35 - 50)</option>
              <option value="HEAVY_DAMAGE">Rusak Berat (PCI &lt; 35)</option>
            </select>

            {/* WIM Only Toggle */}
            <button
              onClick={() => setShowWimOnly(!showWimOnly)}
              className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1 transition-all border ${
                showWimOnly
                  ? 'bg-slate-800 text-white border-slate-700 shadow-sm'
                  : 'bg-slate-950/80 text-slate-300 border-slate-800 hover:bg-slate-800/60'
              }`}
            >
              <Truck className="w-3 h-3 text-cyan-400 shrink-0" />
              <span>Ada Stasiun WIM</span>
              {showWimOnly && (
                <span className="ml-1 px-2 py-0.2 text-xs bg-slate-700 text-white rounded-md font-mono font-bold">
                  {filteredWimStations.length} Pin
                </span>
              )}
            </button>

            {/* Community Reports Pin Toggle */}
            <button
              onClick={() => setShowCommunityReports(!showCommunityReports)}
              className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1 transition-all border ${
                showCommunityReports
                  ? 'bg-slate-800 text-white border-slate-700 shadow-sm'
                  : 'bg-slate-950/80 text-slate-300 border-slate-800 hover:bg-slate-800/60'
              }`}
            >
              <Camera className="w-3 h-3 text-rose-400 shrink-0" />
              <span>Laporan Warga</span>
              {showCommunityReports && (
                <span className="ml-1 px-2 py-0.2 text-xs bg-slate-700 text-white rounded-md font-mono font-bold">
                  {communityReports.length} Pin
                </span>
              )}
            </button>

            {/* Dropdown WIM Overload Category Filter */}
            {showWimOnly && (
              <select
                value={wimStatusFilter}
                onChange={(e) => setWimStatusFilter(e.target.value)}
                className="bg-slate-950/90 border border-slate-750 text-slate-200 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-slate-600 font-semibold shadow-md shrink-0 cursor-pointer"
              >
                <option value="ALL">Semua Stasiun WIM (100%)</option>
                <option value="EXTREME">Overload Ekstrim (&gt;100%)</option>
                <option value="HEAVY">Overload Berat (50 - 100%)</option>
                <option value="MODERATE">Overload Sedang (20 - 50%)</option>
                <option value="LIGHT">Overload Ringan (5 - 20%)</option>
                <option value="NONE">Tidak Overload (Normal)</option>
              </select>
            )}
            </div>
          </div>

          {/* Floating Quick Action CTA - ONLY for Official Roles */}
          {selectedSegment && (
            <div className="ml-auto min-w-0 pointer-events-auto bg-slate-900 border border-slate-700 p-2 pl-3 rounded-lg shadow-md flex items-center gap-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-400">Ruas terpilih</p>
                <p className="text-sm font-medium text-white max-w-[200px] truncate" title={selectedSegment.name}>
                  {selectedSegment.name}
                </p>
              </div>
              <button
                onClick={() => onLaunchSimulation(selectedSegment)}
                className="shrink-0 h-9 px-3 rounded-lg bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-slate-950 text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <span className="whitespace-nowrap">Jalankan PINN</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Absolute Bottom Stats & Legend Overlay - ONLY for Official Roles when NOT navigating */}
      {showStaffCards && (
        <MapAnalyticsPanel
          roadSegments={roadSegments}
          language={language}
        />
      )}

      {/* Absolute Bottom Copyright Text Outside Cards - ONLY for Official Roles when NOT navigating */}
      {showStaffCards && (
        <div className="absolute bottom-1 sm:bottom-1.5 left-0 right-0 z-20 text-center pointer-events-none pb-1 px-2">
          <p className="text-xs sm:text-xs font-medium text-slate-400 font-sans tracking-wide drop-shadow truncate">
            PAVEMENT-PINN © 2026 | Intel AI Global Impact Festival 2026
          </p>
        </div>
      )}

      {/* REPORT FORM MODAL INSIDE LEAFLETMAP */}
      {isReportFormOpen && (
        <div className="fixed inset-0 z-[1300] bg-slate-950/85 flex items-center justify-center p-4 animate-in fade-in duration-200 pointer-events-auto">
          <div className="bg-slate-900/95 border border-white/20 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 text-slate-100 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-indigo-500/20 text-cyan-300 rounded-2xl border border-indigo-500/30">
                  <Camera className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">
                    Formulir Pelaporan Kerusakan Jalan Komunitas
                  </h3>
                  <p className="text-xs text-slate-300">
                    Otomatis terhubung dengan stasiun WIM & simulasi regangan asphalt PINN
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsReportFormOpen(false)}
                className="p-2 rounded-2xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-4 text-xs">
              {/* Selected GPS Coordinates Badge (Autofilled when clicking map) */}
              <div className="bg-indigo-950/70 border border-cyan-500/40 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center space-x-2 text-cyan-300 font-mono font-bold">
                  <MapPin className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>📍 Koordinat Titik Peta:</span>
                  <span className="text-white bg-slate-950 px-3 py-1 rounded-lg border border-cyan-500/30">
                    {customCoordinates
                      ? `${customCoordinates[0]}, ${customCoordinates[1]}`
                      : `${activeFormSegment.coordinates[0]}, ${activeFormSegment.coordinates[1]}`}
                  </span>
                </div>
                <span className="text-xs text-emerald-400 font-mono font-bold bg-emerald-500/20 px-2 py-1 rounded-full border border-emerald-500/30 shrink-0">
                  ✓ Terisi Otomatis
                </span>
              </div>

              {/* Form Select Segment */}
              <div className="space-y-1">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <label className="block text-xs font-bold text-slate-300">
                    1. Lokasi Ruas Jalan
                  </label>
                  {customCoordinates && (
                    <span className="text-xs text-cyan-300 font-mono font-bold bg-cyan-950/80 px-2 py-1 rounded-lg border border-cyan-500/40">
                      📍 Terdeteksi Otomatis di Sekitar Pin Point
                    </span>
                  )}
                </div>
                <select
                  value={formSegmentId}
                  onChange={(e) => setFormSegmentId(e.target.value)}
                  className="w-full bg-slate-950/80 border border-white/15 focus:border-cyan-400 text-white rounded-xl px-3 py-2 focus:outline-none font-semibold text-xs"
                >
                  {roadSegments.map((seg) => (
                    <option key={seg.id} value={seg.id}>
                      {seg.name} ({seg.province}) {seg.id === formSegmentId && customCoordinates ? '📍 [Ruas Terdekat Pin Point]' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 italic">
                  *Nama ruas jalan dipilih secara presisi berdasarkan analisis radius wilayah geografis di sekitar lokasi pin point peta.
                </p>
              </div>

              {/* Damage Type & Severity */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-300">
                    2. Jenis Kerusakan Jalan
                  </label>
                  <select
                    value={formDamageType}
                    onChange={(e) => setFormDamageType(e.target.value as DamageType)}
                    className="w-full bg-slate-950/80 border border-white/15 text-white rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400 font-semibold"
                  >
                    <option value="POTHOLE">Lubang Dalam (Pothole)</option>
                    <option value="RUTTING">Ambles & Deformasi Alur (Rutting)</option>
                    <option value="ALLIGATOR_CRACK">Retak Buaya (Alligator Cracking)</option>
                    <option value="CORRUGATION">Kerusakan Gelombang (Corrugation)</option>
                    <option value="SUBSIDENCE">Penurunan Pondasi (Subsidence)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-300">
                    3. Tingkat Keparahan
                  </label>
                  <select
                    value={formSeverity}
                    onChange={(e) => setFormSeverity(e.target.value as ReportSeverity)}
                    className="w-full bg-slate-950/80 border border-white/15 text-white rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400 font-semibold"
                  >
                    <option value="MODERATE">🟡 Sedang (Menghambat Laju)</option>
                    <option value="SEVERE">🟠 Parah (Berisiko Kecelakaan)</option>
                    <option value="CRITICAL">🔴 Sangat Kritis (Bahaya Tinggi Truk Overload)</option>
                  </select>
                </div>
              </div>

              {/* Estimated Depth & Area */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-300">
                    4. Estimasi Kedalaman (cm)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={formEstimatedDepth}
                    onChange={(e) => setFormEstimatedDepth(Number(e.target.value))}
                    className="w-full bg-slate-950/80 border border-white/15 text-white rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400 font-mono font-bold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-300">
                    5. Estimasi Luas Kerusakan (m²)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.5"
                    max="100"
                    value={formEstimatedArea}
                    onChange={(e) => setFormEstimatedArea(Number(e.target.value))}
                    className="w-full bg-slate-950/80 border border-white/15 text-white rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400 font-mono font-bold"
                  />
                </div>
              </div>

              {/* Sample Photo Preset Selector */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-300">
                  6. Foto Lampiran Lapangan
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    {
                      url: 'https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&q=80&w=600',
                      label: 'Lubang Pothole'
                    },
                    {
                      url: 'https://images.unsplash.com/photo-1584467735871-8e85353a8413?auto=format&fit=crop&q=80&w=600',
                      label: 'Ambles & Rutting'
                    },
                    {
                      url: 'https://images.unsplash.com/photo-1517649763962-0c623266ddc0?auto=format&fit=crop&q=80&w=600',
                      label: 'Retak Buaya'
                    }
                  ].map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setFormPhotoIndex(idx)}
                      className={`relative rounded-xl overflow-hidden border-2 transition-all h-20 ${
                        formPhotoIndex === idx
                          ? 'border-cyan-400 ring-2 ring-cyan-400/50'
                          : 'border-white/10 opacity-60 hover:opacity-100'
                      }`}
                    >
                      <img src={preset.url} alt={preset.label} className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 inset-x-0 bg-slate-950/80 text-xs text-white py-1 text-center font-bold">
                        {preset.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-300">
                  7. Deskripsi & Detail Kejadian
                </label>
                <textarea
                  rows={3}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Contoh: Lubang cukup dalam di lajur kiri. Sangat membahayakan pengendara motor & sering dilewati truk tronton berat."
                  className="w-full bg-slate-950/80 border border-white/15 text-white rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-400 placeholder:text-slate-500"
                />
              </div>


              {/* Submit Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsReportFormOpen(false)}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-bold transition-all"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center space-x-2 shadow-lg border border-white/20 transition-all"
                >
                  <Send className="w-4 h-4 text-cyan-200" />
                  <span>Kirim Laporan Kerusakan</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GOOGLE MAPS STYLE NAVIGATION HUD OVERLAY */}
      {activeNavigationTask && (
        <>
          {/* 1. TOP TURN-BY-TURN GREEN NAVIGATION BAR (Optimized for mobile format with z-50 layer above right controls, strictly constrained height) */}
          <div className="absolute top-[56px] sm:top-20 md:top-4 left-2.5 right-2.5 sm:left-6 sm:right-auto sm:w-[490px] z-50 max-h-[72px] sm:max-h-none bg-emerald-800 text-white rounded-2xl sm:rounded-3xl py-2 px-2.5 sm:py-3.5 sm:px-4 shadow-2xl border border-emerald-500/80 flex items-center justify-between gap-2 sm:gap-4 animate-in slide-in-from-top-4 duration-300 pointer-events-auto overflow-hidden box-border">
            <div className="flex items-center gap-2 sm:gap-3.5 min-w-0 flex-1">
              {/* Maneuver Icon */}
              <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-emerald-900/90 border border-emerald-500/60 flex items-center justify-center shrink-0 shadow-inner">
                {currentManeuver.action === 'TURN_RIGHT' ? (
                  <CornerUpRight className="w-4 h-4 sm:w-7 sm:h-7 text-emerald-200" />
                ) : currentManeuver.action === 'TURN_LEFT' ? (
                  <CornerUpLeft className="w-4 h-4 sm:w-7 sm:h-7 text-emerald-200" />
                ) : currentManeuver.action === 'ARRIVE' ? (
                  <Flag className="w-4 h-4 sm:w-7 sm:h-7 text-emerald-200" />
                ) : (
                  <ArrowUp className="w-4 h-4 sm:w-7 sm:h-7 text-emerald-200" />
                )}
              </div>

              {/* Maneuver Details & Road Name */}
              <div className="min-w-0 space-y-0 sm:space-y-0.5 flex-1">
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                  <span className="text-base sm:text-2xl font-black tracking-tight text-white font-mono leading-none">
                    {currentManeuver.distanceDisplay}
                  </span>
                  <span className="text-[8.5px] sm:text-[11px] font-bold bg-emerald-900/90 text-emerald-200 px-1.5 sm:px-2.5 py-0.5 rounded-full border border-emerald-600/60 leading-none">
                    {currentManeuver.maneuverTitle}
                  </span>
                  <span className="text-[7.5px] sm:text-[9px] font-medium text-emerald-300/80 bg-emerald-950/60 px-1 py-0.2 sm:px-1.5 sm:py-0.5 rounded-md border border-emerald-700/40 leading-none">
                    {activeManeuverIndex + 1}/{navManeuvers.length}
                  </span>
                </div>
                <p className="text-[10.5px] sm:text-sm font-bold text-emerald-50 truncate leading-tight mt-0.5">
                  ke {currentManeuver.roadName}
                </p>
                <p className="text-[8.5px] sm:text-[11px] text-emerald-200/90 truncate leading-tight hidden xs:block sm:block">
                  {currentManeuver.detailGuidance}
                </p>
              </div>
            </div>

            {/* Maneuver Switcher & Voice Toggle Actions */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              {/* Prev / Next Maneuver buttons to inspect route guidance */}
              <div className="flex items-center bg-emerald-900/80 rounded-xl sm:rounded-2xl border border-emerald-600/50 p-0.5">
                <button
                  type="button"
                  onClick={() => {
                    const nextIdx = Math.max(0, activeManeuverIndex - 1);
                    setManualStepIndex(nextIdx);
                    if (!isNavVoiceMuted && navManeuvers[nextIdx]) {
                      speakNavGuidance(navManeuvers[nextIdx]);
                    }
                  }}
                  disabled={activeManeuverIndex === 0}
                  className="p-1 sm:p-1.5 text-emerald-200 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  title="Langkah Navigasi Sebelumnya"
                >
                  <ChevronLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextIdx = Math.min(navManeuvers.length - 1, activeManeuverIndex + 1);
                    setManualStepIndex(nextIdx);
                    if (!isNavVoiceMuted && navManeuvers[nextIdx]) {
                      speakNavGuidance(navManeuvers[nextIdx]);
                    }
                  }}
                  disabled={activeManeuverIndex >= navManeuvers.length - 1}
                  className="p-1 sm:p-1.5 text-emerald-200 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  title="Langkah Navigasi Berikutnya"
                >
                  <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>
              </div>

              {/* Sound Toggle with Live Voice Trigger on Unmute */}
              <button
                type="button"
                onClick={() => {
                  const nextMuted = !isNavVoiceMuted;
                  setIsNavVoiceMuted(nextMuted);
                  if (nextMuted) {
                    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                      window.speechSynthesis.cancel();
                    }
                  } else {
                    speakNavGuidance(currentManeuver);
                  }
                }}
                className={`p-1.5 sm:p-2.5 rounded-xl sm:rounded-2xl border transition-all cursor-pointer ${
                  !isNavVoiceMuted
                    ? 'bg-emerald-700/90 text-white border-emerald-400/80 shadow-sm'
                    : 'bg-emerald-900/80 text-emerald-300 hover:text-white border-emerald-600/50'
                }`}
                title={isNavVoiceMuted ? 'Nyalakan Suara Panduan (Voice Guidance)' : 'Bisukan Suara Panduan'}
              >
                {isNavVoiceMuted ? <VolumeX className="w-3.5 h-3.5 sm:w-5 sm:h-5" /> : <Volume2 className="w-3.5 h-3.5 sm:w-5 sm:h-5" />}
              </button>
            </div>
          </div>

          {/* 2. FLOATING SPEED & BLUE NAVIGATION CONTROLS (Compact on mobile, sits comfortably below green card) */}
          <div className="absolute top-[134px] sm:top-[190px] md:top-36 left-2.5 sm:left-6 z-40 flex flex-col gap-2 pointer-events-auto">
            {/* Speedometer / KM Card */}
            <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700 text-white px-2.5 py-1 sm:px-3 sm:py-2 rounded-xl sm:rounded-2xl text-center shadow-xl">
              <span className="text-xs sm:text-lg font-black text-emerald-400 font-mono block leading-tight">48</span>
              <span className="text-[7.5px] sm:text-[9px] text-slate-400 font-bold uppercase tracking-wider block">km/jam</span>
            </div>
            {/* Blue Navigation Recenter Button */}
            <button
              type="button"
              onClick={() => {
                if (mapInstanceRef.current && navRouteWaypoints.length > 0) {
                  mapInstanceRef.current.fitBounds(L.latLngBounds(navRouteWaypoints), {
                    padding: [80, 80],
                    maxZoom: 15
                  });
                }
              }}
              className="p-2 sm:p-3 rounded-xl sm:rounded-2xl bg-slate-900/95 hover:bg-slate-800 border border-slate-700/90 text-sky-400 hover:text-sky-300 shadow-xl cursor-pointer active:scale-95 transition-all flex items-center justify-center group"
              title="Pusatkan Rute Navigasi"
            >
              <Navigation className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400 group-hover:rotate-12 transition-transform" />
            </button>
          </div>

          {/* 3. BOTTOM GOOGLE MAPS NAVIGATION CONTROL PANEL (Compact & responsive on mobile) */}
          <div className="absolute bottom-3 left-2.5 right-2.5 sm:bottom-5 sm:left-1/2 sm:-translate-x-1/2 sm:w-[560px] z-40 bg-slate-900/98 backdrop-blur-xl text-white rounded-2xl sm:rounded-3xl p-3 sm:p-5 shadow-2xl border border-slate-700/90 space-y-2.5 sm:space-y-3.5 animate-in slide-in-from-bottom-4 duration-300 pointer-events-auto overflow-hidden" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))', maxHeight: 'calc(100dvh - 12rem)' }}>
            {/* Top ETA Row */}
            <div className="flex items-center justify-between gap-2.5 border-b border-slate-800 pb-2 sm:pb-3">
              <div className="flex items-baseline gap-2 sm:gap-2.5 flex-wrap">
                <span className="text-xl sm:text-3xl font-black text-emerald-400 tracking-tight">
                  {navEstimatedMinutes} mnt
                </span>
                <span className="text-[11px] sm:text-sm font-semibold text-slate-300">
                  {navDistanceKm} km &bull; Lancar
                </span>
                <span className="text-[9px] sm:text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                  Rute Tercepat
                </span>
              </div>

              {/* Close/Cancel Button */}
              {onCancelNavigation && (
                <button
                  type="button"
                  onClick={onCancelNavigation}
                  className="p-1.5 sm:p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-all cursor-pointer"
                  title="Batalkan / Tutup Navigasi"
                >
                  <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>
              )}
            </div>

            {/* Bottom Target & Selesai Action Button */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-0.5">
              <div className="min-w-0 space-y-0.5">
                <p className="text-[11px] sm:text-xs font-bold text-slate-100 truncate">
                  Tujuan: {(activeNavigationTask.report as any).title || activeNavigationTask.report.damageTypeLabel || activeNavigationTask.report.damageType}
                </p>
                <p className="text-[10px] sm:text-[11px] text-slate-400 truncate flex items-center gap-1">
                  <MapPin className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-rose-400 shrink-0" />
                  <span>{activeNavigationTask.report.segmentName}</span>
                  <span className="text-slate-500 font-mono">
                    ({activeNavigationTask.report.coordinates[0].toFixed(4)}, {activeNavigationTask.report.coordinates[1].toFixed(4)})
                  </span>
                </p>
              </div>

              {/* TOMBOL SELESAI DI MAPS */}
              <button
                type="button"
                onClick={onCompleteNavigation}
                className="w-full sm:w-auto px-4 py-2.5 sm:px-5 sm:py-3 rounded-xl sm:rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm shadow-lg shadow-emerald-900/50 flex items-center justify-center gap-1.5 sm:gap-2 transition-all cursor-pointer active:scale-95 shrink-0"
                title="Selesaikan navigasi rute dan kembali ke sidebar Tugas & Inspeksi"
              >
                <CheckCircle2 className="w-4 h-4 text-white" />
                <span>Selesai & Tiba di Lokasi</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Community Report Detail & Before/After Comparison Modal */}
      <ReportDetailModal
        isOpen={!!detailModalReport}
        onClose={() => setDetailModalReport(null)}
        report={resolveLiveReport(detailModalReport, communityReports)}
        language={language}
        onUpvote={onUpvoteReport}
        onFocusMap={(rep) => {
          const seg = roadSegments.find((s) => s.id === rep.segmentId);
          if (seg) {
            onSelectSegment(seg);
          } else if (mapInstanceRef.current) {
            moveCamera(mapInstanceRef.current, rep.coordinates, 10, { duration: 1.2 });
          }
        }}
      />
    </div>
  );
};
