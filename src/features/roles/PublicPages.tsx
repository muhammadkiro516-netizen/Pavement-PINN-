/** Public pages: map by road owner, sourced facts, guided tour, document check, measurements. */
import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Upload } from 'lucide-react';
import { v5 } from './api';
import { useV5 } from './context';
import { apiUrl } from './Capture';
import { CostCard, PinnCard, type CostView } from './StaffPages';
import { FollowUps, type PublicCase } from './TrackPages';
import { Card, Chip, ErrorNote, RolePavi, useAction, useLoad, when } from './ui';
import type { V5PinnRun, V5Role } from '../../domain/v5/model';
import type { PaviMood } from '../../components/brand/Pavi';

const OWNER_COLOR: Record<string, string> = { NASIONAL: '#4C8DFF', TOL: '#F5F7FA', PROVINSI: '#FF6B2C', KABUPATEN: '#38BDF8', KOTA: '#38BDF8', DESA: '#2BD67B', KHUSUS: '#8E8E93', UNKNOWN: '#8E8E93' };
const STATUS_WORD: Record<string, string> = { NASIONAL: 'Jalan nasional', TOL: 'Jalan tol', PROVINSI: 'Jalan provinsi', KABUPATEN: 'Jalan kabupaten', KOTA: 'Jalan kota', DESA: 'Jalan desa', KHUSUS: 'Jalan khusus', UNKNOWN: 'Status belum diketahui' };
const LINE_STYLE: Record<string, { dashArray?: string; opacity: number }> = { HIGH: { opacity: 1 }, MEDIUM: { dashArray: '6 4', opacity: 1 }, LOW: { dashArray: '1 4', opacity: 0.6 } };

interface Feature { geometry: { coordinates: [number, number][] }; properties: { id: string; name: string | null; status: string; statusLabel: string; confidence: string } }

export function MapView({ height = 420, center = [-6.2006, 106.8574] as [number, number], zoom = 14 }: { height?: number; center?: [number, number]; zoom?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const verifiedRef = useRef(verifiedOnly);
  const redraw = useRef<() => void>(() => undefined);
  verifiedRef.current = verifiedOnly;

  useEffect(() => {
    let map: import('leaflet').Map | null = null;
    let live = true;
    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (!live || !host.current) return;
      map = L.map(host.current, { zoomControl: true }).setView(center, zoom);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
      const roads = L.layerGroup().addTo(map);
      const pins = L.layerGroup().addTo(map);
      let features: Feature[] = [];
      const paint = () => {
        roads.clearLayers();
        const shown = features.filter((f) => !verifiedRef.current || f.properties.confidence === 'HIGH');
        setCount(shown.length);
        for (const f of shown) {
          const latlngs = f.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
          const style = LINE_STYLE[f.properties.confidence] ?? LINE_STYLE.LOW;
          const weight = f.properties.status === 'TOL' ? 5 : 4;
                    L.polyline(latlngs, { color: OWNER_COLOR[f.properties.status] ?? '#FFFFFF', weight, ...style })
            .bindPopup(`<strong>${(f.properties.name ?? 'Jalan tanpa nama').replace(/</g, '&lt;')}</strong><br>${STATUS_WORD[f.properties.status] ?? f.properties.status}`)
            .addTo(roads);
        }
      };
      redraw.current = paint;
      const load = async () => {
        if (!map) return;
        const b = map.getBounds();
        const data = await v5<{ features: Feature[] }>(`/public/segments?bbox=${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`).catch(() => null);
        if (data && live) { features = data.features; paint(); }
      };
      map.on('moveend', load);
      void load();
      const cases = await v5<{ publicCode: string; lat: number; lon: number; stateLabel: string; isDemo: boolean }[]>('/public/cases').catch(() => []);
      for (const c of cases) {
        // Hazard red is reserved for damage pins (04 §5).
        L.circleMarker([c.lat, c.lon], { radius: 8, color: '#FFFFFF', weight: 2, fillColor: '#FF4D5E', fillOpacity: 1 })
          .bindPopup(`<strong>${c.publicCode}</strong><br><a href="${apiUrl(`/pantau/${c.publicCode}`)}">Open timeline</a>`)
          .addTo(pins);
      }
    })();
    return () => { live = false; map?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { redraw.current(); }, [verifiedOnly]);

  return (
    <>
      <div ref={host} className="v5-map" style={{ height }} data-testid="v5-map" />
      <label className="v5-check"><input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} data-testid="v5-verified-only" /> Tampilkan yang sudah pasti saja</label>
      <p className="v5-caption" data-testid="v5-map-count">{count === null ? 'Memuat jalan…' : `${count} ruas di layar`}</p>
    </>
  );
}

