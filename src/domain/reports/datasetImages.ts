/**
 * Dataset reference images for reports that have no citizen photo (the bundled demo
 * reports). Pure and isomorphic: the seed data, the store migration and the UI all use it,
 * so they agree on which image a report gets.
 *
 * Rules: a reference photo illustrates the damage type only — it is never the pinned
 * location, never a citizen photo and never before/after repair evidence. Damage types the
 * dataset has no label for get an explicit "no coverage" image instead of a generic photo.
 */
import registry from '../../data/reference/datasetImageRegistry.json';
import type { DamageReport } from '../../types';

export interface DatasetAsset {
  assetId: string;
  datasetName: string;
  sourceImageId: string;
  storagePath: string;
  damageType: string;
  originalLabel: string;
  sha256: string;
}

export const DATASET_ASSETS: readonly DatasetAsset[] = registry.assets;
export const DATASET_INFO = registry.datasets[0];
export const NO_COVERAGE_PATH = registry.noCoverageImage;

/** App-absolute URL for a public asset under the deployment base path (e.g. /PavementPinn/). */
export function assetUrl(storagePath: string, basePath: string): string {
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return `${base}${storagePath}`;
}

export type ReferencePhoto =
  | { provenance: 'DATASET_REFERENCE'; asset: DatasetAsset }
  | { provenance: 'NO_DATASET_COVERAGE'; asset: null };

/** Crack photos used for damage types the dataset has no label for (owner decision, 2026-10-18). */
const SUBSTITUTE_LABELS: readonly string[] = registry.substituteForUncovered.labels;
const SUBSTITUTE_POOL = DATASET_ASSETS.filter((a) => SUBSTITUTE_LABELS.some((l) => a.originalLabel.startsWith(l)));

/** Assets for a damage type: its own label first; types without one use the crack pool. */
export function poolFor(damageType: string): readonly DatasetAsset[] {
  const own = DATASET_ASSETS.filter((a) => a.damageType === damageType);
  return own.length > 0 ? own : SUBSTITUTE_POOL;
}

/**
 * Assign reference photos to reports, deterministically: reports in id order, each pool
 * hands out its next unused asset (reused in order only when a pool runs out).
 */
export function assignReferencePhotos(reports: Pick<DamageReport, 'id' | 'damageType'>[]): Map<string, ReferencePhoto> {
  const out = new Map<string, ReferencePhoto>();
  const next = new Map<string, number>();
  for (const r of [...reports].sort((a, b) => a.id.localeCompare(b.id))) {
    const pool = poolFor(r.damageType);
    if (pool.length === 0) {
      out.set(r.id, { provenance: 'NO_DATASET_COVERAGE', asset: null });
      continue;
    }
    const key = pool === SUBSTITUTE_POOL ? '__substitute__' : r.damageType;
    const i = next.get(key) ?? 0;
    next.set(key, i + 1);
    out.set(r.id, { provenance: 'DATASET_REFERENCE', asset: pool[i % pool.length] });
  }
  return out;
}

/** The report with its reference photo applied (photo fields only; nothing else changes). */
export function withReferencePhoto(report: DamageReport, ref: ReferencePhoto, basePath: string): DamageReport {
  return ref.provenance === 'DATASET_REFERENCE'
    ? { ...report, photoUrl: assetUrl(ref.asset.storagePath, basePath), photoProvenance: 'DATASET_REFERENCE', datasetAssetId: ref.asset.assetId }
    : { ...report, photoUrl: assetUrl(NO_COVERAGE_PATH, basePath), photoProvenance: 'NO_DATASET_COVERAGE', datasetAssetId: undefined };
}

/** Short Indonesian label for where a report's photo comes from. */
export function photoSourceLabel(report: Pick<DamageReport, 'photoProvenance' | 'datasetAssetId'> & Partial<Pick<DamageReport, 'damageType'>>): string {
  if (report.photoProvenance === 'DATASET_REFERENCE') {
    const asset = DATASET_ASSETS.find((a) => a.assetId === report.datasetAssetId);
    const otherType = asset && report.damageType && asset.damageType !== report.damageType ? ', contoh retak: jenisnya berbeda dari laporan ini' : '';
    return `Referensi dataset ${DATASET_INFO.name}${asset ? ` · ${asset.originalLabel}` : ''} · ${DATASET_INFO.license.split(' (')[0]} — bukan foto lokasi ini${otherType}`;
  }
  if (report.photoProvenance === 'NO_DATASET_COVERAGE') return 'Belum ada foto referensi dataset untuk jenis kerusakan ini';
  return 'Foto laporan warga';
}

/** Caption for a report photo: dataset reference, no coverage, citizen photo, or legacy illustration. */
export function reportPhotoCaption(report: Pick<DamageReport, 'photoProvenance' | 'datasetAssetId' | 'photoUrl'> & Partial<Pick<DamageReport, 'damageType'>>, illustrativeLabel: string): string {
  if (report.photoProvenance) return photoSourceLabel(report);
  return report.photoUrl?.startsWith('data:') || report.photoUrl?.includes('/api/v5/evidence/') ? 'Foto laporan warga' : illustrativeLabel;
}

/** Stock photo hosts used by the old demo data; never evidence of anything. */
export const isStockPhoto = (url: string | undefined | null) => !!url && url.startsWith('https://images.unsplash.com/');

/**
 * Drop a stock "after repair" photo. After-repair evidence must come from the field
 * engineer (verified by M.O); no dataset photo may stand in for it, so a demo report
 * simply has none and the UI says so.
 */
export function withoutStockRepairPhoto(report: DamageReport): DamageReport {
  if (!report.repairDetails || !isStockPhoto(report.repairDetails.afterPhotoUrl)) return report;
  const { afterPhotoUrl: _stock, ...repairDetails } = report.repairDetails;
  void _stock;
  return { ...report, repairDetails };
}
