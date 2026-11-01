/** Public pages: map by road owner, sourced facts, guided tour, document check, measurements. */
import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Upload } from 'lucide-react';
import { v5 } from './api';
import { useV5 } from './context';
import { apiUrl } from './Capture';
import { CostCard, PinnCard, type CostView } from './StaffPages';
import type { PublicCase } from './CitizenPages';
import { FollowUps } from './CitizenPages';
import { Card, Chip, ErrorNote, RolePavi, useAction, useLoad, when } from './ui';
import type { V5PinnRun, V5Role } from '../domain/v5/model';
import type { PaviMood } from '../components/brand/Pavi';

const OWNER_COLOR: Record<string, string> = { NASIONAL: '#0068B5', TOL: '#0D1015', PROVINSI: '#FF7A1A', KABUPATEN: '#0A9CC2', KOTA: '#0A9CC2', DESA: '#12A06A', KHUSUS: '#8B8C8E', UNKNOWN: '#FFFFFF' };
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
          // Ink casing carries the contrast: cone orange alone is under 3:1 on white (04 §5).
          L.polyline(latlngs, { color: '#0D1015', weight: weight + 1.5, opacity: 0.55 * style.opacity, interactive: false }).addTo(roads);
          L.polyline(latlngs, { color: OWNER_COLOR[f.properties.status] ?? '#FFFFFF', weight, ...style })
            .bindPopup(`<strong>${(f.properties.name ?? 'Unnamed road').replace(/</g, '&lt;')}</strong><br>${f.properties.statusLabel}<br>${f.properties.confidence} confidence<br><small>Road class from map data. Legal status is confirmed by decree.</small>`)
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
        L.circleMarker([c.lat, c.lon], { radius: 8, color: '#FFFFFF', weight: 2, fillColor: '#E5391A', fillOpacity: 1 })
          .bindPopup(`<strong>${c.publicCode}</strong>${c.isDemo ? ' (DEMO)' : ''}<br>${c.stateLabel}<br><a href="${apiUrl(`/v5/t/${c.publicCode}`)}">Open timeline</a>`)
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
      <label className="v5-check"><input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} data-testid="v5-verified-only" /> Show verified data only</label>
      <p className="v5-caption" data-testid="v5-map-count">{count === null ? 'Loading roads…' : `${count} road pieces in view`} <Chip kind="COMPUTED" /></p>
    </>
  );
}

export function Legend() {
  const rows = [['#0068B5', 'National road'], ['#0D1015', 'Toll road'], ['#FF7A1A', 'Provincial road'], ['#0A9CC2', 'Regency or city road'], ['#E5391A', 'Reported damage']];
  return (
    <>
      <ul className="v5-legend" data-testid="v5-legend">
        {rows.map(([c, t]) => <li key={t}><i style={{ background: c }} />{t}</li>)}
      </ul>
      <ul className="v5-legend">
        <li><i className="v5-line" style={{ borderTop: '3px solid #0D1015' }} />Solid: high confidence</li>
        <li><i className="v5-line" style={{ borderTop: '3px dashed #0D1015' }} />Dashed: medium</li>
        <li><i className="v5-line" style={{ borderTop: '3px dotted #0D1015' }} />Dotted: low, coordinator confirms</li>
      </ul>
    </>
  );
}

export function MapPage() {
  return (
    <Card title="Every road has an owner">
      <p>Colour shows who must fix the road. Line style shows how sure we are.</p>
      <MapView />
      <Legend />
      <p className="v5-caption">Road geometry © OpenStreetMap contributors. National and provincial decree lists are not matched yet <Chip kind="TODO_VERIFY" title="Kepmen PUPR 1688/KPTS/M/2022 lampiran" /></p>
    </Card>
  );
}