export function Legend() {
  const rows = [['#4C8DFF', 'Jalan nasional'], ['#F5F7FA', 'Jalan tol'], ['#FF6B2C', 'Jalan provinsi'], ['#38BDF8', 'Jalan kabupaten / kota'], ['#FF4D5E', 'Kerusakan dilaporkan']];
  return (
    <>
      <ul className="v5-legend" data-testid="v5-legend">
        {rows.map(([c, t]) => <li key={t}><i style={{ background: c }} />{t}</li>)}
      </ul>
      <ul className="v5-legend">
        <li><i className="v5-line" style={{ borderTop: '3px solid #fff' }} />Garis penuh: pasti</li>
        <li><i className="v5-line" style={{ borderTop: '3px dashed #fff' }} />Putus-putus: kemungkinan besar</li>
        <li><i className="v5-line" style={{ borderTop: '3px dotted #fff' }} />Titik-titik: koordinator memastikan</li>
      </ul>
    </>
  );
}

// Exact wording and sources: docs/v5/14_BACKGROUND_STORY.md §5, the "safe" list only.
const FACTS: { group: string; items: [string, string][] }[] = [
  { group: 'Jalan rusak bisa merenggut nyawa', items: [
    ['27 kecelakaan akibat lubang dalam 28 hari di Jabodetabek, Januari 2026.', 'Polda Metro Jaya via detikOto'],
    ['4 pengendara meninggal dalam 13 hari di satu ruas rusak: Pasar Kemis, Februari 2026.', 'Diberitakan VOI'],
    ['Sekitar 6.000 lubang di Jakarta setelah hujan Januari 2026, sebagian besar tambalan sementara.', 'CNN Indonesia'],
    ['Jalan kondisi "baik atau sedang": nasional 92%, provinsi 72%, kabupaten/kota 58%.', 'PUPR, May 2023, via Kontan'],
    ['Truk kelebihan muatan: beban 2×, kerusakan 16×.', 'Dirjen Bina Marga, 2023'],
    ['1,19 juta kematian di jalan setiap tahun.', 'WHO Global Status Report on Road Safety 2023']
  ] },
  { group: 'Laporan sering tersesat', items: [
    ['Hanya sekitar 5% laporan ke aplikasi jalan Jawa Tengah berada di jalan yang bisa ditanganinya.', 'Antara Jateng, 2019'],
    ['Kementerian pengelola kanal pengaduan rata-rata butuh 5,2 hari untuk verifikasi; targetnya 3 hari.', 'KemenPANRB 2023'],
    ['Jalan adalah keluhan nomor 1 di Jakarta: sekitar 20% laporan (November 2025).', 'GoodStats'],
    ['10 tahun keluhan. Satu video viral. Rp 800 miliar. Lampung 2023.', 'Republika, Kontan'],
    ['"No viral, no justice."', 'Ombudsman RI, 2026']
  ] },
  { group: 'Sudah dibayar, tapi apakah bertahan?', items: [
    ['Petugas dikenai sanksi karena foto "selesai" hasil edit AI: Jakarta, April 2026.', 'Metro TV'],
    ['BPK: pekerjaan Rp 141 miliar yang sudah dibayar belum terwujud di 83 pemerintah daerah.', 'IHPS II 2024'],
    ['Perkara pengadilan: dibayar 95% saat progres 65%, aspal lebih tipis dari rencana: Simeulue.', 'MA via Dandapala'],
    ['Aspal baru retak 1 sampai 2 hari setelah dihampar: Alor, NTT.', 'Kompas via BPK NTT'],
    ['Periksa perbaikan pada bulan ke-1, 3, dan 6: jadwal studi lubang SHRP di AS.', 'FHWA InfoPave 99202']
  ] },
  { group: 'Siapa yang harus terjangkau', items: [
    ['229 juta orang Indonesia sudah online (80,7%). Sekitar 55 juta belum.', 'APJII 2025 via detik'],
    ['137 juta sepeda motor: 84% kendaraan.', 'Korlantas, Aug 2024, via CNN Indonesia']
  ] }
];

