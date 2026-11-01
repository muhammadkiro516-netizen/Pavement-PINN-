/**
 * Biaya & Material (docs/v6 §4, PROMPT_CLAUDE_CODE_PRICES.md): the price book with its sources, CSV import for
 * the OM, the QA test panel, and the side-by-side options on a case.
 */
import { useMemo, useState } from 'react';
import { v6, type V5ApiError } from './api';
import { useV5 } from './context';
import { Card, ErrorNote, TechDetails, useAction, useLoad } from './ui';
import type { V5Case } from '../../domain/v5/model';

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const STATUS_WORD: Record<string, string> = { OFFICIAL: 'Resmi', SOURCE: 'Bersumber', TODO_VERIFY: 'Perlu dicek', ASSUMED: 'Asumsi', COMPUTED: 'Dihitung', AGENCY: 'Dari instansi' };
const StatusBadge = ({ status }: { status: string }) => <span className={`v6-price-status v6-price-${status}`} data-testid={`v6-status-${status}`}>{STATUS_WORD[status] ?? status}</span>;

interface Row { id: string; regionCode: string; regionName: string; group: string; nameAsWritten: string; unitAsWritten: string; priceAsWritten: string; sourceDoc: string; sourceUrl: string; sourcePage: string; status: string; notes: string }
interface Prices {
  region: string;
  rows: Row[];
  confirmedIds: string[];
  acWcChoice: string | null;
  acWcRows: { id: string; name: string; price: string; page: string }[];
  wages: Record<string, string>[];
  equipment: Record<string, string>[];
  qa: (Record<string, string> & { purpose: string | null })[];
  signals: Record<string, string>[];
  todoRegions: Record<string, string>[];
  imports: { at: string; file: string; rows: number }[];
  notes: string[];
}

const SourceLine = ({ doc, page, url }: { doc: string; page: string; url: string }) => (
  <span className="v5-caption">{doc}{page ? `, hal. ${page}` : ''}{url && url.startsWith('http') ? <> · <a href={url} target="_blank" rel="noopener noreferrer" className="v5-link" data-testid="v6-view-document">Lihat dokumen</a></> : null}</span>
);

function Importer({ onDone }: { onDone: () => void }) {
  const action = useAction();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<{ rows: number; warnings: { line: number; problem: string }[] } | null>(null);
  const [problems, setProblems] = useState<{ line: number; problem: string }[]>([]);
  const send = () => action.run(async () => {
    setProblems([]);
    try {
      setResult(await v6('/prices/import', { csv, fileName }));
      setCsv('');
      onDone();
    } catch (e) {
      setProblems((e as V5ApiError).details ?? []);
      throw e;
    }
  });
  return (
    <Card title="Impor CSV" testId="v6-price-import">
      <p className="v5-muted">Kolom sama dengan buku harga. Wajib ada wilayah, nama barang, satuan, harga, tahun, dan sumber.</p>
      <input type="file" accept=".csv,text/csv" data-testid="v6-import-file" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; setFileName(f.name); void f.text().then(setCsv); }} />
      <button type="button" className="v5-btn v5-btn-primary" disabled={action.busy || !csv} onClick={send} data-testid="v6-import-send">Impor</button>
      <ErrorNote error={action.error} />
      {problems.map((p, i) => <p key={i} className="v5-warn">Baris {p.line}: {p.problem}</p>)}
      {result && <p className="v6-ok" data-testid="v6-import-result">{result.rows} baris masuk ke buku harga.</p>}
      {result?.warnings.map((w, i) => <p key={i} className="v5-warn" data-testid="v6-import-warning">Baris {w.line}: {w.problem}</p>)}
    </Card>
  );
}

