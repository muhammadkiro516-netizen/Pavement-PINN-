/** The twelve AI features on a case (docs/v6 §3): what it did, the benefit, and a person's decision. */
import { useState } from 'react';
import { v6 } from './api';
import { useV5 } from './context';
import { Card, ErrorNote, TechDetails, useAction, useLoad } from './ui';

interface Finding { feature: number; key: string; title: string; what: string; benefit: string; status: 'REAL' | 'NOT_MEASURED' | 'NO_DATA'; result: string; confidence: number | null; how: string; decision: { decision: string; reason: string } | null }
const STATUS_WORD = { REAL: 'Sudah berjalan', NOT_MEASURED: 'Belum diukur', NO_DATA: 'Belum ada data' };
const DECISION_WORD: Record<string, string> = { ACCEPT: 'Diterima', EDIT: 'Diubah', REJECT: 'Ditolak' };

function FindingCard({ f, caseId, canDecide, onDone }: { f: Finding; caseId: string; canDecide: boolean; onDone: () => void }) {
  const action = useAction();
  const [mode, setMode] = useState<'EDIT' | 'REJECT' | null>(null);
  const [reason, setReason] = useState('');
  const [edited, setEdited] = useState('');
  const send = (decision: 'ACCEPT' | 'EDIT' | 'REJECT') => action.run(async () => {
    await v6(`/cases/${caseId}/ai/decisions`, { key: f.key, decision, reason, edited });
    setMode(null);
    onDone();
  });
  return (
    <div className={`v6-ai v6-ai-${f.status}`} data-testid={`v6-ai-${f.key}`}>
      <div className="v5-row-between"><strong>{f.title}</strong><span className="v6-ai-status" data-testid={`v6-ai-status-${f.key}`}>{STATUS_WORD[f.status]}</span></div>
      <p className="v5-caption">{f.what}</p>
      <p className="v6-ai-result">{f.result}{f.confidence !== null ? ` Keyakinan ${Math.round(f.confidence * 100)}%.` : ''}</p>
      <p className="v5-caption">Manfaat: {f.benefit}</p>
      <details className="v5-tech"><summary>Bagaimana AI tahu?</summary><p>{f.how}</p></details>
      {f.decision && <p className="v6-ok" data-testid={`v6-ai-decided-${f.key}`}>{DECISION_WORD[f.decision.decision]}{f.decision.reason ? `: ${f.decision.reason}` : ''}</p>}
      {canDecide && f.status === 'REAL' && !f.decision && (
        <div className="v6-ai-actions">
          <button type="button" className="v5-link" disabled={action.busy} onClick={() => send('ACCEPT')} data-testid={`v6-ai-accept-${f.key}`}>Terima</button>
          <button type="button" className="v5-link" onClick={() => setMode('EDIT')} data-testid={`v6-ai-edit-${f.key}`}>Ubah</button>
          <button type="button" className="v5-link" onClick={() => setMode('REJECT')} data-testid={`v6-ai-reject-${f.key}`}>Tolak</button>
        </div>
      )}
      {mode && (
        <div className="v5-note">
          {mode === 'EDIT' && <label className="v5-field"><span>Yang benar</span><input value={edited} onChange={(e) => setEdited(e.target.value)} data-testid={`v6-ai-edited-${f.key}`} /></label>}
          <label className="v5-field"><span>Alasan</span><input value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`v6-ai-reason-${f.key}`} /></label>
          <button type="button" className="v5-btn" disabled={action.busy || reason.trim().length < 5} onClick={() => send(mode)} data-testid={`v6-ai-send-${f.key}`}>Simpan keputusan</button>
        </div>
      )}
      <ErrorNote error={action.error} />
    </div>
  );
}

export function CaseAiPanel({ caseId }: { caseId: string }) {
  const { v6Role } = useV5();
  const { data, error, reload } = useLoad(() => v6<Finding[]>(`/cases/${caseId}/ai`), [caseId]);
  const draft = useAction();
  const [text, setText] = useState<{ text: string; source: string; label: string } | null>(null);
  if (v6Role === 'CONTRACTOR') return null;
  const canDecide = v6Role === 'OM' || v6Role === 'FE';
  return (
    <Card title="Bantuan AI. Anda yang memutuskan." testId="v6-case-ai">
      {error && <p>{error.message}</p>}
      {!data && !error && <p>Memuat…</p>}
      {(data ?? []).map((f) => <FindingCard key={f.key} f={f} caseId={caseId} canDecide={canDecide} onDone={reload} />)}
      {canDecide && (
        <>
          <button type="button" className="v5-btn" disabled={draft.busy} onClick={() => draft.run(async () => setText(await v6(`/cases/${caseId}/ai/draft`, {})))} data-testid="v6-ai-draft">{draft.busy ? 'Menulis…' : 'Buat draf'}</button>
          <ErrorNote error={draft.error} />
          {text && (
            <div className="v5-note" data-testid="v6-ai-draft-text">
              <p className="v5-warn">{text.label}</p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{text.text}</p>
              <TechDetails><p>Sumber teks: {text.source === 'SLM' ? 'Qwen2.5 lewat OpenVINO GenAI' : 'templat, model tidak dipakai'}. Angka diisi oleh sistem.</p></TechDetails>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