// Exact wording and sources: docs/v5/14_BACKGROUND_STORY.md §5, the "safe" list only.
const FACTS: { group: string; items: [string, string][] }[] = [
  { group: 'Road damage is deadly', items: [
    ['27 pothole crashes in 28 days in Greater Jakarta, Jan 2026.', 'Polda Metro Jaya via detikOto'],
    ['4 riders died in 13 days on one damaged road: Pasar Kemis, Feb 2026.', 'Reported by VOI'],
    ['About 6,000 potholes in Jakarta after January 2026 rains, mostly temporary patches.', 'CNN Indonesia'],
    ['Road condition "good or fair": national 92%, provincial 72%, regency/city 58%.', 'PUPR, May 2023, via Kontan'],
    ['Overloaded trucks: 2× the load, 16× the damage.', 'Dirjen Bina Marga, 2023'],
    ['1.19 million road deaths a year.', 'WHO Global Status Report on Road Safety 2023']
  ] },
  { group: 'Reports get lost', items: [
    ['Only about 5% of reports to Central Java\'s road app were on roads it could fix.', 'Antara Jateng, 2019'],
    ['The complaint system\'s own ministry took 5.2 days on average to verify; the target is 3.', 'KemenPANRB 2023'],
    ['Roads are the #1 complaint in Jakarta: about 20% of reports (Nov 2025).', 'GoodStats'],
    ['10 years of complaints. One viral video. Rp 800 billion. Lampung 2023.', 'Republika, Kontan'],
    ['"No viral, no justice."', 'Ombudsman RI, 2026']
  ] },
  { group: 'Paid for, but did it last?', items: [
    ['Officers sanctioned for AI-edited "job done" photos: Jakarta, Apr 2026.', 'Metro TV'],
    ['BPK: Rp 141 billion of paid work not delivered in 83 local governments.', 'IHPS II 2024'],
    ['Court case: 95% paid at 65% progress, asphalt thinner than design: Simeulue.', 'MA via Dandapala'],
    ['New asphalt cracked 1 to 2 days after paving: Alor, NTT.', 'Kompas via BPK NTT'],
    ['Inspect repairs at 1, 3 and 6 months: the schedule used by the US SHRP pothole study.', 'FHWA InfoPave 99202']
  ] },
  { group: 'Who we must reach', items: [
    ['229 million Indonesians online (80.7%). About 55 million are not.', 'APJII 2025 via detik'],
    ['137 million motorcycles: 84% of vehicles.', 'Korlantas, Aug 2024, via CNN Indonesia']
  ] }
];