export function WhyPage() {
  const { go } = useV5();
  return (
    <>
      <Card testId="v5-why">
        <h1 className="v5-title">Kenapa ini penting</h1>
        <p>Foto warga harus sampai ke instansi pemilik jalan itu, tetap terlihat sampai diperbaiki, dan menunjukkan apakah perbaikannya tepat ukuran, wajar harganya, dan benar-benar bertahan.</p>
      </Card>
      {FACTS.map((g) => (
        <Card key={g.group} title={g.group}>
          <ul className="v5-facts">
            {g.items.map(([fact, source]) => <li key={fact} data-testid="v5-fact"><p>{fact}</p><cite>Sumber: {source}</cite></li>)}
          </ul>
        </Card>
      ))}
      <Card>
        <p>Aplikasi ini memperkuat SP4N-LAPOR! dan JAKI, bukan kanal pengaduan baru.</p>
        <button type="button" className="v5-btn v5-btn-primary" onClick={() => go('/beranda/')}>Laporkan jalan rusak</button>
      </Card>
    </>
  );
}

interface TourData {
  case: PublicCase;
  photo: { id: string; detections: { label: string; confidence: number; bbox: [number, number, number, number] }[]; width: number | null; height: number | null } | null;
  inspection: { lengthMm: number; widthMm: number; depthMmTyped: number | null; areaStatus: string } | null;
  pinn: V5PinnRun | null;
  cost: CostView | null;
  stages: string[];
  doc: { id: string; sha256: string; pdfUrl: string; verifyUrl: string } | null;
}

const STEPS: { caption: string; role: V5Role; mood: PaviMood }[] = [
  { caption: 'Setiap jalan ada pemiliknya. Warna menunjukkan siapa yang harus memperbaiki.', role: 'CITIZEN', mood: 'idle' },
  { caption: 'Warga memotret langsung. AI mengenali lubang dan laporan menuju kantor yang tepat.', role: 'CITIZEN', mood: 'scan' },
  { caption: 'Petugas mengukur kedalaman dengan penggaris. Perhitungan fisika memperkirakan umur perbaikan.', role: 'FIELD_INSPECTOR', mood: 'scan' },
  { caption: 'Kami memperkirakan biaya wajar. Selisih besar diberi catatan netral.', role: 'AUDITOR', mood: 'idle' },
  { caption: 'Regu perbaikan mengirim bukti. Warga mengecek lagi di bulan ke-1, 3, dan 6.', role: 'REPAIR_CREW', mood: 'walk' },
  { caption: 'Setiap langkah tersegel. Siapa pun bisa mengecek laporannya tidak berubah.', role: 'AUDITOR', mood: 'found' }
];

