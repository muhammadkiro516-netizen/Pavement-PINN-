/** A citizen is a pseudonymous device identity (02 C-1). Staff sign in through server/v6/workspaces.ts. */
import type { V5Actor } from '../../src/domain/v5/model';

export function deviceActor(deviceId: string): V5Actor {
  return { kind: 'DEVICE', accountId: deviceId, personId: null, role: 'CITIZEN', scope: [] };
}
