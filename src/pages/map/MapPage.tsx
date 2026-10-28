import React, { useMemo, useState } from 'react';
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
      />
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
