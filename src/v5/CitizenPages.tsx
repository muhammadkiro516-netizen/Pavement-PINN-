/** Citizen: report with the live camera, see who owns the road, follow the case. No login. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Footprints, MapPin, Send, Target } from 'lucide-react';
import { v5 } from './api';
import { useV5 } from './context';
import { Capture, DEMO_PLACES, DetectionView, apiUrl, useGps, type EvidenceView, type Fix } from './Capture';
import { Card, Chip, Confidence, ErrorNote, Ladder, RolePavi, Timeline, dateOnly, useAction, useLoad, type LadderView, type TimelineItem } from './ui';

export interface RoutingView {
  status: string;
  statusLabel: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  authorityName: string;
  officeName: string;
  segment: { id: string; name: string | null; distanceM: number } | null;
  legalBasis: string;
  basis: string;
  askCitizen: string | null;
  coordinatorPrompt: string | null;
  officeVerifyStatus: string;
  area: { kota: string | null; kecamatan: string | null };
  ruleIds: string[];
}

const BANDS = [
  { id: 'S', label: 'Small', note: 'under 0.1 m²' },
  { id: 'M', label: 'Medium', note: '0.1 to 0.5 m²' },
  { id: 'L', label: 'Large', note: 'over 0.5 m²' }
];

export function RoutingCard({ routing }: { routing: RoutingView }) {
  return (
    <Card title="Whose road is this?" testId="v5-routing">
      <p className="v5-office"><strong data-testid="v5-office-name">{routing.officeName}</strong></p>
      <p>{routing.statusLabel}{routing.segment?.name ? ` · ${routing.segment.name}` : ''} <Confidence level={routing.confidence} /></p>
      <p className="v5-caption">{routing.basis}</p>
      <p className="v5-caption">Legal basis: {routing.legalBasis}</p>
      {routing.confidence === 'LOW' && <p className="v5-warn" data-testid="v5-coordinator-confirm">Coordinator to confirm.</p>}
      {routing.officeVerifyStatus !== 'VERIFIED' && <p className="v5-caption">Office contact details are not verified yet <Chip kind="TODO_VERIFY" /></p>}
    </Card>
  );
}

function SendButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return <button type="button" className="v5-btn v5-btn-primary" disabled={busy} onClick={onClick} data-testid="v5-send"><Send size={18} aria-hidden="true" /> {busy ? 'Sending…' : 'Send report'}</button>;
}

function SentCard({ sent }: { sent: { publicCode: string; routing: RoutingView; eventHash: string } }) {
  const { go } = useV5();
  return (
    <Card testId="v5-sent">
      <div className="v5-pop"><RolePavi role="CITIZEN" mood="celebrate" size={84} /></div>
      <h2>Sent. Your tracking code:</h2>
      <p className="v5-code" data-testid="v5-tracking-code">{sent.publicCode}</p>
      <p>Sent to <strong>{sent.routing.officeName}</strong>. It stays visible until it is fixed.</p>
      <p className="v5-caption">Sealed in the log: <code>{sent.eventHash.slice(0, 16)}</code></p>
      <button type="button" className="v5-btn v5-btn-primary" onClick={() => go(`/v5/t/${sent.publicCode}`)} data-testid="v5-open-tracking">See the timeline</button>
    </Card>
  );
}

export function ReportPage() {
  const [mode, setMode] = useState<'SINGLE' | 'TRACE' | null>(null);
  if (mode === 'SINGLE') return <SingleReport onBack={() => setMode(null)} />;
  if (mode === 'TRACE') return <LongReport onBack={() => setMode(null)} />;
  return (
    <Card title="Report damage">
      <p>Is the damage small enough to fit in one photo?</p>
      <div className="v5-choice">
        <button type="button" onClick={() => setMode('SINGLE')} data-testid="v5-mode-single"><Target size={22} aria-hidden="true" /><strong>One spot</strong><span>A pothole or a crack.</span></button>
        <button type="button" onClick={() => setMode('TRACE')} data-testid="v5-mode-long"><Footprints size={22} aria-hidden="true" /><strong>Large or long damage</strong><span>Start, walk along it, End.</span></button>
      </div>
      <p className="v5-caption">We need the camera and your location to send the report to the right agency. No name needed.</p>
    </Card>
  );
}

function DemoPlacePicker({ place, setPlace }: { place: (typeof DEMO_PLACES)[number]; setPlace: (p: (typeof DEMO_PLACES)[number]) => void }) {
  return (
    <label className="v5-field">
      <span><MapPin size={14} aria-hidden="true" /> Sample place, used when this device has no GPS <Chip kind="DEMO" /></span>
      <select value={place.id} onChange={(e) => setPlace(DEMO_PLACES.find((p) => p.id === e.target.value)!)} data-testid="v5-demo-place">
        {DEMO_PLACES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  );
}

function SingleReport({ onBack }: { onBack: () => void }) {
  const { demoEnabled } = useV5();
  const [place, setPlace] = useState(DEMO_PLACES[0]);
  const [photo, setPhoto] = useState<EvidenceView | null>(null);
  const [band, setBand] = useState<string | null>(null);
  const [routing, setRouting] = useState<RoutingView | null>(null);
  const [sent, setSent] = useState<{ publicCode: string; routing: RoutingView; eventHash: string } | null>(null);
  const { busy, error, run } = useAction();

  const where = photo?.gps ?? null;
  useEffect(() => {
    if (!where) return;
    run(async () => setRouting(await v5<RoutingView>(`/routing/resolve?lat=${where.lat}&lon=${where.lon}&accuracy=${where.accuracyM}`)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where?.lat, where?.lon]);

  const submit = () => run(async () => {
    if (!where || !photo) return;
    const best = [...photo.ai.detections].sort((a, b) => b.confidence - a.confidence)[0];
    setSent(await v5('/cases', { mode: 'SINGLE', evidenceIds: [photo.id], lat: where.lat, lon: where.lon, accuracyM: where.accuracyM, sizeBand: band, classGuess: best?.taxonomyCode ?? null }));
  });

  if (sent) return <SentCard sent={sent} />;
  return (
    <>
      <button type="button" className="v5-link" onClick={onBack}>Back</button>
      {!photo && (
        <Card>
          {demoEnabled && <DemoPlacePicker place={place} setPlace={setPlace} />}
          <Capture kind="OVERVIEW" purpose="REPORT" title="Point at the damage" hint="Step back. Show the whole lane." sampleId="pothole" demoPlace={place} onDone={setPhoto} />
        </Card>
      )}
      {photo && (
        <>
          <Card title="What the AI saw"><DetectionView evidence={photo} /></Card>
          <Card title="How big is it?">
            <div className="v5-bands" role="radiogroup" aria-label="Damage size">
              {BANDS.map((b) => (
                <button key={b.id} type="button" role="radio" aria-checked={band === b.id} className={band === b.id ? 'is-on' : ''} onClick={() => setBand(b.id)} data-testid={`v5-band-${b.id}`}><strong>{b.label}</strong><span>{b.note}</span></button>
              ))}
            </div>
            <p className="v5-caption">Your best guess is fine <Chip kind="INPUT" /> An inspector measures it on site. We never ask you for depth.</p>
          </Card>
          {routing && <RoutingCard routing={routing} />}
          <ErrorNote error={error} />
          <SendButton busy={busy || !routing} onClick={submit} />
        </>
      )}
    </>
  );
}

/** Replay used only in DEMO: a walk along Jl. Matraman Raya, about 6 m per second-tick, labelled. */
function sampleWalk(): Fix[] {
  const start = { lat: -6.2006, lon: 106.8574 };
  const t0 = Date.now();
  return Array.from({ length: 14 }, (_, i) => ({ lat: start.lat + i * 0.000045, lon: start.lon + i * 0.000012, accuracyM: 5, speedMps: 1.2, t: t0 + i * 4000 }));
}

