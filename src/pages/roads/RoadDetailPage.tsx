import React, { useEffect, useState } from 'react';
import { Glyph } from '../../components/ui/brand';
import { Empty, Pill, SnapCard, SnapPage } from '../../components/ui/snap';
import { usePageHost } from '../../app/pageContext';
import { useAppState } from '../../app/providers/AppStateProvider';
import { useSession } from '../../app/providers/SessionProvider';
import type { EngineeringAssessment, RiskLevel } from '../../domain/intelligence/assessment';
import { StructuralAssessmentPanel } from '../../features/road-intelligence/StructuralAssessmentPanel';
import { StatusPill } from '../lean/CitizenPages';

const RISK: Record<RiskLevel, { label: string; tone: 'red' | 'orange' | 'blue' | 'green' }> = {
  HIGH: { label: 'Perlu segera ditangani', tone: 'red' },
  WATCH: { label: 'Perlu diawasi', tone: 'orange' },
  MODERATE: { label: 'Ada laporan kerusakan', tone: 'blue' },
  GOOD: { label: 'Belum ada laporan', tone: 'green' }
};

/**
 * Route /ruas/:roadId/ — one road: its risk from real reports and inspections, the PINN
 * structural assessment (field officers), and the reports on it.
 */
export const RoadDetailPage: React.FC<{ params: Record<string, string> }> = ({ params }) => {
  const { closePage } = usePageHost();
  const { currentAccount } = useSession();
  const { roadSegments, workflow } = useAppState();
  const segment = roadSegments.find((s) => s.id === params.roadId);
  const [assessment, setAssessment] = useState<EngineeringAssessment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!segment) return;
    let cancelled = false;
    workflow.gateway
      .assessment(segment.id)
      .then((r) => !cancelled && setAssessment(r.assessment))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [segment, workflow.gateway, workflow.views]);

  const back = (
    <button type="button" onClick={closePage} className="cursor-pointer rounded-full bg-[#EEF2F7] p-2.5" aria-label="Kembali">
      <span className="block rotate-180"><Glyph name="arrow" size={20} /></span>
    </button>
  );

  if (!segment) {
    return (
      <SnapPage title="Ruas tidak ditemukan" action={back}>
        <Empty icon={<Glyph name="map" size={26} />} title="Ruas tidak dikenal" text={`Tidak ada ruas dengan ID ${params.roadId}.`} />
      </SnapPage>
    );
  }

  const cases = Object.values(workflow.views).filter((v) => v.case.segmentId === segment.id);
  const risk = assessment ? RISK[assessment.risk] : null;

  return (
    <SnapPage title={segment.name} subtitle={`${segment.corridor} · ${segment.province} · ${segment.lengthKm} km`} action={back}>
      <SnapCard>
        <p className="text-xs font-bold text-[#7A8899]">Kondisi menurut laporan & inspeksi</p>
        {risk ? (
          <>
            <div className="mt-2"><Pill tone={risk.tone}>{risk.label}</Pill></div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#2A3647]">
              {assessment!.riskReasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-sm text-[#5B6B7F]">{error ? `Belum dapat dimuat: ${error}` : 'Memuat…'}</p>
        )}
      </SnapCard>

      {assessment && currentAccount.role === 'FIELD_ENGINEER' && (
        <StructuralAssessmentPanel segmentId={segment.id} baseline={assessment.inputs} onRun={(body) => workflow.gateway.engineAssess(body)} />
      )}

      <h2 className="pt-2 text-lg font-extrabold">Laporan di ruas ini</h2>
      {cases.length === 0 ? (
        <SnapCard><p className="text-sm text-[#5B6B7F]">Belum ada laporan.</p></SnapCard>
      ) : (
        cases.map((v) => (
          <SnapCard key={v.case.id}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-extrabold">{v.case.report.damageTypeLabel}</p>
                <p className="text-xs text-[#7A8899]">{v.case.id}</p>
              </div>
              <StatusPill state={v.case.state} />
            </div>
          </SnapCard>
        ))
      )}
    </SnapPage>
  );
};
