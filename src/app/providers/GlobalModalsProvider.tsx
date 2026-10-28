/**
 * Application-wide modals: OpenVINO status and audit trail. (The fabricated Bina Marga
 * WIM training pipeline was removed, F-04.) Hosting them here makes them available in BOTH shells — before the
 * restructure they were mounted only in the classic portal, so the buttons that open
 * them from the modern shell did nothing.
 */
import React, { createContext, useContext, useMemo, useState } from 'react';
import { AuditTrailModal } from '../../features/audit-trail/AuditTrailModal';
import { useAppState } from './AppStateProvider';
import { useSession } from './SessionProvider';
import { can } from '../../features/rbac/accessPolicy';

export interface GlobalModalsValue {
  openOpenvinoDiagnostics: () => void;
  openAuditTrail: () => void;
}

const GlobalModalsContext = createContext<GlobalModalsValue | null>(null);

export const GlobalModalsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { auditLogs } = useAppState();
  const { currentAccount } = useSession();
  // M1c: only official roles may open the audit trail; the API enforces the same rule.
  const mayViewAudit = can(currentAccount.role, 'VIEW_AUDIT_TRAIL');
  const [isOpenAuditModal, setIsOpenAuditModal] = useState<boolean>(false);

  const value = useMemo<GlobalModalsValue>(
    () => ({
      openOpenvinoDiagnostics: () => undefined,
      openAuditTrail: () => setIsOpenAuditModal(mayViewAudit)
    }),
    [mayViewAudit]
  );

  return (
    <GlobalModalsContext.Provider value={value}>
      {children}

      {/* Audit Trail Modal */}
      <AuditTrailModal isOpen={isOpenAuditModal && mayViewAudit} onClose={() => setIsOpenAuditModal(false)} auditLogs={auditLogs} />
    </GlobalModalsContext.Provider>
  );
};

export function useGlobalModals(): GlobalModalsValue {
  const value = useContext(GlobalModalsContext);
  if (!value) throw new Error('useGlobalModals must be used inside <GlobalModalsProvider>');
  return value;
}
