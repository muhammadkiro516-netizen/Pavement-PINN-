/**
 * The one map every role and page uses (dashboards and the map tab alike).
 *
 * Engine choice is a display mode, never a data change:
 * - MapLibre 3D globe (auto-rotating, flat when zoomed in) — public users and Field Engineer.
 * - Leaflet flat map — Operations Manager / Policy GIS views, tiles without a role, any role
 *   while turn-by-turn navigation runs (route guidance lives in the Leaflet engine), and as
 *   MapLibre's own fallback when WebGL is unavailable.
 * Both read the same reports, segments and coordinates from the caller; neither keeps a
 * copy of report data, so switching engines cannot move a pin.
 *
 * The Field Engineer's floating cards (search and filters, selected segment with "Jalankan PINN",
 * network statistics and legends) live here, above the globe, so they need no flat map. Filters
 * only narrow what the caller passed in; they never re-create the map or move its camera.
 *
 * `compact` is for dashboard tiles: the same engine and data in a smaller box, without
 * the report-creation entry points.
 */
import React, { useMemo, useState } from 'react';
import { Camera, Filter, Search, Truck } from 'lucide-react';
import { LeafletMap, type LeafletMapProps } from './LeafletMap';
import { MapAnalyticsPanel } from './MapAnalyticsPanel';

const MapLibreMap = React.lazy(() => import('./MapLibreMap'));

export interface PavementMapProps extends LeafletMapProps {
  /** The page draws its own header over the map (MapPage): start the staff toolbar below it; hide it on phones. */
  belowHeader?: boolean;
  /** Dashboard tile: no report creation from the map. */
  compact?: boolean;
  isTabActive?: boolean;
  entryAnimationKey?: number;
  /** Page-level engine choice when the role rule does not fit (M.O. Ringkasan tile uses the globe). */
  engine?: 'globe' | 'leaflet';
}

const PROVINCES = ['DKI Jakarta', 'Banten', 'Jawa Barat', 'Sumatera Selatan', 'Kalimantan Tengah', 'Papua Pegunungan', 'Bali'];

