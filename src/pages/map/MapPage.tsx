import React, { useEffect, useMemo, useState } from 'react';
import { Glyph } from '../../components/ui/brand';
import { lastDeviceFix, requestDeviceLocation } from '../../features/location/deviceLocation';
import { PavementMap } from '../../components/maps/PavementMap';
import { MapSheet } from '../../components/maps/MapSheet';
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
export const MapPage: React.FC = () => {
  const app = useAppState();
  const { currentAccount, activeRole } = useSession();
  const { navigateTo } = useRouter();
  const [selected, setSelected] = useState<DamageReport | null>(null);
  const [cluster, setCluster] = useState<DamageReport[] | null>(null);
  const [sheetState, setSheetState] = useState<MapSheetState>('HALF');
  const [reviews, setReviews] = useState<Record<string, ReportReview[]>>({});
  const [userLocation, setUserLocation] = useState<{ coordinates: [number, number]; accuracyM: number } | null>(() => lastDeviceFix());
  const [locating, setLocating] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'CRITICAL' | 'MODERATE' | 'MINOR'>('ALL');
  const openCount = app.communityReports.filter((r) => r.status !== 'REPAIRED' && r.status !== 'CLOSED').length;
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

  const openReport = (report: DamageReport) => {
    setCluster(null);
    setSelected(report);
  };

  return (
    <div className="absolute inset-0">
      <PavementMap
        engine="globe"
        roadSegments={app.roadSegments}
        selectedSegment={app.selectedSegment}
        onSelectSegment={(segment: RoadSegment) => {
          app.selectSegment(segment);
          navigateTo('roadDetail', { roadId: segment.id });
        }}
        activeRole={activeRole}
        communityReports={app.communityReports}
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
        activeFilter={filter}
      />
      {/* Snap-Map-style overlays: avatar, place title, filter chips */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-[#000000]/70 to-transparent px-4 pb-10 pt-[max(14px,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between">
          <button type="button" onClick={() => navigateTo('profile')} className="pointer-events-auto flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-[#FFE14D] text-lg font-extrabold text-[#000000] ring-4 ring-[#000000]/30">
            {currentAccount.name.slice(0, 1).toUpperCase()}
          </button>
          <div className="text-right">
            <p className="text-[26px] font-extrabold leading-tight text-[#FFFFFF] drop-shadow">Sekitar Anda</p>
            <p className="text-sm font-semibold text-[#FFFFFF]/80">{openCount} jalan rusak dilaporkan</p>
          </div>
        </div>
        <div className="pointer-events-auto mt-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {([['ALL', 'Semua'], ['CRITICAL', 'Kritis'], ['MODERATE', 'Sedang'], ['MINOR', 'Ringan']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`shrink-0 cursor-pointer rounded-full px-4 py-2.5 text-sm font-bold backdrop-blur ${filter === key ? 'bg-[#FFFFFF] text-[#000000]' : 'bg-[#1C1C1E]/85 text-[#FFFFFF]'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={locate}
        aria-label="Ke lokasi saya"
        className="absolute bottom-28 right-4 z-30 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-[#1C1C1E] text-[#FFFFFF] shadow-[0_10px_30px_-10px_rgba(14,27,44,0.4)] transition hover:scale-105"
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
