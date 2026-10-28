import React from 'react';
import { Glyph } from '../../components/ui/brand';
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
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#1463FF] text-2xl font-extrabold text-[#FFFFFF]">
            {currentAccount.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xl font-extrabold">{currentAccount.name}</p>
            <p className="truncate text-sm text-[#5B6B7F]">
              {currentAccount.email.endsWith('@perangkat.pavement-pinn.id') ? 'Akun warga yang tersimpan di HP ini' : currentAccount.email}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Pill tone="blue">{ROLE_NAME[currentAccount.role] ?? currentAccount.role}</Pill>
              {currentAccount.role !== 'PUBLIC_REPORTER' && <Pill>{currentAccount.agency}</Pill>}
            </div>
          </div>
        </div>
      </SnapCard>
      <SnapCard onClick={() => navigateTo('evidence')}>
        <div className="flex items-center gap-3">
          <span className="text-[#1463FF]"><Glyph name="shield" size={26} /></span>
          <div>
            <p className="font-extrabold">Bukti & transparansi AI</p>
            <p className="text-sm text-[#5B6B7F]">Model yang dipakai, akurasi, kecepatan, privasi, dan batasannya.</p>
          </div>
        </div>
      </SnapCard>
      {expiresAt && <p className="px-1 text-xs text-[#9AA7B8]">Sesi berakhir otomatis pukul {new Date(expiresAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.</p>}
      <SnapButton variant="ghost" onClick={logout} className="w-full">
        <Glyph name="logout" size={18} /> Keluar
      </SnapButton>
    </SnapPage>
  );
};
