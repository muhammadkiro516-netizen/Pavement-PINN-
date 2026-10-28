/**
 * Citizens report without filling in anything: the first report creates a citizen account
 * whose random credentials are kept on this device (localStorage). Opening the site again on
 * the same phone signs the citizen back in, so "Laporanku" keeps their reports.
 *
 * Not an IP address: IPs change (Wi-Fi vs mobile data) and are shared by many people, which
 * would mix reports of strangers. Clearing the browser data forgets the device account.
 */
import type { SignedIn, WorkflowGateway } from '../../services/api/workflowClient';

const KEY = 'pavement-pinn.device-account.v1';

interface DeviceCredential {
  email: string;
  password: string;
}

function random(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function readDeviceCredential(): DeviceCredential | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as DeviceCredential) : null;
    return v && typeof v.email === 'string' && typeof v.password === 'string' ? v : null;
  } catch {
    return null;
  }
}

function writeDeviceCredential(v: DeviceCredential | null): void {
  try {
    if (v) window.localStorage.setItem(KEY, JSON.stringify(v));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked (private mode): the account lives for this visit only.
  }
}

/** Sign this device's citizen in, creating the device account on first use. */
export async function signInCitizenDevice(gateway: WorkflowGateway): Promise<SignedIn> {
  const saved = readDeviceCredential();
  if (saved) {
    try {
      return await gateway.login({ username: saved.email, password: saved.password });
    } catch {
      writeDeviceCredential(null); // account gone or deactivated: start a new one below
    }
  }
  const credential = { email: `warga-${random(6)}@perangkat.pavement-pinn.id`, password: random(16) };
  const signed = await gateway.register({ ...credential, name: 'Warga' });
  writeDeviceCredential(credential);
  return signed;
}