export function TourPage() {
  const { go, demoServer } = useV5();
  const [step, setStep] = useState(0);
  const { data, error } = useLoad(() => v5<TourData>('/demo/tour'));
  if (!demoServer) return <Card><p>Tur belum tersedia di server ini.</p></Card>;
  if (error) return <Card title="Tur belum siap"><p>{error.message}</p></Card>;
  if (!data) return <Card><p>Menyiapkan kasus contoh…</p></Card>;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const r = data.case.routing;
  return (
    <div data-testid="v5-tour">
      <div className="v5-dots" role="progressbar" aria-valuemin={1} aria-valuemax={6} aria-valuenow={step + 1}>
        {STEPS.map((_, i) => <span key={i} className={i <= step ? 'is-on' : ''} />)}
      </div>
      <Card>
        <div className="v5-tour-head"><RolePavi role={s.role} mood={s.mood} size={56} /><p className="v5-tour-caption" data-testid="v5-tour-caption">{s.caption}</p></div>
        <p className="v5-caption">Kasus contoh {data.case.publicCode}.</p>
      </Card>
      {step === 0 && <Card><MapView height={300} /><Legend /></Card>}
      {step === 1 && (
        <Card>
          {data.photo && (
            <div className="v5-detect-photo">
              <img src={apiUrl(`/api/v5/evidence/${data.photo.id}/image`)} alt="Contoh kerusakan jalan" />
              {data.photo.width && data.photo.height && data.photo.detections.map((d, i) => <span key={i} className="v5-box" style={{ left: `${(d.bbox[0] / data.photo!.width!) * 100}%`, top: `${(d.bbox[1] / data.photo!.height!) * 100}%`, width: `${((d.bbox[2] - d.bbox[0]) / data.photo!.width!) * 100}%`, height: `${((d.bbox[3] - d.bbox[1]) / data.photo!.height!) * 100}%` }}><em>{d.label} {Math.round(d.confidence * 100)}%</em></span>)}
            </div>
          )}
          {data.photo?.detections.length ? <p>Keyakinan AI {Math.round(data.photo.detections[0].confidence * 100)}% <Chip kind="AI_ESTIMATE" /></p> : <p>AI tidak melihat kerusakan pada contoh ini.</p>}
          {r && <p>Dikirim ke <strong>{r.officeName}</strong></p>}
        </Card>
      )}
      {step === 2 && (
        <>
          {data.inspection && <Card><p className="v5-big">Kedalaman <strong>{data.inspection.depthMmTyped} mm</strong> <Chip kind="DEMO" /></p><p>Ukuran {(data.inspection.lengthMm / 1000).toFixed(2)} × {(data.inspection.widthMm / 1000).toFixed(2)} m <Chip kind="DEMO" /></p></Card>}
          {data.pinn && <PinnCard run={data.pinn} />}
        </>
      )}
      {step === 3 && data.cost && <CostCard cost={data.cost} />}
      {step === 4 && <Card><p>{data.stages.length} tahap bukti tercatat, dari sebelum sampai sesudah perbaikan.</p><FollowUps items={data.case.followUps} /></Card>}
      {step === 5 && (
        <Card>
          {data.doc ? <><p><strong>{data.doc.id}</strong></p><p className="v5-caption">Kode bukti <code>{data.doc.sha256}</code></p><div className="v5-row"><a className="v5-btn" href={apiUrl(data.doc.pdfUrl)} target="_blank" rel="noreferrer">Buka PDF</a><button type="button" className="v5-btn" onClick={() => go(data.doc!.verifyUrl)}>Periksa keasliannya</button></div></> : <p>Pencetak PDF belum tersedia di server ini.</p>}
        </Card>
      )}
      <div className="v5-row v5-tour-nav">
        {step > 0 && <button type="button" className="v5-btn" onClick={() => setStep(step - 1)}>Kembali</button>}
        {!last && <button type="button" className="v5-btn v5-btn-primary" onClick={() => setStep(step + 1)} data-testid="v5-tour-next">Lanjut</button>}
      </div>
      {last && (
        <Card testId="v5-tour-end">
          <h2>Coba sendiri</h2>
          <div className="v5-row">
            <button type="button" className="v5-btn v5-btn-primary" onClick={() => go('/beranda/')}>Lapor sebagai warga</button>
            <button type="button" className="v5-btn" onClick={() => go('/peran/')}>Buka peran petugas</button>
            <button type="button" className="v5-btn" onClick={() => go('/bukti/')}>Lihat hasil uji</button>
          </div>
          <p className="v5-caption">Tur ini memakai kasus contoh. Angka uji sungguhan ada di halaman Bukti.</p>
        </Card>
      )}
    </div>
  );
}

interface VerifyData {
  docId: string;
  version: number;
  issuedAt: string;
  sha256: string;
  supersededBy: string | null;
  isDemo: boolean;
  publicCode: string;
  snapshot: { chainId: string; lastSeq: number; root: string; period: string };
  checks: { eventLogIntact: boolean; firstFailure: { seq: number; status: string } | null; truncated: boolean; checkpointRootMatches: boolean; issuedEventFound: boolean; storedFileMatchesLog: boolean; caseEventsCovered: number };
  ots: { status: string; note: string };
  pdfUrl: string;
  proves: string;
  doesNotProve: string;
}

function CheckLine({ ok, good, bad }: { ok: boolean; good: string; bad: string }) {
  return <li className={ok ? 'v5-good' : 'v5-bad'}>{ok ? '✓' : '✗'} {ok ? good : bad}</li>;
}

