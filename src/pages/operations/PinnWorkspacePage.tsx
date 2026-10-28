/** /operations/pinn/:reportId/ — the shared Analysis Workspace inside the Ops shell. */
import React from 'react';
import { useRouter } from '../../app/router';
import { WorkspaceProvider } from '../../features/workspace/WorkspaceContext';
import { AnalysisWorkspace } from '../../features/workspace/AnalysisWorkspace';
import { useWorkspaceDeps } from './useWorkspaceDeps';

export const PinnWorkspacePage: React.FC<{ params: Record<string, string> }> = ({ params }) => {
  const { navigateTo } = useRouter();
  const deps = useWorkspaceDeps();
  return (
    <div className="h-full w-full overflow-hidden">
      <WorkspaceProvider reportId={params.reportId} deps={deps}>
        <AnalysisWorkspace onBack={() => navigateTo('analysis')} />
      </WorkspaceProvider>
    </div>
  );
};
