/**
 * SPEC M6.3: Kalkulator Kewajaran — what a repair should roughly cost from its own recorded
 * quantities, compared with the stated contract value. Every input carries its label; a
 * difference beyond the threshold is "perlu klarifikasi biaya", never an accusation.
 */
export interface PriceBook {
  items: Array<{ id: string; name: string; unit: string; priceIdr: number; source: string; date: string; label: string }>;
  materialPrice: Record<string, string>;
  assumptions: {
    densityTPerM3: { value: number; label: string; source: string };
    tackCoatKgPerM2: { value: number; label: string; source: string };
    workFactor: { value: number; label: string; source: string };
    flagThresholdPct: { value: number; label: string; source: string };
  };
}

export interface FairnessInput {
  materialId: string;
  thicknessCm: number;
  areaM2: number;
  /** Stated contract / work value (DARI_INPUT); null when not recorded. */
  valueIdr: number | null;
}

export interface FairnessResult {
  status: 'OK' | 'PERLU_KLARIFIKASI' | 'TIDAK_DAPAT_DIHITUNG';
  reason: string | null;
  volumeM3: number;
  tonnage: number;
  fairCostIdr: number | null;
  breakdown: Array<{ item: string; amountIdr: number; label: string; source: string }>;
  diffPct: number | null;
  thresholdPct: number;
}

export function fairCost(input: FairnessInput, book: PriceBook): FairnessResult {
  const a = book.assumptions;
  const volumeM3 = input.areaM2 * (input.thicknessCm / 100);
  const tonnage = volumeM3 * a.densityTPerM3.value;
  const base = { volumeM3: round(volumeM3, 3), tonnage: round(tonnage, 3), thresholdPct: a.flagThresholdPct.value };
  const priceId = book.materialPrice[input.materialId];
  const price = book.items.find((i) => i.id === priceId);
  if (!price || price.unit !== 'ton') {
    return { ...base, status: 'TIDAK_DAPAT_DIHITUNG', reason: `Belum ada harga per ton untuk material ${input.materialId} di buku harga.`, fairCostIdr: null, breakdown: [], diffPct: null };
  }
  const binder = book.items.find((i) => i.id === 'ASPAL-CURAH');
  const mix = tonnage * price.priceIdr;
  const tack = binder ? input.areaM2 * a.tackCoatKgPerM2.value * binder.priceIdr : 0;
  const subtotal = mix + tack;
  const total = subtotal * a.workFactor.value;
  const breakdown = [
    { item: `${price.name}: ${round(tonnage, 2)} t × Rp${price.priceIdr.toLocaleString('id-ID')}`, amountIdr: Math.round(mix), label: price.label, source: `${price.source} (${price.date})` },
    ...(binder ? [{ item: `Lapis perekat: ${input.areaM2} m² × ${a.tackCoatKgPerM2.value} kg/m²`, amountIdr: Math.round(tack), label: a.tackCoatKgPerM2.label, source: a.tackCoatKgPerM2.source }] : []),
    { item: `Faktor pekerjaan × ${a.workFactor.value}`, amountIdr: Math.round(total - subtotal), label: a.workFactor.label, source: a.workFactor.source }
  ];
  if (input.valueIdr === null) {
    return { ...base, status: 'TIDAK_DAPAT_DIHITUNG', reason: 'Nilai pekerjaan tidak dicatat; hanya biaya wajar yang dihitung.', fairCostIdr: Math.round(total), breakdown, diffPct: null };
  }
  const diffPct = round(((input.valueIdr - total) / total) * 100, 1);
  return {
    ...base,
    status: Math.abs(diffPct) > a.flagThresholdPct.value ? 'PERLU_KLARIFIKASI' : 'OK',
    reason: Math.abs(diffPct) > a.flagThresholdPct.value ? `Selisih ${diffPct > 0 ? '+' : ''}${diffPct}% dari perkiraan biaya wajar: perlu klarifikasi biaya.` : null,
    fairCostIdr: Math.round(total),
    breakdown,
    diffPct
  };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
