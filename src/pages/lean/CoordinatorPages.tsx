/**
 * Koordinator tabs: Statistik (impact + AI quality from real records) and Tim (staff accounts).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Glyph } from '../../components/ui/brand';
import { Empty, Pill, SnapButton, SnapCard, SnapInput, SnapPage, Stat } from '../../components/ui/snap';
import { useAppState } from '../../app/providers/AppStateProvider';
import { useSession } from '../../app/providers/SessionProvider';
import { impactStats } from '../../domain/workflow/impactStats';
import type { ReportCase } from '../../domain/workflow/model';
import { apiUrl } from '../../services/api/client';
import { WORKFLOW_API_PATHS, type AccountProfile } from '../../types';
import { RepairHistory } from '../../features/road-intelligence/RepairHistory';
import { AuditFlagsPanel, FairCostCalculator } from '../../features/audit/RoadAuditPanel';

const pct = (a: number, b: number) => (b === 0 ? '–' : `${Math.round((a / b) * 100)}%`);

const AuditPanels: React.FC = () => {
  const { currentAccount } = useSession();
  return (
    <>
      <AuditFlagsPanel role={currentAccount.role} />
      <FairCostCalculator />
    </>
  );
};

export const StatsPage: React.FC = () => {
  const { workflow } = useAppState();
  const cases = useMemo(
    () => Object.values(workflow.views).filter((v) => v.audience === 'STAFF').map((v) => v.case as ReportCase),
    [workflow.views]
  );
  const s = useMemo(() => impactStats(cases), [cases]);

  if (s.total === 0) {
    return (
      <SnapPage title="Statistik" subtitle="Dampak penanganan dan kualitas AI, dihitung dari data nyata.">
        <Empty icon={<Glyph name="chart" size={26} />} title="Belum ada data" text="Angka muncul setelah warga mulai melapor. Tidak ada angka contoh." />
      </SnapPage>
    );
  }

  return (
    <SnapPage title="Statistik" subtitle="Dampak penanganan dan kualitas AI, dihitung dari data nyata.">
      <div className="grid grid-cols-2 gap-3">
        <Stat value={s.total} label="Laporan masuk" />
        <Stat value={s.open} label="Masih ditangani" />
        <Stat value={s.resolved} label="Sudah diperbaiki" />
        <Stat
          value={s.medianDaysToResolve === null ? '–' : `${s.medianDaysToResolve.toFixed(1)} hr`}
          label="Waktu perbaikan"
          hint="median, dari laporan sampai perbaikan terverifikasi"
        />
      </div>
      <RepairHistory title="Umur perbaikan (semua ruas)" />
      <AuditPanels />
      <h2 className="pt-3 text-lg font-extrabold">Kualitas AI</h2>
      <div className="grid grid-cols-2 gap-3">
        <Stat value={pct(s.aiAutoPassed, s.aiScreened)} label="Lolos otomatis" hint={`${s.aiAutoPassed} dari ${s.aiScreened} laporan yang dianalisis AI`} />
        <Stat value={pct(s.fieldAccepted, s.fieldReviewed)} label="Akurasi lapangan" hint={`AI dibenarkan petugas pada ${s.fieldAccepted} dari ${s.fieldReviewed} inspeksi`} />
        <Stat value={s.overrides} label="Keputusan berbeda dari AI" hint="dicatat dengan alasan; bahan perbaikan model" />
        <Stat value={s.reworks} label="Perbaikan diulang" hint="bukti perbaikan yang ditolak Koordinator" />
      </div>
      {Object.keys(s.perClass).length > 0 && (
        <SnapCard>
          <p className="mb-2 font-extrabold">Akurasi per jenis kerusakan</p>
          {Object.entries(s.perClass).map(([cls, [ok, n]]) => (
            <div key={cls} className="flex items-center justify-between border-t border-[#2A2F37] py-2 text-sm">
              <span>{cls}</span>
              <span className="font-bold">
                {pct(ok, n)} <span className="font-normal text-[#8E8E93]">({ok}/{n})</span>
              </span>
            </div>
          ))}
        </SnapCard>
      )}
    </SnapPage>
  );
};

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  return json as T;
}

const ROLE_NAME: Record<string, string> = { FIELD_ENGINEER: 'Petugas Lapangan', OPERATIONS_MANAGER: 'Koordinator', POLICY_MAKER: 'Pimpinan Instansi' };

export const TeamPage: React.FC = () => {
  const { currentAccount } = useSession();
  const [staff, setStaff] = useState<AccountProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'FIELD_ENGINEER', agency: currentAccount.agency ?? '' });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setStaff((await api<{ items: AccountProfile[] }>('GET', WORKFLOW_API_PATHS.staff)).items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', WORKFLOW_API_PATHS.staff, form);
      setForm((f) => ({ ...f, name: '', email: '', password: '' }));
      setOpen(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (a: AccountProfile) => {
    try {
      await api('POST', WORKFLOW_API_PATHS.staffActive.replace(':id', a.id), { active: !a.active });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <SnapPage
      title="Tim"
      subtitle="Akun petugas lapangan dan koordinator instansi Anda."
      action={<SnapButton onClick={() => setOpen((v) => !v)}><Glyph name="plus" size={18} /> Tambah</SnapButton>}
    >
      {error && <p className="rounded-2xl bg-[#3A1416] p-3 text-sm text-[#FF6B6B]">{error}</p>}
      {open && (
        <SnapCard>
          <form onSubmit={create} className="space-y-3">
            <SnapInput id="s-name" label="Nama" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <SnapInput id="s-email" label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <SnapInput id="s-pass" label="Kata sandi awal (min. 8)" type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            <SnapInput id="s-agency" label="Instansi" value={form.agency} onChange={(e) => setForm({ ...form, agency: e.target.value })} required />
            <div className="flex gap-2">
              {Object.entries(ROLE_NAME).map(([role, label]) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setForm({ ...form, role })}
                  className={`flex-1 cursor-pointer rounded-2xl px-3 py-3 text-sm font-bold ${form.role === role ? 'bg-[#FFD60A] text-[#0B0D10]' : 'bg-[#1E2229] text-[#FFFFFF]'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <SnapButton type="submit" disabled={busy} className="w-full">Buat akun</SnapButton>
          </form>
        </SnapCard>
      )}
      {staff.length === 0 ? (
        <Empty icon={<Glyph name="team" size={26} />} title="Belum ada petugas" text="Tambahkan petugas lapangan agar laporan bisa ditugaskan untuk diinspeksi." />
      ) : (
        staff.map((a) => (
          <SnapCard key={a.id}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-extrabold">{a.name}</p>
                <p className="truncate text-xs text-[#8E8E93]">{a.email} · {a.agency}</p>
                <div className="mt-1.5 flex gap-2">
                  <Pill tone="blue">{ROLE_NAME[a.role] ?? a.role}</Pill>
                  {!a.active && <Pill tone="red">Nonaktif</Pill>}
                </div>
              </div>
              {a.id !== currentAccount.id && (
                <SnapButton variant="ghost" onClick={() => void toggle(a)}>{a.active ? 'Nonaktifkan' : 'Aktifkan'}</SnapButton>
              )}
            </div>
          </SnapCard>
        ))
      )}
    </SnapPage>
  );
};
