import { MapCoach } from '../../features/onboarding/MapCoach';
import { HazardRadar } from '../../features/location/RadarToggle';
import React, { useEffect, useMemo, useState } from 'react';
import { Glyph } from '../../components/ui/brand';
import { Pavi } from '../../components/brand/Pavi';
import { readPaviHelmet } from '../../components/brand/paviPrefs';
import { distanceMeters } from '../../domain/workflow/screening';
import type { ReportCase } from '../../domain/workflow/model';
import type { PublicReportView } from '../../domain/workflow/projections';
import { lastDeviceFix, requestDeviceLocation } from '../../features/location/deviceLocation';
import { PavementMap } from '../../components/maps/PavementMap';
import { MapSheet } from '../../components/maps/MapSheet';
import { caseToHazard, caseToPin, useLiveCases } from '../../features/roles/liveCases';
import { ROAD_OWNER_COLORS, onRoadOwnerTap, onRoadOwnerZoom, setRoadOwnersVisible, type RoadOwnerTap } from '../../components/maps/roadOwnerLayer';
import { CONFIDENCE_WORD, ROAD_STATUS_WORD } from '../../features/road-owner/RoadOwnerCard';
import type { MapSheetState } from '../../components/maps/sheetState';
import { ReportList } from '../../features/road-health/RoadSegmentSheet';
import { ReportDetailBottomSheet } from '../../features/community-reports/ReportDetailBottomSheet';
import { ReportWorkflowPanel } from '../../features/workflow/ReportWorkflowPanel';
import type { ReportReview } from '../../types';
import { useAppState } from '../../app/providers/AppStateProvider';
import { useSession } from '../../app/providers/SessionProvider';
import { useRouter } from '../../app/router';
import type { DamageReport, RoadSegment } from '../../types';

/**
 * Route /peta/ — the Snap-Map-like home: full-screen globe with the real report pins.
 * Tap a pin for its sheet (photo, AI result, status and the actions this role may take),
 * a cluster for its list, a road for its detail page.
 */
type MapFilter = 'ALL' | 'POTHOLE' | 'CRACK' | 'WATER' | 'SIGN' | 'FIXED';
const FILTERS: ReadonlyArray<[MapFilter, string]> = [['ALL', 'Semua'], ['POTHOLE', 'Lubang'], ['CRACK', 'Retak'], ['WATER', 'Genangan'], ['SIGN', 'Ada rambu'], ['FIXED', 'Sudah diperbaiki']];

const NO_SEGMENTS: RoadSegment[] = [];
const OWNER_LEGEND: ReadonlyArray<[string, string]> = [['NASIONAL', 'Nasional'], ['PROVINSI', 'Provinsi'], ['KABUPATEN', 'Kabupaten / kota'], ['TOL', 'Tol']];

function matchesFilter(r: DamageReport, f: MapFilter, c?: { hazard?: unknown | null }): boolean {
  switch (f) {
    case 'POTHOLE': return r.damageType === 'POTHOLE';
    case 'CRACK': return /CRACK/.test(r.damageType);
    case 'WATER': return !!r.cvAssessment?.hazards?.includes('GENANGAN');
    case 'SIGN': return !!c?.hazard;
    case 'FIXED': return r.status === 'REPAIRED' || r.status === 'CLOSED';
    default: return true;
  }
}

/** Story-ring colour: green repaired, orange in progress, red severe and open, yellow otherwise. */
function ringFor(r: DamageReport): string {
  if (r.status === 'REPAIRED' || r.status === 'CLOSED') return '#2BD67B';
  if (r.status === 'SCHEDULED_FOR_REPAIR' || r.status === 'VERIFIED_BY_ENGINEER') return 'linear-gradient(135deg,#FF6B2C,#FFD60A)';
  if (r.severity === 'SEVERE' || r.severity === 'CRITICAL') return '#FF4D5E';
  return '#FFD60A';
}

