/** The real public case list, shaped for the map pins, the hazard radar and the safe-route screens. */
import { useEffect, useState } from 'react';
import type { HazardCase } from '../../domain/routing/safeRoute';
import type { DamageReport } from '../../types';
import { apiUrl } from '../../services/api/client';

export interface LiveCase {
  publicCode: string;
  lat: number;
  lon: number;
  state: string;
  repaired: boolean;
  photoId: string | null;
  damageClass: string | null;
  hazard: boolean;
}

const LABEL: Record<string, string> = { POTHOLE: 'Lubang', ALLIGATOR: 'Retak buaya', LONG_CRACK: 'Retak memanjang', TRANS_CRACK: 'Retak melintang', RUTTING_DEPRESSION: 'Amblas', EDGE_BREAK: 'Tepi rusak', RAVELLING: 'Permukaan terkelupas', PATCH_FAILURE: 'Tambalan rusak', SEVERE_BREAKUP: 'Rusak berat' };
const labelOf = (c: LiveCase) => LABEL[c.damageClass ?? ''] ?? 'Kerusakan jalan';
/** Not yet checked by an inspector, so not shown as a confirmed hazard. */
const UNCONFIRMED = new Set(['SUBMITTED', 'SCREENING', 'TRIAGE', 'ACCEPTED', 'INSPECTION_ASSIGNED', 'REFERRED_EXTERNAL']);

export function useLiveCases(): LiveCase[] {
  const [cases, setCases] = useState<LiveCase[]>([]);
  useEffect(() => {
    let live = true;
    fetch(apiUrl('/api/v5/public/cases'))
      .then((r) => r.json())
      // A case closed without a repair (invalid, no action, duplicate) is not road damage to show.
      .then((j) => { if (live && j?.success) setCases(j.data.filter((c: LiveCase) => c.state !== 'CLOSED' || c.repaired)); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  return cases;
}

/** What the map needs from a case. Size stays unset: it is not measured from a photo. */
export const caseToPin = (c: LiveCase): DamageReport => ({
  id: c.publicCode,
  coordinates: [c.lat, c.lon],
  damageType: c.damageClass === 'POTHOLE' ? 'POTHOLE' : c.damageClass ?? 'OTHER',
  damageTypeLabel: labelOf(c),
  status: c.repaired ? 'REPAIRED' : 'REPORTED',
  severity: 'MODERATE',
  photoUrl: c.photoId ? apiUrl(`/api/v5/evidence/${c.photoId}/image`) : '',
  segmentName: c.publicCode
}) as unknown as DamageReport;

export const caseToHazard = (c: LiveCase): HazardCase => ({
  id: c.publicCode,
  // The safe-route rules count inspector-checked open cases and finished repairs only.
  state: c.repaired ? 'CLOSED' : UNCONFIRMED.has(c.state) ? 'SUBMITTED' : 'VERIFIED',
  hazard: c.hazard || undefined,
  report: { coordinates: [c.lat, c.lon], damageType: c.damageClass ?? 'OTHER', damageTypeLabel: labelOf(c) }
}) as HazardCase;
