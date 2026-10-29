/**
 * Revision flow controls. F.E: submit the open draft with a plain-language public summary.
 * M.O: approve or reject (reason required) a pending version. The server's approvalGuard is
 * the authority; its refusal (self-approval, unfinished stages) is shown verbatim.
 */
import React, { useState } from 'react';
import { useWsT } from '../i18n';
import { useWorkspace } from '../WorkspaceContext';
import { Modal } from './dialogs';
import { ActionButton, StatusBadge } from './shared';
import { unfinishedStages } from '../../../domain/workspace/versions';

export const VersionActions: React.FC = () => {
  const t = useWsT();
  const { workspace: w, isFieldEngineer, isOpsManager, run, reportId } = useWorkspace();
  const [dialog, setDialog] = useState<null | 'submit' | { decide: 'approve' | 'reject'; version: number }>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!w) return null;
  const draft = w.versions.find((v) => v.status === 'draft');
  const pending = w.versions.filter((v) => v.status === 'pending_approval');
  const unfinished = unfinishedStages(w.stageRuns);

  const close = () => {
    setDialog(null);
    setText('');
    setError(null);
  };
  const go = async () => {
    if (!dialog) return;
    const r = dialog === 'submit' ? await run((g) => g.submit(reportId, { changeSummaryPublic: text })) : await run((g) => g.decide(reportId, dialog.version, dialog.decide, text || undefined));
    if ('message' in r) setError(r.message);
    else close();
  };

  return (
    <div className="space-y-2" data-testid="version-actions">
      {isFieldEngineer && draft && (
        <ActionButton primary testId="submit-version" onClick={() => setDialog('submit')}>
          {t('submitVersion')} (v{draft.version}, {draft.correctionIds.length} koreksi)
        </ActionButton>
      )}
      {pending.map((v) => (
        <div key={v.version} className="rounded-lg border border-[#273244] p-2 text-[12px]">
          <div className="flex items-center justify-between gap-2">
            <span>v{v.version} · {v.changeSummaryPublic}</span>
            <StatusBadge tone="amber">menunggu persetujuan</StatusBadge>
          </div>
          {isOpsManager && (
            <div className="mt-2 flex flex-wrap gap-2">
              <ActionButton primary testId={`approve-v${v.version}`} onClick={() => setDialog({ decide: 'approve', version: v.version })}>{t('approve')}</ActionButton>
              <ActionButton onClick={() => setDialog({ decide: 'reject', version: v.version })}>{t('reject')}</ActionButton>
            </div>
          )}
          {isOpsManager && unfinished.length > 0 && <p className="mt-1 text-[11px] text-[#F5C451]">Tahap belum selesai: {unfinished.join(', ')}</p>}
        </div>
      ))}
      {dialog && (
        <Modal title={dialog === 'submit' ? t('submitVersion') : dialog.decide === 'approve' ? `${t('approve')} v${dialog.version}` : `${t('reject')} v${dialog.version}`} onClose={close}>
          {(dialog === 'submit' || dialog.decide === 'reject' || true) && (
            <label className="block text-[12px] text-[#9AA8BC]">
              {dialog === 'submit' ? t('publicSummary') : dialog.decide === 'reject' ? `${t('reason')} *` : `${t('reason')} (opsional)`}
              <textarea data-testid="version-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-[#273244] bg-[#0A0F14] p-2 text-[13px] text-white" />
            </label>
          )}
          {error && <p className="mt-2 text-[12px] text-[#F59AA3]" data-testid="version-error">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={close} className="rounded-lg border border-[#273244] px-3 py-1.5 text-[12px]">{t('cancel')}</button>
            <button type="button" data-testid="version-confirm" onClick={go} className="rounded-lg bg-[#FFD60A] px-3 py-1.5 text-[12px] font-semibold text-[#0A0F14]">OK</button>
          </div>
        </Modal>
      )}
    </div>
  );
};