export function VerifyPage({ docId }: { docId?: string }) {
  const { go } = useV5();
  const [input, setInput] = useState(docId ?? '');
  const [data, setData] = useState<VerifyData | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const action = useAction();

  const load = (id: string) => action.run(async () => { setFileHash(null); setData(await v5<VerifyData>(`/public/verify/${encodeURIComponent(id.trim())}`)); });
  useEffect(() => { if (docId) void load(docId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [docId]);

  // Hashed in this browser. The file is never uploaded.
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    setFileHash([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''));
  };

  const matches = !!data && fileHash === data.sha256;
  const allGood = !!data && data.checks.eventLogIntact && data.checks.checkpointRootMatches && data.checks.issuedEventFound && data.checks.storedFileMatchesLog;
  return (
    <>
      <Card testId="v5-verify">
        <div className="v5-row-between"><h1 className="v5-title">Periksa keaslian laporan</h1><RolePavi role="AUDITOR" mood={allGood ? 'found' : 'idle'} size={56} /></div>
        <label className="v5-field"><span>Nomor laporan</span><input value={input} onChange={(e) => setInput(e.target.value)} placeholder="DOC-JKT-XXXXXX-v1" data-testid="v5-verify-input" /></label>
        <button type="button" className="v5-btn v5-btn-primary" disabled={action.busy || !input.trim()} onClick={() => go(`/v/${encodeURIComponent(input.trim())}`)} data-testid="v5-verify-go">Periksa</button>
        <ErrorNote error={action.error} />
      </Card>
      {data && (
        <>
          {data.isDemo && <div className="v5-demo-doc" data-testid="v5-verify-demo">Ini dokumen contoh, bukan data nyata.</div>}
          <Card title={data.docId} testId="v5-verify-result">
            <p data-testid="v5-verify-summary" className={allGood ? 'v5-good' : 'v5-bad'}><ShieldCheck size={18} aria-hidden="true" /> <strong>{allGood ? 'Laporan ini asli dan tidak berubah.' : 'Pemeriksaan gagal.'}</strong></p>
            <ul className="v5-checks">
              <CheckLine ok={data.checks.eventLogIntact} good="Catatan kejadian utuh." bad={data.checks.truncated ? 'Catatan terbaru hilang.' : `Catatan berubah di nomor ${data.checks.firstFailure?.seq}.`} />
              <CheckLine ok={data.checks.checkpointRootMatches} good="Titik periksa cocok dengan catatan." bad="Titik periksa tidak cocok dengan catatan." />
              <CheckLine ok={data.checks.issuedEventFound} good="Laporan ini tercatat saat terbit." bad="Tidak ada catatan terbitnya." />
              <CheckLine ok={data.checks.storedFileMatchesLog} good="Berkas tersimpan cocok dengan catatan." bad="Berkas tersimpan berbeda dari catatan." />
            </ul>
            <dl className="v5-dl">
              <dt>Terbit</dt><dd>{when(data.issuedAt)}</dd>
              <dt>Versi</dt><dd>{data.version}{data.supersededBy ? `. Ada versi lebih baru: ${data.supersededBy}` : ''}</dd>
              <dt>Cakupan</dt><dd>Catatan 1 sampai {data.snapshot.lastSeq}</dd>
              <dt>Kode bukti</dt><dd><code data-testid="v5-verify-hash">{data.sha256}</code></dd>
            </dl>
            <a className="v5-link" href={apiUrl(data.pdfUrl)} target="_blank" rel="noreferrer">Buka PDF yang diterbitkan</a>
          </Card>
          <Card title="Punya PDF-nya? Bandingkan" testId="v5-verify-file">
            <label className="v5-drop"><Upload size={18} aria-hidden="true" /> Pilih PDF. Berkasnya tetap di perangkat Anda.
              <input type="file" accept="application/pdf" onChange={(e) => onFile(e.target.files?.[0])} data-testid="v5-verify-file-input" />
            </label>
            {fileHash && <p className={matches ? 'v5-good' : 'v5-bad'} data-testid="v5-file-result">{matches ? '✓ Berkas ini sama dengan laporan yang diterbitkan.' : '✗ Berkas ini berbeda dari laporan yang diterbitkan.'}</p>}
          </Card>
          <Card title="Artinya apa?">
            <p><strong>Yang dibuktikan:</strong> dokumen ini tidak berubah sejak terbit, dan catatannya sudah ada saat itu.</p>
            <p><strong>Yang tidak dibuktikan:</strong> kebenaran pengamatan di lapangan. Itu diperiksa instansi di lokasi.</p>
          </Card>
        </>
      )}
    </>
  );
}