export function WhyPage() {
  const { go } = useV5();
  return (
    <>
      <Card testId="v5-why">
        <h1 className="v5-title">Why this matters</h1>
        <p>A citizen's photo should reach the agency that owns that road, stay visible until it is fixed, and show whether the repair was the right size, the right price, and actually lasted.</p>
      </Card>
      {FACTS.map((g) => (
        <Card key={g.group} title={g.group}>
          <ul className="v5-facts">
            {g.items.map(([fact, source]) => <li key={fact} data-testid="v5-fact"><p>{fact}</p><cite>Source: {source}</cite> <Chip kind="OFFICIAL" title="Cited in our research notes, as reported by the source named" /></li>)}
          </ul>
        </Card>
      ))}
      <Card>
        <p>This is a layer that feeds SP4N-LAPOR! and JAKI, not another inbox.</p>
        <button type="button" className="v5-btn v5-btn-primary" onClick={() => go('/v5/report')}>Report damage</button>
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
  { caption: 'Every road has an owner. Colors show who must fix it.', role: 'CITIZEN', mood: 'idle' },
  { caption: 'A citizen takes a live photo. AI finds the pothole and sends it to the right office.', role: 'CITIZEN', mood: 'scan' },
  { caption: 'An inspector measures depth with a ruler. Physics gives a life range for a proper repair.', role: 'FIELD_INSPECTOR', mood: 'scan' },
  { caption: 'We estimate a fair price from official unit prices. Big gaps get a neutral flag.', role: 'AUDITOR', mood: 'idle' },
  { caption: 'Repair crews upload proof. Citizens re-check at 1, 3 and 6 months.', role: 'REPAIR_CREW', mood: 'walk' },
  { caption: 'Every step is sealed. Anyone can check the report was not changed.', role: 'AUDITOR', mood: 'found' }
];

export function TourPage() {
  const { go, demoServer } = useV5();
  const [step, setStep] = useState(0);
  const { data, error } = useLoad(() => v5<TourData>('/demo/tour'));
  if (!demoServer) return <Card><p>The tour runs in demo mode only.</p></Card>;
  if (error) return <Card title="Tour not ready"><p>{error.message}</p></Card>;
  if (!data) return <Card><p>Getting the sample case ready…</p></Card>;
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
        <p><Chip kind="DEMO" /> Sample case {data.case.publicCode}. All records are stamped DEMO.</p>
      </Card>
      {step === 0 && <Card><MapView height={300} /><Legend /></Card>}
      {step === 1 && (
        <Card>
          {data.photo && (
            <div className="v5-detect-photo">
              <img src={apiUrl(`/api/v5/evidence/${data.photo.id}/image`)} alt="Sample road damage" />
              {data.photo.width && data.photo.height && data.photo.detections.map((d, i) => <span key={i} className="v5-box" style={{ left: `${(d.bbox[0] / data.photo!.width!) * 100}%`, top: `${(d.bbox[1] / data.photo!.height!) * 100}%`, width: `${((d.bbox[2] - d.bbox[0]) / data.photo!.width!) * 100}%`, height: `${((d.bbox[3] - d.bbox[1]) / data.photo!.height!) * 100}%` }}><em>{d.label} {Math.round(d.confidence * 100)}%</em></span>)}
            </div>
          )}
          {data.photo?.detections.length ? <p>AI score {Math.round(data.photo.detections[0].confidence * 100)}% <Chip kind="AI_ESTIMATE" /></p> : <p>AI found nothing in this sample <Chip kind="AI_ESTIMATE" /></p>}
          {r && <p>Sent to <strong>{r.officeName}</strong> · {r.confidence.toLowerCase()} confidence</p>}
        </Card>
      )}
      {step === 2 && (
        <>
          {data.inspection && <Card><p className="v5-big">Depth <strong>{data.inspection.depthMmTyped} mm</strong> <Chip kind="DEMO" /></p><p>Size {(data.inspection.lengthMm / 1000).toFixed(2)} × {(data.inspection.widthMm / 1000).toFixed(2)} m <Chip kind="DEMO" /></p></Card>}
          {data.pinn && <PinnCard run={data.pinn} />}
        </>
      )}
      {step === 3 && data.cost && <CostCard cost={data.cost} />}
      {step === 4 && <Card><p>{data.stages.length} evidence stages recorded: {data.stages.join(', ').toLowerCase().replace(/_/g, ' ')}.</p><FollowUps items={data.case.followUps} /></Card>}
      {step === 5 && (
        <Card>
          {data.doc ? <><p><strong>{data.doc.id}</strong></p><p className="v5-caption">SHA-256 <code>{data.doc.sha256}</code></p><div className="v5-row"><a className="v5-btn" href={apiUrl(data.doc.pdfUrl)} target="_blank" rel="noreferrer">Open PDF</a><button type="button" className="v5-btn" onClick={() => go(data.doc!.verifyUrl)}>Verify it</button></div></> : <p>The PDF printer is not available on this server.</p>}
        </Card>
      )}
      <div className="v5-row v5-tour-nav">
        {step > 0 && <button type="button" className="v5-btn" onClick={() => setStep(step - 1)}>Back</button>}
        {!last && <button type="button" className="v5-btn v5-btn-primary" onClick={() => setStep(step + 1)} data-testid="v5-tour-next">Next</button>}
      </div>
      {last && (
        <Card testId="v5-tour-end">
          <h2>Try it yourself</h2>
          <div className="v5-row">
            <button type="button" className="v5-btn v5-btn-primary" onClick={() => go('/v5/report')}>Report as a citizen</button>
            <button type="button" className="v5-btn" onClick={() => go('/v5/')}>Open staff view</button>
            <button type="button" className="v5-btn" onClick={() => go('/v5/measurements')}>See our test results</button>
          </div>
          <p className="v5-caption">This tour uses demo data. Real pilot numbers are on the measurements page.</p>
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
        <div className="v5-row-between"><h1 className="v5-title">Check a report</h1><RolePavi role="AUDITOR" mood={allGood ? 'found' : 'idle'} size={56} /></div>
        <label className="v5-field"><span>Document ID</span><input value={input} onChange={(e) => setInput(e.target.value)} placeholder="DOC-JKT-XXXXXX-v1" data-testid="v5-verify-input" /></label>
        <button type="button" className="v5-btn v5-btn-primary" disabled={action.busy || !input.trim()} onClick={() => go(`/v/${encodeURIComponent(input.trim())}`)} data-testid="v5-verify-go">Check</button>
        <ErrorNote error={action.error} />
      </Card>
      {data && (
        <>
          {data.isDemo && <div className="v5-demo-doc" data-testid="v5-verify-demo">This is a demo document. Not real data.</div>}
          <Card title={data.docId} testId="v5-verify-result">
            <p data-testid="v5-verify-summary" className={allGood ? 'v5-good' : 'v5-bad'}><ShieldCheck size={18} aria-hidden="true" /> <strong>{allGood ? 'All integrity checks passed.' : 'Verification failed.'}</strong></p>
            <ul className="v5-checks">
              <CheckLine ok={data.checks.eventLogIntact} good="Event log is intact." bad={data.checks.truncated ? 'Newest events are missing from the log.' : `Event log fails at event ${data.checks.firstFailure?.seq}: ${data.checks.firstFailure?.status}.`} />
              <CheckLine ok={data.checks.checkpointRootMatches} good="Checkpoint matches the log." bad="Checkpoint does not match the log." />
              <CheckLine ok={data.checks.issuedEventFound} good="This document was logged when issued." bad="No issue record for this document." />
              <CheckLine ok={data.checks.storedFileMatchesLog} good="Our stored file matches the logged hash." bad="Our stored file differs from the logged hash." />
            </ul>
            <dl className="v5-dl">
              <dt>Issued</dt><dd>{when(data.issuedAt)}</dd>
              <dt>Version</dt><dd>{data.version}{data.supersededBy ? `. A newer version exists: ${data.supersededBy}` : ''}</dd>
              <dt>Log range</dt><dd>Events 1 to {data.snapshot.lastSeq}, chain {data.snapshot.chainId}</dd>
              <dt>SHA-256</dt><dd><code data-testid="v5-verify-hash">{data.sha256}</code></dd>
              <dt>Merkle root</dt><dd><code>{data.snapshot.root}</code></dd>
              <dt>Public time anchor</dt><dd>Not anchored. {data.ots.note}</dd>
            </dl>
            <a className="v5-link" href={apiUrl(data.pdfUrl)} target="_blank" rel="noreferrer">Open the issued PDF</a>
          </Card>
          <Card title="Do you have the PDF? Compare it" testId="v5-verify-file">
            <label className="v5-drop"><Upload size={18} aria-hidden="true" /> Choose the PDF. It stays on your device.
              <input type="file" accept="application/pdf" onChange={(e) => onFile(e.target.files?.[0])} data-testid="v5-verify-file-input" />
            </label>
            {fileHash && <p className={matches ? 'v5-good' : 'v5-bad'} data-testid="v5-file-result">{matches ? '✓ This file matches the issued document.' : '✗ This file is different from the issued document.'}</p>}
          </Card>
          <Card title="What this means">
            <p><strong>What this proves:</strong> {data.proves}</p>
            <p><strong>What it does not prove:</strong> {data.doesNotProve}</p>
          </Card>
        </>
      )}
    </>
  );
}

interface MeasureRow { file: string; ok: boolean; json: Record<string, unknown> | null }

const NOT_MEASURED = new Set(['BELUM_DIUKUR', 'NOT_MEASURED', 'NOT_SUPPORTED']);

/** Numbers found in a measurement file, shown exactly as written. */
function numbersIn(value: unknown, prefix = '', out: [string, number][] = []): [string, number][] {
  if (out.length >= 10 || !value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'number') out.push([key, v]);
    else if (v && typeof v === 'object' && !Array.isArray(v) && key.split('.').length < 3) numbersIn(v, key, out);
    if (out.length >= 10) break;
  }
  return out;
}

export function MeasurementsPage() {
  const { data, error } = useLoad(() => v5<MeasureRow[]>('/public/measurements'));
  return (
    <Card title="Measurements" testId="v5-measure-page">
      <p>This page shows only what our scripts wrote into <code>measurements/*.json</code>. If a file says it was not measured, so do we.</p>
      {error && <p>{error.message}</p>}
      {data?.length === 0 && <p>Not measured yet.</p>}
      <ul className="v5-measures">
        {data?.map((m) => {
          const label = String(m.json?.status ?? m.json?.label ?? '');
          const measured = m.ok && !NOT_MEASURED.has(label) && !!m.json;
          const host = String(m.json?.hostLabel ?? '');
          return (
            <li key={m.file} data-testid="v5-measure-row" data-measured={measured}>
              <strong>{m.file.replace('.json', '')}</strong>
              {measured ? <Chip kind="MEASURED" title={`Label in file: ${label || 'none'}`} /> : <Chip kind="NOT_MEASURED" />}
              {host && <span className={host === 'HOST_INTEL' ? 'v5-good' : 'v5-muted'}> {host === 'HOST_INTEL' ? 'Intel host' : 'Non-Intel host, not an Intel result'}</span>}
              {measured ? (
                <>
                  {typeof m.json?.measuredAt === 'string' && <span className="v5-caption">Measured {when(m.json.measuredAt as string)}</span>}
                  <dl className="v5-dl">{numbersIn(m.json).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
                </>
              ) : (
                <p className="v5-muted">Not measured yet.{typeof m.json?.howTo === 'string' ? ` ${m.json.howTo}` : ''}</p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
