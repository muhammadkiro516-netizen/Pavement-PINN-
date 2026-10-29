/**
 * "Lapor Offline": a report that could not reach the server (no signal) is kept on the device in
 * IndexedDB and sent when the connection returns. The GPS point and time are the ones taken at
 * the damage site; the AI analysis runs on the server once the report arrives.
 */
import type { DamageReport } from '../../types';

const DB = 'pp-offline';
const STORE = 'reports';
export const OFFLINE_EVENT = 'pp-offline-queue';

export interface QueuedReport {
  key: string;
  queuedAt: string;
  report: DamageReport;
}

function open(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((ok, fail) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

const notify = () => window.dispatchEvent(new Event(OFFLINE_EVENT));

export async function enqueueReport(report: DamageReport): Promise<void> {
  // A queued report never carries an analysis id: the session-bound analysis may expire meanwhile.
  const { cvAnalysisId: _drop, ...rest } = report as DamageReport & { cvAnalysisId?: string };
  await tx('readwrite', (s) => s.put({ key: report.id, queuedAt: new Date().toISOString(), report: rest as DamageReport }));
  notify();
}

export async function queuedReports(): Promise<QueuedReport[]> {
  try {
    return await tx<QueuedReport[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedReport[]>);
  } catch {
    return [];
  }
}

export async function removeQueued(key: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(key));
  notify();
}

/** Sends every queued report; keeps the ones that still fail on the network. Returns the number sent. */
export async function flushQueue(send: (r: DamageReport) => Promise<{ ok: boolean; code?: string }>): Promise<number> {
  let sent = 0;
  for (const q of await queuedReports()) {
    const out = await send(q.report);
    if (out.ok) {
      await removeQueued(q.key);
      sent += 1;
    } else if (out.code === 'NETWORK') {
      break;
    } else {
      // Rejected by the server (validation, duplicate): drop it so it does not retry forever.
      await removeQueued(q.key);
    }
  }
  return sent;
}
