/** One real workspace for API tests: the people the v5 walkthroughs used, under their v6 roles. */
import path from 'node:path';
import { Workspaces } from '../../server/v6/workspaces';
import type { V6Role } from '../../src/domain/v6/roles';

export const TEST_PIN = '482916';
export const TEST_AGENCY = 'AGENCY-TEST';

const ROSTER: { id: string; role: V6Role; personId?: string }[] = [
  { id: 'ACC-COORD', role: 'OM' },
  { id: 'ACC-APPROVE', role: 'OM' },
  { id: 'ACC-HEAD', role: 'OM' },
  { id: 'ACC-ADMIN', role: 'OM' },
  { id: 'ACC-INSPECT', role: 'FE', personId: 'P-INSPECT' },
  { id: 'ACC-SUPERVISE', role: 'FE' },
  { id: 'ACC-AUDIT', role: 'AUDITOR' },
  // One person with a second post: the server still refuses their own plan (SOD-2).
  { id: 'ACC-INSPECT-AS-APPROVER', role: 'OM', personId: 'P-INSPECT' }
];

export function seedWorkspace(dataDir: string): Record<string, string> {
  const spaces = new Workspaces(path.join(dataDir, 'v6'));
  const now = new Date().toISOString();
  spaces.upsertAgency({ id: TEST_AGENCY, name: 'Instansi Uji', kind: 'PROVINSI', authorityIds: ['pemprov-dki', 'kementerian-pu', 'pemprov-jabar', 'pemkab-karawang', 'unrouted', 'AUTH-JKT-PROV'], region: '31', logoUri: null, contact: '', slaDays: 7, sessionHours: 12 }, [{ adminArea: '*', roadStatus: '*', decreeRefs: [], priority: 0 }]);
  const codes: Record<string, string> = {};
  for (const r of ROSTER) {
    const { code } = spaces.addMember({ agencyId: TEST_AGENCY, name: `Uji ${r.id}`, title: 'Uji', role: r.role, id: r.id, personId: r.personId }, now);
    spaces.setPin(r.id, TEST_PIN);
    codes[r.id] = code;
  }
  return codes;
}
