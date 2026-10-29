/**
 * Guided multi-angle field inspection. The field engineer photographs the damage from fixed
 * angles; every photo runs through the CV service and the server copies the model result from
 * its own analysis store (the client only names the analysis id). The aggregate below turns the
 * views into one case summary for the coordinator; field measurements stay with the engineer.
 */
export const INSPECTION_ANGLES = ['OVERVIEW', 'TOP', 'SIDE', 'DETAIL', 'SIGN'] as const;
export type InspectionAngle = (typeof INSPECTION_ANGLES)[number];
export const REQUIRED_ANGLES: readonly InspectionAngle[] = ['OVERVIEW', 'TOP', 'SIDE'];

export const ANGLE_GUIDE: Record<InspectionAngle, { title: string; how: string; why: string }> = {
  OVERVIEW: { title: 'Foto jauh', how: 'Mundur 5–10 m, seluruh lebar jalan dan kerusakan terlihat.', why: 'Posisi di lajur, panjang ruas rusak, lalu lintas sekitar.' },
  TOP: { title: 'Foto atas + skala', how: 'Tegak lurus dari atas, letakkan meteran / kertas A4 / sepatu di samping kerusakan.', why: 'Bentuk dan luas kerusakan dengan pembanding ukuran.' },
  SIDE: { title: 'Foto samping 45°', how: 'Rendahkan kamera, miring ±45°, meteran berdiri di titik terdalam.', why: 'Kedalaman lubang / ambles dan tepi yang terkelupas.' },
  DETAIL: { title: 'Foto detail', how: 'Dekat (30–50 cm) ke retak, tepi lubang, atau genangan.', why: 'Pola retak (buaya / memanjang) dan kondisi lapisan.' },
  SIGN: { title: 'Rambu / pengaman', how: 'Rambu atau kerucut yang terpasang, jika ada.', why: 'Bukti lokasi sudah diamankan untuk pengguna jalan.' }
};

export interface InspectionViewAi {
  analysisId: string;
  status: string;
  primaryLabel: string | null;
  primaryType: string | null;
  confidence: number | null;
  detections: number;
  severity: string;
  surfaceIndex: number | null;
  flooded: boolean;
}

export interface InspectionView {
  angle: InspectionAngle;
  photoUrl: string;
  takenAt: string;
  /** Filled by the server from its CV store; null when the photo was not analysed. */
  ai: InspectionViewAi | null;
}

export interface FieldDimensions {
  lengthCm: number | null;
  widthCm: number | null;
  depthCm: number | null;
}

const SEV_RANK: Record<string, number> = { unknown: 0, minor: 1, moderate: 2, severe: 3 };
export const CV_TO_FIELD_SEVERITY: Record<string, 'LIGHT' | 'MODERATE' | 'SEVERE' | null> = { minor: 'LIGHT', moderate: 'MODERATE', severe: 'SEVERE', unknown: null };

export interface ViewsSummary {
  angles: InspectionAngle[];
  missing: InspectionAngle[];
  analysed: number;
  detections: number;
  /** Most supported damage type across views (sum of confidences). */
  consensusType: string | null;
  consensusLabel: string | null;
  /** Views that agree with the consensus type, out of views with a type. */
  agreement: { agree: number; of: number };
  maxSeverity: string;
  suggestedSeverity: 'LIGHT' | 'MODERATE' | 'SEVERE' | null;
  flooded: boolean;
  maxSurfaceIndex: number | null;
}

export function summarizeViews(views: InspectionView[]): ViewsSummary {
  const angles = views.map((v) => v.angle);
  const ai = views.map((v) => v.ai).filter((a): a is InspectionViewAi => !!a);
  const votes = new Map<string, { w: number; label: string; n: number }>();
  for (const a of ai) {
    if (!a.primaryType) continue;
    const cur = votes.get(a.primaryType) ?? { w: 0, label: a.primaryLabel ?? a.primaryType, n: 0 };
    cur.w += a.confidence ?? 0.1;
    cur.n += 1;
    votes.set(a.primaryType, cur);
  }
  const top = [...votes.entries()].sort((x, y) => y[1].w - x[1].w)[0];
  const maxSeverity = ai.reduce((m, a) => ((SEV_RANK[a.severity] ?? 0) > (SEV_RANK[m] ?? 0) ? a.severity : m), 'unknown');
  const idx = ai.map((a) => a.surfaceIndex).filter((x): x is number => typeof x === 'number');
  return {
    angles,
    missing: REQUIRED_ANGLES.filter((a) => !angles.includes(a)),
    analysed: ai.length,
    detections: ai.reduce((s, a) => s + a.detections, 0),
    consensusType: top?.[0] ?? null,
    consensusLabel: top?.[1].label ?? null,
    agreement: { agree: top?.[1].n ?? 0, of: ai.filter((a) => a.primaryType).length },
    maxSeverity,
    suggestedSeverity: CV_TO_FIELD_SEVERITY[maxSeverity] ?? null,
    flooded: ai.some((a) => a.flooded),
    maxSurfaceIndex: idx.length ? Math.max(...idx) : null
  };
}

/** Area (m²) from tape-measured length x width; null when either is missing. */
export function areaFromDimensions(d: FieldDimensions): number | null {
  if (!d.lengthCm || !d.widthCm || d.lengthCm <= 0 || d.widthCm <= 0) return null;
  return Math.round((d.lengthCm * d.widthCm) / 1000) / 10;
}

/** Repair volume (m³) for patching; null without depth. */
export function volumeFromDimensions(d: FieldDimensions): number | null {
  const a = areaFromDimensions(d);
  if (a === null || !d.depthCm || d.depthCm <= 0) return null;
  return Math.round(a * (d.depthCm / 100) * 1000) / 1000;
}