function traceLength(points: Fix[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    const dy = (points[i].lat - points[i - 1].lat) * 111_320;
    const dx = (points[i].lon - points[i - 1].lon) * 111_320 * Math.cos((points[i].lat * Math.PI) / 180);
    m += Math.hypot(dx, dy);
  }
  return m;
}

function LongReport({ onBack }: { onBack: () => void }) {
  const { demoEnabled } = useV5();
  const { fix } = useGps();
  const [walking, setWalking] = useState(false);
  const [demoTrace, setDemoTrace] = useState(false);
  const [points, setPoints] = useState<Fix[]>([]);
  const [photos, setPhotos] = useState<EvidenceView[]>([]);
  const [shooting, setShooting] = useState(false);
  const [ended, setEnded] = useState(false);
  const [routing, setRouting] = useState<RoutingView | null>(null);
  const [sent, setSent] = useState<{ publicCode: string; routing: RoutingView; eventHash: string } | null>(null);
  const lastT = useRef(0);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (!walking || demoTrace || !fix || fix.t === lastT.current || fix.accuracyM > 20) return;
    lastT.current = fix.t;
    setPoints((p) => [...p, fix]);
  }, [fix, walking, demoTrace]);

  const lengthM = useMemo(() => traceLength(points), [points]);
  const start = points[0];
  const canEnd = photos.length >= 3 && lengthM >= 10;
  const nextPhotoIn = Math.max(0, Math.ceil((photos.length * 15) - lengthM));

  const finish = () => run(async () => {
    setWalking(false);
    setEnded(true);
    setRouting(await v5<RoutingView>(`/routing/resolve?lat=${start.lat}&lon=${start.lon}&accuracy=${start.accuracyM}`));
  });

  const submit = () => run(async () => {
    setSent(await v5('/cases', { mode: 'TRACE', evidenceIds: photos.map((p) => p.id), lat: start.lat, lon: start.lon, accuracyM: start.accuracyM, tracePoints: points, demoTrace, sizeBand: lengthM >= 200 ? 'T3' : lengthM >= 50 ? 'T2' : 'T1', classGuess: null }));
  });

  if (sent) return <SentCard sent={sent} />;
  return (
    <>
      <button type="button" className="v5-link" onClick={onBack}>Back</button>
      {!walking && !ended && (
        <Card title="Large or long damage">
          <p>Walk on the road edge or sidewalk. Do not stand in traffic. Stand at the start of the damage.</p>
          <p className="v5-gps" data-testid="v5-gps"><MapPin size={16} aria-hidden="true" /> {fix ? <>GPS accuracy {Math.round(fix.accuracyM)} m <Chip kind="MEASURED" /></> : 'Waiting for GPS…'}</p>
          <button type="button" className="v5-btn v5-btn-primary" disabled={!fix || fix.accuracyM > 20} onClick={() => { setPoints(fix ? [fix] : []); setWalking(true); setShooting(true); }} data-testid="v5-trace-start">Start walk</button>
          {demoEnabled && (
            <button type="button" className="v5-link" onClick={() => { setDemoTrace(true); setPoints(sampleWalk()); setWalking(true); setShooting(true); }} data-testid="v5-trace-sample">Use a sample walk (demo)</button>
          )}
        </Card>
      )}
      {walking && (
        <Card title="Walking" testId="v5-walking">
          {demoTrace && <p><Chip kind="DEMO" /> Sample walk, not a real trace.</p>}
          <p className="v5-big"><strong data-testid="v5-trace-length">{Math.round(lengthM)} m</strong> walked <Chip kind={demoTrace ? 'DEMO' : 'MEASURED'} title="Added up from GPS fixes" /> · {photos.length} photo{photos.length === 1 ? '' : 's'}</p>
          {!demoTrace && <p>{nextPhotoIn > 0 ? `Next photo in ${nextPhotoIn} m.` : 'Take a photo now.'} Keep the screen on.</p>}
          {shooting ? (
            <Capture kind="TRACE_POINT" purpose="REPORT" title={`Photo ${photos.length + 1}`} hint="Show the damage from where you stand." sampleId={photos.length % 2 ? 'pothole-2' : 'pothole'} demoPlace={start} onDone={(e) => { setPhotos((p) => [...p, e]); setShooting(false); }} />
          ) : (
            <div className="v5-row">
              <button type="button" className="v5-btn" onClick={() => setShooting(true)} data-testid="v5-trace-photo">Add photo</button>
              <button type="button" className="v5-btn v5-btn-primary" disabled={!canEnd} onClick={finish} data-testid="v5-trace-end">End</button>
            </div>
          )}
          {!canEnd && !shooting && <p className="v5-caption">End opens at 3 photos and 10 m.</p>}
        </Card>
      )}
      {ended && (
        <>
          <Card title="Your walk" testId="v5-walk-summary">
            <p className="v5-big"><strong>{Math.round(lengthM)} m</strong> of damage <Chip kind={demoTrace ? 'DEMO' : 'MEASURED'} /></p>
            <p>{photos.length} photos. Lane width 3.5 m until an inspector checks it <Chip kind="ASSUMED" title="Default lane width" /></p>
            {photos[0] && <DetectionView evidence={photos[0]} />}
          </Card>
          {routing && <RoutingCard routing={routing} />}
          <ErrorNote error={error} />
          <SendButton busy={busy || !routing} onClick={submit} />
        </>
      )}
    </>
  );
}

