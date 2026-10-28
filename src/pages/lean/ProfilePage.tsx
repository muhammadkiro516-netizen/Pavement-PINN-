import React, { useState } from 'react';
import { Pavi, PAVI_HELMETS } from '../../components/brand/Pavi';
import { readPaviHelmet, savePaviHelmet } from '../../components/brand/paviPrefs';
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
  const [helmet, setHelmet] = useState(readPaviHelmet);
  return (
    <SnapPage title="Profil">
      <SnapCard>
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-end justify-center overflow-hidden rounded-full bg-[#1E2229] ring-2 ring-[#FFD60A]/60">
            <Pavi size={58} helmet={helmet} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xl font-extrabold">{currentAccount.name}</p>
            <p className="truncate text-sm text-[#A1A1AA]">
              {currentAccount.email.endsWith('@perangkat.pavement-pinn.id') ? 'Akun warga yang tersimpan di HP ini' : currentAccount.email}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Pill tone="blue">{ROLE_NAME[currentAccount.role] ?? currentAccount.role}</Pill>
              {currentAccount.role !== 'PUBLIC_REPORTER' && <Pill>{currentAccount.agency}</Pill>}
            </div>
          </div>
        </div>
      </SnapCard>
      <SnapCard>
        <p className="font-extrabold">Warna helm Pavi</p>
        <p className="text-sm text-[#A1A1AA]">Pavi menandai posisi Anda di peta.</p>
        <div className="mt-3 flex gap-3">
          {PAVI_HELMETS.map((c) => (
            <button key={c} type="button" aria-label={`Helm ${c}`} onClick={() => { setHelmet(c); savePaviHelmet(c); }}
              className={`h-10 w-10 cursor-pointer rounded-full transition ${helmet === c ? 'scale-110 ring-2 ring-[#FFFFFF] ring-offset-2 ring-offset-[#15181D]' : ''}`} style={{ background: c }} />
          ))}
        </div>
      </SnapCard>
      <SnapCard onClick={() => navigateTo('evidence')}>
        <div className="flex items-center gap-3">
          <span className="text-[#FFD60A]"><Glyph name="shield" size={26} /></span>
          <div>
            <p className="font-extrabold">Bukti & transparansi AI</p>
            <p className="text-sm text-[#A1A1AA]">Model yang dipakai, akurasi, kecepatan, privasi, dan batasannya.</p>
          </div>
        </div>
      </SnapCard>
      {expiresAt && <p className="px-1 text-xs text-[#6E6E73]">Sesi berakhir otomatis pukul {new Date(expiresAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.</p>}
      <SnapButton variant="ghost" onClick={logout} className="w-full">
        <Glyph name="logout" size={18} /> Keluar
      </SnapButton>
    </SnapPage>
  );
};
