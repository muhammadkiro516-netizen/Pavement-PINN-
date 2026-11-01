/**
 * Citizen tabs: Kawal (own reports and where each one is) and Notifikasi.
 */
import React from 'react';
import { useCameraLauncher } from '../../app/cameraLauncher';
import { useRouter } from '../../app/router';
import { Pill } from '../../components/ui/snap';
import { CitizenNotificationsPage, CitizenReportsPage } from '../../features/roles/CitizenReports';
import { WORKFLOW_STATE_LABEL, stateTone } from '../../features/workflow/workflowLabels';
import type { WorkflowState } from '../../domain/workflow/model';

const TONE_PILL = { neutral: 'grey', review: 'orange', active: 'blue', done: 'green', closed: 'grey' } as const;

export const StatusPill: React.FC<{ state: WorkflowState }> = ({ state }) => (
  <Pill tone={TONE_PILL[stateTone(state)]}>{WORKFLOW_STATE_LABEL[state] ?? state}</Pill>
);

export const MyReportsPage: React.FC = () => {
  const openCamera = useCameraLauncher();
  const { navigate } = useRouter();
  return <CitizenReportsPage onOpen={(code) => navigate(`/pantau/${code}/`)} onReport={openCamera} />;
};

export const NotificationsPage: React.FC = () => {
  const { navigate } = useRouter();
  return <CitizenNotificationsPage onOpen={(code) => navigate(`/pantau/${code}/`)} />;
};
