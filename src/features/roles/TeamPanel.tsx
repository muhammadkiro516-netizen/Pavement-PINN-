/** Team & Codes (docs/v6/V6_UPDATE_TWO_PORTALS.md §2.5): the OM manages; the Auditor reads the log. */
import { useState } from 'react';
import { V6_ROLE_NAMES, type V6Role } from '../../domain/v6/roles';
import { v6 } from './api';
import { useV5 } from './context';
import { Card, ErrorNote, useAction, useLoad } from './ui';

interface Member { id: string; name: string; title: string; role: V6Role; status: string; codeStatus: string; lastSeen: string | null; hasPin: boolean }
interface LogRow { at: string; name: string | null; result: string; device: string }
export interface Badge { code: string; url: string; qr: string }

const RESULT: Record<string, string> = { OK: 'Masuk', BAD_CODE: 'Kode salah', BAD_PIN: 'PIN salah', LOCKED: 'Terkunci', PIN_SET: 'Membuat PIN', LOCKED_BY_USER: 'Mengunci sesi', PIN_CHECK_OK: 'PIN aksi penting benar', PIN_CHECK_BAD: 'PIN aksi penting salah' };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : 'Belum pernah');

/** Shown once: the server keeps only a hash, so this is the moment to print or save it. */
export function AccessBadge({ badge, title }: { badge: Badge; title: string }) {
  return (
    <Card title={title} testId="v6-badge">
      <div className="v6-badge">
        <img src={badge.qr} alt={`Kode QR untuk ${badge.code}`} />
        <code data-testid="v6-badge-code">{badge.code}</code>
      </div>
      <p className="v5-muted">Kode ini hanya tampil sekali. Cetak atau simpan sekarang, lalu berikan langsung ke orangnya.</p>
      <button type="button" className="v5-btn" onClick={() => window.print()}>Cetak</button>
    </Card>
  );
}

export function TeamPanel() {
  const { v6Role } = useV5();
  const manages = v6Role === 'OM';
  const team = useLoad(() => v6<Member[]>('/team'), []);
  const log = useLoad(() => v6<LogRow[]>('/team/log'), []);
  const action = useAction();
  const [badge, setBadge] = useState<{ badge: Badge; title: string } | null>(null);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [role, setRole] = useState<V6Role>('FE');
  const refresh = () => { team.reload(); log.reload(); };

  const add = () => action.run(async () => {
    const out = await v6<{ badge: Badge }>('/team', { name, title, role });
    setBadge({ badge: out.badge, title: `Kode untuk ${name}` });
    setName('');
    setTitle('');
    refresh();
  });
  const renew = (m: Member) => action.run(async () => {
    const out = await v6<{ badge: Badge }>(`/team/${m.id}/renew`, {});
    setBadge({ badge: out.badge, title: `Kode baru untuk ${m.name}` });
    refresh();
  });
  const revoke = (m: Member) => action.run(async () => {
    await v6(`/team/${m.id}/revoke`, {});
    refresh();
  });

  return (
    <>
      {badge && <AccessBadge badge={badge.badge} title={badge.title} />}
      {manages && (
        <Card title="Tambah staf">
          <label className="v5-field"><span>Nama</span><input value={name} onChange={(e) => setName(e.target.value)} data-testid="v6-staff-name" /></label>
          <label className="v5-field"><span>Jabatan</span><input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="v6-staff-title" /></label>
          <label className="v5-field"><span>Peran</span>
            <select value={role} onChange={(e) => setRole(e.target.value as V6Role)} data-testid="v6-staff-role">
              {(['OM', 'FE', 'AUDITOR'] as const).map((r) => <option key={r} value={r}>{V6_ROLE_NAMES[r].id}</option>)}
            </select>
          </label>
          <button type="button" className="v5-btn v5-btn-primary" disabled={action.busy || name.trim().length < 2} onClick={add} data-testid="v6-staff-add">Terbitkan kode</button>
          <ErrorNote error={action.error} />
        </Card>
      )}
      <Card title="Staf" testId="v6-team">
        {team.error && <p>{team.error.message}</p>}
        {(team.data ?? []).map((m) => (
          <div key={m.id} className="v6-row" data-testid={`v6-member-${m.id}`}>
            <div>
              <strong>{m.name}</strong> · <span style={{ color: V6_ROLE_NAMES[m.role].color }}>{V6_ROLE_NAMES[m.role].short}</span>
              <div className="v5-muted">{m.title} · {m.status === 'ACTIVE' ? `Terakhir aktif: ${when(m.lastSeen)}` : 'Dicabut'}</div>
            </div>
            {manages && m.status === 'ACTIVE' && m.role !== 'CONTRACTOR' && (
              <span>
                <button type="button" className="v5-link" disabled={action.busy} onClick={() => renew(m)} data-testid={`v6-renew-${m.id}`}>Perbarui kode</button>{' '}
                <button type="button" className="v5-link" disabled={action.busy} onClick={() => revoke(m)} data-testid={`v6-revoke-${m.id}`}>Cabut</button>
              </span>
            )}
          </div>
        ))}
      </Card>
      <Card title="Log masuk" testId="v6-login-log">
        {(log.data ?? []).slice(0, 30).map((l, i) => (
          <div key={i} className="v6-row">
            <div><strong>{l.name ?? 'Tidak dikenal'}</strong> · {RESULT[l.result] ?? l.result}<div className="v5-muted">{l.device}</div></div>
            <span className="v5-muted">{when(l.at)}</span>
          </div>
        ))}
      </Card>
    </>
  );
}