export interface PublicCase {
  publicCode: string;
  state: string;
  stateLabel: string;
  createdAt: string;
  mode: string;
  damageClass: string | null;
  sizeBand: string | null;
  captureTrust: string;
  isDemo: boolean;
  demoClockDays: number;
  routing: { segmentName: string | null; roadStatus: string; authorityName: string; officeName: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; basis: string; note: string | null } | null;
  pending: { code: string; until: string; note: string } | null;
  hazard: boolean;
  underTechnicalReview: boolean;
  trace: { lengthM: number; quality: string } | null;
  warrantyFlag: boolean;
  photos: { id: string; kind: string; stage: string | null; demo: boolean }[];
  followUps: { milestone: string; dueAt: string | null; trigger: string; result: string | null; recordedAt: string | null; due: boolean; overdue: boolean }[];
  confirmations: { stillFixed: number; brokeAgain: number };
  ladder: LadderView;
  complaintDraftAvailable: boolean;
  timeline: TimelineItem[];
}

const MILESTONE: Record<string, string> = { M1: '1 month', M3: '3 months', M6: '6 months', HEAVY_RAIN: 'After first heavy rain', PRE_FHO: 'Before maintenance ends', EVERY_6M: 'Every 6 months' };

export function FollowUps({ items }: { items: PublicCase['followUps'] }) {
  if (items.length === 0) return <p className="v5-muted">Follow-ups start after the repair is accepted.</p>;
  return (
    <>
      <ul className="v5-followups" data-testid="v5-followups">
        {items.map((f) => (
          <li key={f.milestone} data-milestone={f.milestone}>
            <strong>{MILESTONE[f.milestone] ?? f.milestone}</strong>
            <span>{f.dueAt ? dateOnly(f.dueAt) : 'When the rain comes'}{f.overdue ? ' · overdue' : f.due ? ' · due now' : ''}</span>
            <span className={f.result === 'OK' ? 'v5-good' : f.result ? 'v5-bad' : 'v5-muted'}>{f.result ?? 'Not yet'}</span>
          </li>
        ))}
      </ul>
      <p className="v5-caption">A literature-based schedule, not yet confirmed with Indonesian agencies <Chip kind="ASSUMED" /></p>
    </>
  );
}