export const MapPage: React.FC = () => {
  const baseApp = useAppState();
  const { currentAccount, activeRole } = useSession();
  const { navigateTo, navigate } = useRouter();
  // Pins are the real cases; tapping one opens its public page.
  const liveCases = useLiveCases();
  const app = { ...baseApp, communityReports: useMemo(() => liveCases.map(caseToPin), [liveCases]) };
  const [selected, setSelected] = useState<DamageReport | null>(null);
  const [cluster, setCluster] = useState<DamageReport[] | null>(null);
  const [sheetState, setSheetState] = useState<MapSheetState>('HALF');
  const [reviews, setReviews] = useState<Record<string, ReportReview[]>>({});
  const [userLocation, setUserLocation] = useState<{ coordinates: [number, number]; accuracyM: number } | null>(() => lastDeviceFix());
  const [locating, setLocating] = useState(false);
  const [filter, setFilter] = useState<MapFilter>('ALL');
  const [target, setTarget] = useState<{ coords: [number, number]; zoom?: number; timestamp: number } | null>(null);
  // "Pemilik jalan": colours each road by the agency that must fix it.
  const [ownersOn, setOwnersOn] = useState(false);
  const [ownersTooFar, setOwnersTooFar] = useState(false);
  const [tappedRoad, setTappedRoad] = useState<RoadOwnerTap | null>(null);
  useEffect(() => {
    onRoadOwnerTap(setTappedRoad);
    const off = onRoadOwnerZoom(setOwnersTooFar);
    return () => { onRoadOwnerTap(null); off(); setRoadOwnersVisible(false); };
  }, []);
  const toggleOwners = () => {
    const on = !ownersOn;
    setOwnersOn(on);
    setTappedRoad(null);
    setRoadOwnersVisible(on);
    // Road colours need a street-level view; the pilot starts around Jakarta without a GPS fix.
    if (on) setTarget({ coords: userLocation?.coordinates ?? [-6.2, 106.85], zoom: 13.5, timestamp: Date.now() });
  };
  const caseOf = (id: string) => app.workflow.views[id]?.case as (ReportCase & PublicReportView) | undefined;
  const shown = useMemo(() => app.communityReports.filter((r) => matchesFilter(r, filter, caseOf(r.id))), [app.communityReports, filter, app.workflow.views]);
  const signedReportIds = useMemo(() => new Set(liveCases.filter((c) => c.hazard).map((c) => c.publicCode)), [liveCases]);
  const openCount = app.communityReports.filter((r) => r.status !== 'REPAIRED' && r.status !== 'CLOSED').length;
  const nearby = useMemo(() => {
    const here = userLocation?.coordinates;
    return [...app.communityReports]
      .map((r) => ({ r, d: here ? distanceMeters(here, r.coordinates) : null }))
      .sort((a, b) => (a.d ?? 0) - (b.d ?? 0))
      .slice(0, 14);
  }, [app.communityReports, userLocation]);
  const locate = () => {
    setLocating(true);
    void requestDeviceLocation().then((fix) => {
      setLocating(false);
      // A new object every time, so the map flies back even when the position is unchanged.
      if (fix) setUserLocation({ coordinates: fix.coordinates, accuracyM: fix.accuracyM });
    });
  };
  useEffect(locate, []);
  const live = useMemo(() => (selected ? app.communityReports.find((r) => r.id === selected.id) ?? selected : null), [selected, app.communityReports]);

  const openReport = (report: DamageReport) => navigate(`/pantau/${report.id}/`);

  return (
    <div className="absolute inset-0">
      <PavementMap
        engine="globe"
        roadSegments={NO_SEGMENTS}
        selectedSegment={app.selectedSegment}
        onSelectSegment={(segment: RoadSegment) => {
          app.selectSegment(segment);
          navigateTo('roadDetail', { roadId: segment.id });
        }}
        activeRole={activeRole}
        communityReports={shown}
        signedReportIds={signedReportIds}
        onUpvoteReport={app.upvoteCommunityReport}
        currentAccount={currentAccount}
        onSelectReport={openReport}
        onSelectCluster={(reports) => {
          setSelected(null);
          setCluster(reports);
          setSheetState('HALF');
        }}
        compact={false}
        isTabActive
        bottomInsetPx={96}
        userLocation={userLocation}
        baseMapStyle="DARK"
        theme="dark"
        showDensity
        mapCenterTarget={target}
        belowHeader
      />
      {/* Snap-Map-style overlays: avatar, place title, filter chips */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-[#000000]/70 to-transparent px-4 pb-10 pt-[max(14px,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between">
          <button type="button" onClick={() => navigateTo('profile')} aria-label="Profil" className="pointer-events-auto flex h-14 w-14 cursor-pointer items-end justify-center overflow-hidden rounded-full bg-[#1E2229] ring-2 ring-[#FFD60A]/70">
            <Pavi size={40} helmet={readPaviHelmet()} />
          </button>
          <div className="text-right">
            <p className="text-[26px] font-extrabold leading-tight text-[#FFFFFF] drop-shadow">Sekitar Anda</p>
            <p className="text-sm font-semibold text-[#FFFFFF]/80">{openCount} jalan rusak dilaporkan</p>
          </div>
        </div>
        <div className="pointer-events-auto mt-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`shrink-0 cursor-pointer rounded-full px-4 py-2.5 text-sm font-bold backdrop-blur ${filter === key ? 'bg-[#FFFFFF] text-[#000000]' : 'bg-[#15181D]/85 text-[#FFFFFF]'}`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={toggleOwners}
            aria-pressed={ownersOn}
            data-testid="owners-toggle"
            className={`shrink-0 cursor-pointer rounded-full px-4 py-2.5 text-sm font-bold backdrop-blur ${ownersOn ? 'bg-[#FFD60A] text-[#000000]' : 'bg-[#15181D]/85 text-[#FFFFFF]'}`}
          >
            Pemilik jalan
          </button>
        </div>
        {ownersOn && (
          <div className="pp-rise pointer-events-auto mt-1 rounded-2xl bg-[#15181D]/90 p-3 backdrop-blur" data-testid="owners-legend">
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {OWNER_LEGEND.map(([status, label]) => (
                <span key={status} className="flex items-center gap-1.5 text-xs font-bold text-[#FFFFFF]">
                  <i className="inline-block h-1.5 w-5 rounded-full" style={{ background: ROAD_OWNER_COLORS[status] }} />{label}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-[#FFFFFF]/60">{ownersTooFar ? 'Perbesar peta untuk melihat warna jalan.' : 'Garis penuh: pasti. Putus-putus: kemungkinan besar. Titik-titik: petugas memastikan. Ketuk jalan untuk detail.'}</p>
            {tappedRoad && (
              <div className="mt-2 border-t border-white/10 pt-2" data-testid="owners-tapped">
                <p className="truncate text-sm font-extrabold text-[#FFFFFF]">{tappedRoad.name ?? 'Jalan tanpa nama'}</p>
                <p className="text-xs text-[#FFFFFF]/70">{ROAD_STATUS_WORD[tappedRoad.status] ?? tappedRoad.status} · {CONFIDENCE_WORD[tappedRoad.confidence]}</p>
              </div>
            )}
          </div>
        )}
      </div>
      {nearby.length > 0 && !live && !cluster && (
        <div className="absolute inset-x-0 bottom-[104px] z-30">
          <p className="mb-1.5 px-4 text-xs font-extrabold uppercase tracking-wider text-[#FFFFFF]/70 drop-shadow">Sekitar Anda</p>
          <div className="flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {nearby.map(({ r, d }, i) => (
              <button key={r.id} type="button" onClick={() => { setTarget({ coords: r.coordinates, zoom: 17, timestamp: Date.now() }); openReport(r); }}
                style={{ animationDelay: `${120 + i * 70}ms` }}
                className="pp-rise flex w-[68px] shrink-0 cursor-pointer flex-col items-center gap-1 transition-transform hover:-translate-y-0.5 active:scale-95">
                <span className="rounded-full p-[3px]" style={{ background: ringFor(r) }}>
                  <img src={r.photoUrl} alt="" className="h-[58px] w-[58px] rounded-full border-2 border-[#0B0D10] object-cover" loading="lazy" />
                </span>
                <span className="w-full truncate text-center text-[11px] font-bold text-[#FFFFFF] drop-shadow">{d === null ? r.damageTypeLabel : d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {currentAccount.role === 'PUBLIC_REPORTER' && <MapCoach />}
      <div className="absolute bottom-[214px] left-4 z-30">
        <HazardRadar cases={liveCases.map(caseToHazard) as never} />
      </div>
      <button
        type="button"
        onClick={locate}
        aria-label="Ke lokasi saya"
        className="absolute bottom-[214px] right-4 z-30 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-[#15181D] text-[#FFFFFF] shadow-[0_10px_30px_-10px_rgba(14,27,44,0.4)] transition hover:scale-105"
      >
        {locating ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Glyph name="pin" />}
      </button>
      <MapSheet
        isOpen={!!cluster}
        state={sheetState}
        onStateChange={setSheetState}
        onClose={() => setCluster(null)}
        title={`${cluster?.length ?? 0} laporan di lokasi ini`}
        closeLabel="Tutup"
      >
        <ReportList reports={cluster ?? []} onSelectReport={openReport} emptyText="Tidak ada laporan." />
      </MapSheet>
      <ReportDetailBottomSheet
        isOpen={!!live}
        onClose={() => setSelected(null)}
        report={live}
        onUpvoteReport={app.upvoteCommunityReport}
        currentAccount={currentAccount}
        isFieldEngineer={currentAccount.role === 'FIELD_ENGINEER'}
        onEditReport={app.editCommunityReport}
        onStartNavigation={(report) => window.open(`https://www.google.com/maps/dir/?api=1&destination=${report.coordinates[0]},${report.coordinates[1]}`, '_blank', 'noopener')}
        workflowPanel={
          live ? (
            <ReportWorkflowPanel
              compact
              view={app.workflow.views[live.id] ?? null}
              mode={app.workflow.mode}
              engineers={app.workflow.engineers}
              onRun={(command) => app.workflow.runTransition(live.id, command)}
            />
          ) : null
        }
        reviewsMap={reviews}
        onAddReview={(reportId, review) => setReviews((prev) => ({ ...prev, [reportId]: [review, ...(prev[reportId] ?? [])] }))}
      />
    </div>
  );
};
