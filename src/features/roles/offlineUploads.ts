/**
 * Field photos taken with no signal wait on the phone and go up when it returns (docs/v6 §2.5). The server marks
 * them as queued, because its one-time code and clock only meet the photo after the fact.
 */
export interface QueuedUpload {
  key: string;
  body: Record<string, unknown>;
  purpose: string;
}

const DB = 'pp-v6-uploads';
const STORE = 'queue';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const uploadKey = (kind: string, stage?: string, caseId?: string) => `${caseId ?? '-'}|${kind}|${stage ?? '-'}`;
export const saveUpload = (item: QueuedUpload) => tx('readwrite', (s) => s.put(item));
export const readUpload = (key: string) => tx<QueuedUpload | undefined>('readonly', (s) => s.get(key));
export const dropUpload = (key: string) => tx('readwrite', (s) => s.delete(key));