export function TrackPage({ code }: { code: string }) {
  const { demoServer, demoEnabled, role } = useV5();
  const { data, error, setData, reload } = useLoad(() => v5<PublicCase>(`/public/track/${encodeURIComponent(code)}`), [code]);
  const action = useAction();
  const [askPhoto, setAskPhoto] = useState(false);

  if (error) return <Card title="Not found"><p>{error.message}</p></Card>;
  if (!data) return <Card><p>Loading…</p></Card>;
  const canConfirm = data.followUps.length > 0;

  const answer = (result: 'OK' | 'DAMAGED', evidenceIds: string[] = []) => action.run(async () => {
    setData(await v5<PublicCase>(`/public/track/${encodeURIComponent(code)}/confirm`, { result, evidenceIds }));
    setAskPhoto(false);
  });

  const forward = (days: number) => action.run(async () => setData(await v5<PublicCase>('/demo/fast-forward', { code, days })));

  return (
    <>
      <Card testId="v5-track-head">
        <p className="v5-eyebrow">Tracking code</p>
        <p className="v5-code" data-testid="v5-track-code">{data.publicCode}</p>
        <p className="v5-state" data-testid="v5-state-label">{data.stateLabel}</p>
        {data.isDemo && <p><Chip kind="DEMO" /> Sample environment, not a real report.</p>}
        {data.captureTrust === 'DEMO' && <p><strong>DEMO — not a live capture</strong></p>}
        {data.routing && <p>With <strong>{data.routing.officeName}</strong> · {data.routing.roadStatus.toLowerCase()} road <Confidence level={data.routing.confidence} /></p>}
        {data.routing?.confidence === 'LOW' && <p className="v5-warn">Coordinator to confirm.</p>}
        {data.trace && <p>Length {Math.round(data.trace.lengthM)} m <Chip kind="MEASURED" title={`GPS trace, quality ${data.trace.quality}`} /></p>}
        {data.pending && <p className="v5-warn">Delay reason: {data.pending.code.replace(/_/g, ' ').toLowerCase()}, until {dateOnly(data.pending.until)}.</p>}
        {data.hazard && <p className="v5-warn">Warning sign recorded at the site.</p>}
        {data.underTechnicalReview && <p className="v5-warn" data-testid="v5-under-review">Under technical review.</p>}
        {data.warrantyFlag && <p className="v5-warn">Damage appeared inside the maintenance period. A check by the agency is requested.</p>}
      </Card>

      {data.photos.length > 0 && (
        <Card title="Photos">
          <div className="v5-strip">
            {data.photos.map((p) => <img key={p.id} src={apiUrl(`/api/v5/evidence/${p.id}/image`)} alt={p.stage ? `Stage ${p.stage}` : 'Road damage'} loading="lazy" />)}
          </div>
          {data.photos.some((p) => p.demo) && <p className="v5-caption"><Chip kind="DEMO" /> Sample photos. Faces blurred, metadata removed.</p>}
        </Card>
      )}

      <Card title="Time waiting"><Ladder ladder={data.ladder} /></Card>

      {data.complaintDraftAvailable && (
        <Card title="Not handled for more than 14 days" testId="v5-complaint">
          <p>You can download a complaint draft for SP4N-LAPOR! or the Ombudsman. Nothing is sent for you.</p>
          <a className="v5-btn" href={apiUrl(`/api/v5/public/track/${encodeURIComponent(code)}/complaint-draft`)} data-testid="v5-complaint-link">Download draft</a>
        </Card>
      )}

      <Card title="After the repair">
        <FollowUps items={data.followUps} />
        {canConfirm && role === 'CITIZEN' && (
          <div className="v5-confirm" data-testid="v5-confirm">
            <p><strong>Is it still fixed?</strong> Still fixed: {data.confirmations.stillFixed}, broke again: {data.confirmations.brokeAgain} <Chip kind="INPUT" title="Answers from citizens. Indicative, not a field test." /></p>
            {askPhoto ? (
              <Capture kind="FOLLOW_UP" purpose="FOLLOW_UP" title="Show the damage" hint="A photo helps the agency check it." sampleId="pothole-2" onDone={(e) => answer('DAMAGED', [e.id])} />
            ) : (
              <div className="v5-row">
                <button type="button" className="v5-btn" disabled={action.busy} onClick={() => answer('OK')} data-testid="v5-still-fixed">Still fixed</button>
                <button type="button" className="v5-btn" disabled={action.busy} onClick={() => setAskPhoto(true)} data-testid="v5-broke-again">Broke again</button>
                <button type="button" className="v5-link" disabled={action.busy} onClick={() => answer('DAMAGED')} data-testid="v5-broke-no-photo">Broke again, no photo</button>
              </div>
            )}
          </div>
        )}
        {canConfirm && role !== 'CITIZEN' && <p className="v5-caption">Citizens answer "still fixed" or "broke again" here. Switch to Citizen to try it.</p>}
      </Card>

      <Card title="Full timeline"><Timeline items={data.timeline} /></Card>

      {demoServer && demoEnabled && (
        <Card title="Demo tool: fast-forward time" testId="v5-fast-forward">
          <p><Chip kind="DEMO" /> Only in demo mode. Adds days to this case's clock. The event log keeps the real time and records each jump.</p>
          {data.demoClockDays > 0 && <p data-testid="v5-clock-days">This case is {data.demoClockDays} days ahead.</p>}
          <div className="v5-row">
            {[2, 7, 14, 30].map((d) => <button key={d} type="button" className="v5-btn" disabled={action.busy} onClick={() => forward(d)} data-testid={`v5-ff-${d}`}>+{d} days</button>)}
            <button type="button" className="v5-link" onClick={reload}>Refresh</button>
          </div>
        </Card>
      )}
      <ErrorNote error={action.error} />
    </>
  );
}

export function MyReportsCard() {
  const { go } = useV5();
  const { data } = useLoad(() => v5<PublicCase[]>('/me/cases'));
  if (!data || data.length === 0) return null;
  return (
    <Card title="My reports">
      <ul className="v5-list">
        {data.map((c) => (
          <li key={c.publicCode}>
            <button type="button" onClick={() => go(`/v5/t/${c.publicCode}`)}><strong>{c.publicCode}</strong><span>{c.stateLabel} · {c.ladder.applies ? `${c.ladder.daysWaiting} days waiting` : 'clock stopped'} <Chip kind="COMPUTED" /></span></button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