export const PavementMap: React.FC<PavementMapProps> = ({ compact = false, engine, belowHeader = false, ...props }) => {
  // A page that passes no role (M.O. POS WIM view, policy/road-health tiles) draws its own
  // overlays; the engine must not add the staff cards on top (Leaflet would assume F.E.).
  const staffCards = Boolean(props.activeRole);
  const mapProps: LeafletMapProps = compact
    ? { ...props, compact: true, staffCards: false, onOpenReportModalWithLocation: undefined, onAddReport: undefined }
    : { ...props, compact: false, staffCards };

  // Engine per role, decided here only (never as a side effect of overlays or selection):
  // - Globe: public users and the Field Engineer map tab.
  // - Leaflet: Operations Manager and Policy pages (corridor/WIM GIS views), tiles that pass no
  //   role, and every role while turn-by-turn navigation runs (the route HUD lives in Leaflet).
  const globeRoles: Array<LeafletMapProps['activeRole']> = ['PUBLIC_REPORTER', 'PUBLIC_VIEWER', 'FIELD_ENGINEER'];
  const useLeaflet =
    Boolean(props.activeNavigationTask) || (engine ? engine === 'leaflet' : !globeRoles.includes(props.activeRole));
  const showEngineerCards = !useLeaflet && !compact && props.activeRole === 'FIELD_ENGINEER';

  const [searchQuery, setSearchQuery] = useState('');
  const [provinceFilter, setProvinceFilter] = useState('ALL');
  const [conditionFilter, setConditionFilter] = useState('ALL');
  const [wimOnly, setWimOnly] = useState(false);
  const [showReports, setShowReports] = useState(true);
  // Small screens: filters fold behind one button so the globe stays visible.
  const [filtersOpen, setFiltersOpen] = useState(false);

  const reports = props.communityReports ?? [];
  const segments = useMemo(() => {
    if (!showEngineerCards) return props.roadSegments;
    const q = searchQuery.trim().toLowerCase();
    return props.roadSegments.filter(
      (seg) =>
        (provinceFilter === 'ALL' || seg.province === provinceFilter) &&
        (conditionFilter === 'ALL' || seg.conditionCategory === conditionFilter) &&
        (!wimOnly || seg.hasWimStation) &&
        (!q || [seg.name, seg.corridor, seg.province].some((v) => v?.toLowerCase().includes(q)))
    );
  }, [showEngineerCards, props.roadSegments, searchQuery, provinceFilter, conditionFilter, wimOnly]);

  const globeProps: LeafletMapProps = showEngineerCards
    ? { ...mapProps, roadSegments: segments, communityReports: showReports ? reports : [] }
    : mapProps;

  const control = 'h-8 rounded-[10px] border border-[#292D33] bg-[#181B20] text-[#F0F1F3] text-xs font-medium';
  const toggle = (on: boolean) =>
    `${control} px-3 inline-flex items-center gap-1.5 cursor-pointer transition-colors ${on ? 'bg-[#1E2228] border-[#3A4048]' : 'text-[#A0A6AF] hover:bg-[#1E2228]'}`;

  return (
    <div className="relative w-full h-full min-h-0 overflow-hidden">
      {useLeaflet ? (
        <LeafletMap {...mapProps} />
      ) : (
        <React.Suspense fallback={<div className="w-full h-full bg-[#0b1220]" aria-busy="true" />}>
          <MapLibreMap {...globeProps} />
        </React.Suspense>
      )}

      {showEngineerCards && (
        <>
          <div className={`absolute z-10 flex-wrap items-start gap-2 pointer-events-none ${belowHeader ? 'top-[136px] left-3 right-3 hidden sm:flex' : 'top-3 left-3 right-16 flex'}`}>
            <div className="pointer-events-auto flex flex-wrap items-center gap-2 bg-[#12151A]/95 border border-[#292D33] p-2 rounded-2xl shadow-md max-w-full">
              <label className={`${control} relative flex items-center`}>
                <Search className="w-3.5 h-3.5 absolute left-2.5 text-[#747C87]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari ruas jalan..."
                  aria-label="Cari ruas jalan"
                  className="bg-transparent outline-none pl-8 pr-3 w-36 sm:w-44 placeholder:text-[#747C87]"
                />
              </label>
              <button type="button" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen} className={`${toggle(filtersOpen)} sm:hidden`}>
                <Filter className="w-3.5 h-3.5" />
                Filter
              </button>
              <div className={`${filtersOpen ? 'flex' : 'hidden'} sm:flex flex-wrap items-center gap-2`}>
              <span className="inline-flex items-center gap-1">
                <Filter className="w-3.5 h-3.5 text-[#747C87]" />
                <select value={provinceFilter} onChange={(e) => setProvinceFilter(e.target.value)} aria-label="Filter provinsi" className={`${control} px-2 cursor-pointer`}>
                  <option value="ALL">Semua Provinsi</option>
                  {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </span>
              <select value={conditionFilter} onChange={(e) => setConditionFilter(e.target.value)} aria-label="Filter kondisi PCI" className={`${control} px-2 cursor-pointer`}>
                <option value="ALL">Semua Kondisi PCI</option>
                <option value="GOOD">Mantap (PCI &gt; 70)</option>
                <option value="MODERATE">Sedang (PCI 50 - 70)</option>
                <option value="LIGHT_DAMAGE">Rusak Ringan (PCI 35 - 50)</option>
                <option value="HEAVY_DAMAGE">Rusak Berat (PCI &lt; 35)</option>
              </select>
              <button type="button" onClick={() => setWimOnly(!wimOnly)} aria-pressed={wimOnly} className={toggle(wimOnly)} title="Hanya ruas dengan stasiun WIM">
                <Truck className="w-3.5 h-3.5 text-cyan-400" />
                Ada Stasiun WIM
                {wimOnly && <span className="font-mono tabular-nums">{segments.length} ruas</span>}
              </button>
              <button type="button" onClick={() => setShowReports(!showReports)} aria-pressed={showReports} className={toggle(showReports)}>
                <Camera className="w-3.5 h-3.5 text-rose-400" />
                Laporan Warga
                {showReports && <span className="font-mono tabular-nums">{reports.length} Pin</span>}
              </button>
              </div>
            </div>

            {props.selectedSegment && props.onLaunchSimulation && (
              <div className="pointer-events-auto ml-auto min-w-0 flex items-center gap-3 bg-[#12151A]/95 border border-[#292D33] p-2 pl-3 rounded-2xl shadow-md">
                <div className="min-w-0">
                  <p className="text-xs text-[#A0A6AF]">Ruas terpilih</p>
                  <p className="text-sm font-medium text-[#F0F1F3] max-w-[220px] truncate" title={props.selectedSegment.name}>
                    {props.selectedSegment.name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => props.onLaunchSimulation?.(props.selectedSegment!)}
                  className="shrink-0 h-9 px-3 rounded-[10px] bg-[#FFD60A] hover:bg-[#FFE14D] text-[#11110F] text-sm font-semibold cursor-pointer"
                >
                  Jalankan PINN
                </button>
              </div>
            )}
          </div>

          <MapAnalyticsPanel roadSegments={segments} language={props.language} />
        </>
      )}
    </div>
  );
};

export default PavementMap;
