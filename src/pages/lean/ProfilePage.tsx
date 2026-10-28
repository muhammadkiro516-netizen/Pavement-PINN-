import React from 'react';
import { LogOut, ShieldCheck } from 'lucide-react';
import { Pill, SnapButton, SnapCard, SnapPage } from '../../components/ui/snap';
import { usePageHost } from '../../app/pageContext';
import { useSession } from '../../app/providers/SessionProvider';
import { useRouter } from '../../app/router';

const ROLE_NAME: Record<string, string> = { PUBLIC_REPORTER: 'Warga', FIELD_ENGINEER: 'Petugas Lapangan', OPERATIONS_MANAGER: 'Koordinator' };

/** Route /profil/ — who is signed in, the transparency page, sign out. */
export const ProfilePage: React.FC = () => {
  const { currentAccount, expiresAt } = useSession();
  const { logout } = usePageHost();
  const { navigateTo } = useRouter();
  return (
    <SnapPage title="Profil">
      <SnapCard>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#FFE14D] text-2xl font-extrabold text-black">
            {currentAccount.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xl font-extrabold">{currentAccount.name}</p>
            <p className="truncate text-sm text-white/60">{currentAccount.email}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Pill tone="yellow">{ROLE_NAME[currentAccount.role] ?? currentAccount.role}</Pill>
              {currentAccount.role !== 'PUBLIC_REPORTER' && <Pill>{currentAccount.agency}</Pill>}
            </div>
          </div>
        </div>
      </SnapCard>
      <SnapCard onClick={() => navigateTo('evidence')}>
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-[#FFE14D]" />
          <div>
            <p className="font-extrabold">Bukti & transparansi AI</p>
            <p className="text-sm text-white/60">Model yang dipakai, akurasi, kecepatan, privasi, dan batasannya.</p>
          </div>
        </div>
      </SnapCard>
      {expiresAt && <p className="px-1 text-xs text-white/40">Sesi berakhir otomatis pukul {new Date(expiresAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.</p>}
      <SnapButton variant="ghost" onClick={logout} className="w-full">
        <LogOut className="h-4 w-4" /> Keluar
      </SnapButton>
    </SnapPage>
  );
};
