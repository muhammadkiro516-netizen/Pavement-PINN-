import React from 'react';
import { LegacyCaseBoard } from '../../features/workflow/legacy/LegacyCaseBoard';
import { useSession } from '../../app/providers/SessionProvider';
import { useAppState } from '../../app/providers/AppStateProvider';
import { useRouter } from '../../app/router';
import { reportForDisplay } from '../../domain/workflow/projections';
import type { ReportCase } from '../../domain/workflow/model';

/**
 * Routes: /engineering/tasks/ and /operations/tasks/ — tasks, inspections and work
 * orders. Both read the shared report workflow:
 * - Field Engineer: "Tugas Saya", the cases assigned to this account.
 * - Operations Manager: the operations queue (triage, assignment, decisions, work orders).
 */
export const WorkOrdersPage: React.FC = () => {
  const { currentAccount } = useSession();
  const isFieldEngineer = currentAccount.role === 'FIELD_ENGINEER';
  const { workflow, startNavigation, roadSegments, selectSegment: onSelectSegment } = useAppState();
  const { navigateTo } = useRouter();

  const segmentOf = (segmentId: string) => roadSegments.find((s) => s.id === segmentId);

  const handleStartNavigation = (c: ReportCase) => {
    const report = reportForDisplay(c);
    const segment = segmentOf(c.segmentId);
    if (segment) onSelectSegment(segment);
    startNavigation(report);
    navigateTo('map');
  };

  return (
    <div className="w-full h-full overflow-y-auto custom-scrollbar bg-workspace text-ink">
      <LegacyCaseBoard
        role={isFieldEngineer ? 'FE' : 'OPS'}
        views={Object.values(workflow.views)}
        me={workflow.actor?.id ?? currentAccount.id}
        mode={workflow.mode}
        engineers={workflow.engineers}
        loading={workflow.loading}
        error={workflow.error}
        onRefresh={() => void workflow.refresh()}
        onRun={workflow.runTransition}
        roadSegments={roadSegments}
        account={currentAccount}
        onShowOnMap={(c) => {
          const segment = segmentOf(c.segmentId);
          if (segment) onSelectSegment(segment);
          navigateTo('map');
        }}
        onStartNavigation={handleStartNavigation}
        onOpenAnalysis={(c) => navigateTo('analysisWorkspace', { reportId: c.id })}
      />
    </div>
  );
};