export function CostModule() {
  const { v6Role } = useV5();
  const { data, error, reload } = useLoad(() => v6<Prices>('/prices'), []);
  const action = useAction();
  const [region, setRegion] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [reason, setReason] = useState('');
  const regions = useMemo(() => [...new Map((data?.rows ?? []).map((r) => [r.regionCode, r.regionName])).entries()], [data]);
  const shownRegion = region ?? (regions.some(([c]) => c === data?.region) ? data?.region : regions[0]?.[0]);
  const rows = (data?.rows ?? []).filter((r) => r.regionCode === shownRegion && r.nameAsWritten.toLowerCase().includes(q.toLowerCase()));
  const isOm = v6Role === 'OM';
  if (error) return <Card><p>{error.message}</p></Card>;
  if (!data) return <Card><p>Memuat…</p></Card>;
  return (
    <>
      {data.acWcRows.length > 1 && (
        <Card title="Dua harga AC-WC di wilayah Anda" testId="v6-acwc-choice">
          <p>Dokumen menulis dua baris. Cakupannya mungkin berbeda, jadi tidak dirata-rata. {isOm ? 'Pilih yang dipakai.' : 'Operations Manager yang memilih.'}</p>
          {data.acWcRows.map((r) => (
            <div key={r.id} className="v6-row">
              <div><strong>{r.name}</strong><div className="v5-caption">{rp(Number(r.price))}/ton · hal. {r.page}</div></div>
              {data.acWcChoice === r.id ? <span className="v6-ok" data-testid="v6-acwc-chosen">Dipakai</span> : isOm && <button type="button" className="v5-link" disabled={action.busy} onClick={() => action.run(async () => { await v6('/prices/ac-wc-choice', { rowId: r.id }); reload(); })} data-testid={`v6-acwc-pick-${r.id}`}>Pakai ini</button>}
            </div>
          ))}
          <ErrorNote error={action.error} />
        </Card>
      )}
      <Card title="Buku harga" testId="v6-price-book">
        <div className="v5-tabs-inline">{regions.map(([code, name]) => <button key={code} type="button" className={`v5-tab${code === shownRegion ? ' v5-tab-on' : ''}`} onClick={() => setRegion(code)}>{name}</button>)}</div>
        <label className="v5-field"><span>Cari barang</span><input value={q} onChange={(e) => setQ(e.target.value)} data-testid="v6-price-search" /></label>
        {rows.map((r) => (
          <div key={r.id} className="v6-row" data-testid={`v6-price-${r.id}`}>
            <div style={{ minWidth: 0 }}>
              <strong>{r.nameAsWritten}</strong> <StatusBadge status={data.confirmedIds.includes(r.id) ? 'OFFICIAL' : r.status} />
              <div>{rp(Number(r.priceAsWritten))} / {r.unitAsWritten}</div>
              <SourceLine doc={r.sourceDoc} page={r.sourcePage} url={r.sourceUrl} />
              {r.status === 'TODO_VERIFY' && <div className="v5-warn">{r.notes} Tidak dipakai menghitung sampai dipastikan.</div>}
              {r.status === 'TODO_VERIFY' && isOm && !data.confirmedIds.includes(r.id) && (
                <div className="v5-note">
                  <label className="v5-field"><span>Dokumen yang Anda periksa</span><input value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`v6-confirm-reason-${r.id}`} /></label>
                  <button type="button" className="v5-link" disabled={action.busy || reason.trim().length < 10} onClick={() => action.run(async () => { await v6('/prices/confirm', { rowId: r.id, reason }); setReason(''); reload(); })} data-testid={`v6-confirm-${r.id}`}>Pastikan baris ini</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </Card>
      {isOm && <Importer onDone={reload} />}
      <Card title="Uji mutu yang disarankan" testId="v6-qa-panel">
        <p className="v5-muted">Harga acuan dari Sulawesi Tenggara, sebagai contoh. Untuk wilayah lain, nilainya perkiraan.</p>
        {data.qa.map((t) => (
          <div key={t.test_as_written} className="v6-row">
            <div><strong>{t.test_as_written}</strong> <StatusBadge status={t.status} />{t.purpose && <div className="v5-caption">Untuk memeriksa: {t.purpose}</div>}<SourceLine doc={t.source_doc} page={t.source_page_approx} url={t.source_url} /></div>
            <span>{rp(Number(t.price_idr))} / {t.unit}</span>
          </div>
        ))}
      </Card>
      <Card title="Upah dan sewa alat" testId="v6-wages">
        {data.wages.map((w) => <div key={w.role_as_written} className="v6-row"><div><strong>{w.role_as_written}</strong> <StatusBadge status={w.status} /><div className="v5-caption">{w.region_name}, hal. {w.source_page}</div></div><span>{rp(Number(w.wage_idr_per_day))}/hari</span></div>)}
        {data.equipment.map((e) => <div key={e.equipment_as_written} className="v6-row"><div><strong>{e.equipment_as_written}</strong> <StatusBadge status={e.status} /><div className="v5-caption">{e.region_name}, hal. {e.source_page}</div></div><span>{rp(Number(e.rent_idr))}/jam</span></div>)}
      </Card>
      <Card title="Catatan untuk instansi" testId="v6-price-notes">
        {data.notes.map((n) => <p key={n} className="v5-muted">{n}</p>)}
      </Card>
      <Card title="Sinyal harga pasar" testId="v6-signals">
        <p className="v5-muted">Bukan harga resmi, dan tidak dipakai menghitung.</p>
        {data.signals.map((s, i) => <div key={i} className="v6-row"><div><strong>{s.item}</strong><div className="v5-caption">{s.region} · {s.date} · {s.source}</div></div><span>{rp(Number(s.price_idr))}/{s.unit}</span></div>)}
      </Card>
      <Card title="Wilayah yang belum punya data harga" testId="v6-todo-regions">
        {data.todoRegions.map((t) => <div key={t.region_code} className="v6-row"><div><strong>{t.region_name}</strong><div className="v5-caption">Perlu dimuat: {t.document_to_load}. Sumber: {t.where_to_get_it}</div></div></div>)}
      </Card>
    </>
  );
}

interface Range { low: number; mid: number; high: number }
interface Option {
  key: string; label: string; status: string; documentToLoad: string | null;
  quantity: { amount: Range; unit: string; how: string } | null;
  price: { priceIdr: number; status: string; how: string; note: string | null; row: { sourceDoc: string; sourcePage: string; sourceUrl: string; nameAsWritten: string; unitAsWritten: string } } | null;
  choices: { name: string; priceIdr: number; page: string; costMid: number }[];
  materialIdr: Range | null; totalIdr: Range | null; lifeMonths: Range | null; lifeNote: string; costPerYearIdr: Range | null; best: boolean; lasts: boolean;
}
interface Comparison { bestLabel: string | null; ranAt: string; options: Option[]; excluded: string; audit?: { submittedIdr: number; differencePct: number; needsClarification: boolean; optionKey: string } }

const rangeWord = (r: Range) => `${rp(r.low)} sampai ${rp(r.high)}`;

export function CompareOptions({ c }: { c: V5Case }) {
  const { v6Role } = useV5();
  const [result, setResult] = useState<Comparison | null>(c.costComparison as unknown as Comparison | null);
  const [typedEsal, setEsal] = useState('');
  // The load typed for PINN carries over, also when PINN ran after this screen opened.
  const esal = typedEsal || String(c.pinnRun?.esalYear ?? '');
  const [submitted, setSubmitted] = useState('');
  const [option, setOption] = useState('');
  const action = useAction();
  if (v6Role === 'CONTRACTOR') return null;
  const canRun = v6Role === 'FE' || v6Role === 'OM';
  const priced = (result?.options ?? []).filter((o) => o.totalIdr);
  return (
    <Card title="Bandingkan opsi perbaikan" testId="v6-compare">
      {canRun && c.inspection && (
        <>
          <label className="v5-field"><span>Beban lalu lintas (ESAL per tahun)</span><input inputMode="numeric" value={esal} onChange={(e) => setEsal(e.target.value.replace(/\D/g, ''))} data-testid="v6-compare-esal" /></label>
          <button type="button" className="v5-btn v5-btn-primary" disabled={action.busy || !esal} onClick={() => action.run(async () => setResult(await v6<Comparison>(`/cases/${c.id}/compare-options`, { esalYear: Number(esal) })))} data-testid="v6-compare-run">{action.busy ? 'Menghitung…' : 'Bandingkan'}</button>
        </>
      )}
      {!result && !canRun && <p className="v5-muted">Petugas belum membandingkan biaya untuk kasus ini.</p>}
      <ErrorNote error={action.error} />
      {result && (
        <>
          <p className="v5-warn" data-testid="v6-compare-excluded">{result.excluded}</p>
          <div className="v6-compare">
            {result.options.map((o) => (
              <div key={o.key} className={`v6-option${o.best ? ' v6-option-best' : ''}`} data-testid={`v6-option-${o.key}`}>
                <div className="v5-row-between"><strong>{o.label}</strong>{o.best && <span className="v6-best" data-testid="v6-option-best">Termurah per tahun yang awet</span>}</div>
                {o.status === 'PRICE_NOT_AVAILABLE' && <p className="v5-warn" data-testid={`v6-option-missing-${o.key}`}>Harga belum tersedia. Perlu dimuat: {o.documentToLoad}.</p>}
                {o.status === 'NEEDS_OM_CHOICE' && (
                  <div data-testid={`v6-option-choice-${o.key}`}>
                    <p className="v5-warn">Operations Manager perlu memilih baris harga AC-WC di Biaya &amp; Material.</p>
                    {o.choices.map((x) => <p key={x.name} className="v5-caption">{x.name}: {rp(x.priceIdr)}/ton (hal. {x.page}), biaya sekitar {rp(x.costMid)}</p>)}
                  </div>
                )}
                {o.totalIdr && <p className="v6-money" data-testid={`v6-option-total-${o.key}`}>{rangeWord(o.totalIdr)}</p>}
                <p className="v5-caption">{o.lifeMonths ? `Tahan sekitar ${Math.round(o.lifeMonths.mid)} bulan (${Math.round(o.lifeMonths.low)} sampai ${Math.round(o.lifeMonths.high)})` : 'Umur belum bisa dihitung'}</p>
                {o.costPerYearIdr && <p data-testid={`v6-option-year-${o.key}`}><strong>{rp(o.costPerYearIdr.mid)}</strong> per tahun</p>}
                {o.price && (
                  <p className="v5-caption">
                    <StatusBadge status={o.price.status} /> {o.price.row.nameAsWritten}: {rp(o.price.priceIdr)} / {o.price.row.unitAsWritten}
                    {o.price.note ? ` ${o.price.note}` : ''}<br />
                    <SourceLine doc={o.price.row.sourceDoc} page={o.price.row.sourcePage} url={o.price.row.sourceUrl} />
                  </p>
                )}
                <TechDetails>
                  {o.quantity && <p>Jumlah: {o.quantity.amount.mid.toFixed(3)} {o.quantity.unit}. {o.quantity.how}.</p>}
                  {o.materialIdr && <p>Bahan {rp(o.materialIdr.mid)} + overhead 10-15% + PPN efektif 11%.</p>}
                  <p>{o.lifeNote}</p>
                </TechDetails>
              </div>
            ))}
          </div>
          {canRun && priced.length > 0 && (
            <div className="v5-note">
              <label className="v5-field"><span>Nilai yang diajukan atau nilai kontrak (Rp)</span><input inputMode="numeric" value={submitted} onChange={(e) => setSubmitted(e.target.value.replace(/\D/g, ''))} data-testid="v6-submitted" /></label>
              <label className="v5-field"><span>Untuk opsi</span><select value={option} onChange={(e) => setOption(e.target.value)} data-testid="v6-submitted-option"><option value="">Pilih</option>{priced.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
              <button type="button" className="v5-btn" disabled={action.busy || !submitted || !option} onClick={() => action.run(async () => setResult(await v6<Comparison>(`/cases/${c.id}/submitted-value`, { submittedIdr: Number(submitted), optionKey: option })))} data-testid="v6-submitted-send">Bandingkan nilai</button>
            </div>
          )}
          {result.audit && (
            <p className={result.audit.needsClarification ? 'v5-warn' : 'v6-ok'} data-testid="v6-audit-result">
              {result.audit.needsClarification ? `Selisih ${result.audit.differencePct}% dari rentang wajar. Perlu klarifikasi.` : 'Nilai ini masih dalam batas wajar.'}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
