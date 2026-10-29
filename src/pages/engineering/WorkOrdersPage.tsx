import React, { useState } from 'react';
import { canonicalStatusOf } from '../../domain/workflow/canonicalStatus';
import type { Tab } from '../../features/workflow/legacy/LegacyCaseBoard';
import { LegacyCaseBoard } from '../../features/workflow/legacy/LegacyCaseBoard';
import { useSession } from '../../app/providers/SessionProvider';
import { useAppState } from '../../app/providers/AppStateProvider';
import { useRouter } from '../../app/router';
import { reportForDisplay } from '../../domain/workflow/projections';
import type { ReportCase } from '../../domain/workflow/model';
import { ControlCenter } from '../../features/workflow/ControlCenter';
import { CaseMap, OPS_STEPS, WorkflowGuide, fieldSteps } from '../../features/workflow/WorkflowGuide';

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

  const [focus, setFocus] = useState<{ tab: Tab; nonce: number }>({ tab: 'ALL', nonce: 0 });
  const pick = (_s: unknown, first: ReportCase | null) => setFocus({ tab: first ? canonicalStatusOf(first) : 'ALL', nonce: Date.now() });
  const staffCases = Object.values(workflow.views).filter((v) => v.audience === 'STAFF').map((v) => v.case as ReportCase);
  const segmentOf = (segmentId: string) => roadSegments.find((s) => s.id === segmentId);

  const handleStartNavigation = (c: ReportCase) => {
    const report = reportForDisplay(c);
    const segment = segmentOf(c.segmentId);
    if (segment) onSelectSegment(segment);
    startNavigation(report);
    navigateTo('map');
  };

  return (
    <div className="w-full h-full overflow-y-auto custom-scrollbar bg-workspace text-ink pb-32">
      {isFieldEngineer ? (
        <WorkflowGuide title="Alur kerja petugas lapangan" steps={fieldSteps(workflow.actor?.id ?? currentAccount.id)} cases={staffCases} onPick={pick} />
      ) : (
        <>
          <WorkflowGuide title="Alur kerja koordinator" steps={OPS_STEPS} cases={staffCases} onPick={pick} />
          <div className="grid gap-0 xl:grid-cols-2">
            <CaseMap steps={OPS_STEPS} cases={staffCases} />
            <ControlCenter cases={staffCases} />
          </div>
        </>
      )}
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
        focus={focus}
      />
    </div>
  );
};
