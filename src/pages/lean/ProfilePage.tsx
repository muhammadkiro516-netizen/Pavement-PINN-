import React, { useState } from 'react';
import { Pavi, PAVI_HELMETS, PAVI_VESTS } from '../../components/brand/Pavi';
import { PAVI_FACES, readPavi, savePavi, type PaviAvatar } from '../../components/brand/paviPrefs';
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
  const [avatar, setAvatar] = useState<PaviAvatar>(readPavi);
  const update = (next: Partial<PaviAvatar>) => setAvatar((a) => { const v = { ...a, ...next }; savePavi(v); return v; });
  return (
    <SnapPage title="Profil">
      <SnapCard>
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-end justify-center overflow-hidden rounded-full bg-[#1E2229] ring-2 ring-[#FFD60A]/60">
            <Pavi size={58} helmet={avatar.helmet} vest={avatar.vest} mood={avatar.mood} />
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
        <div className="flex items-center gap-4">
          <div className="pp-rise grid h-28 w-24 shrink-0 place-items-end rounded-3xl bg-gradient-to-b from-[#1E2229] to-[#0B0D10]"><Pavi size={84} helmet={avatar.helmet} vest={avatar.vest} mood={avatar.mood} /></div>
          <div className="min-w-0">
            <p className="font-extrabold">Avatar Pavi</p>
            <p className="text-sm text-[#A1A1AA]">Opsional. Pavi menandai posisi Anda di peta dan ikut di kartu dampak.</p>
          </div>
        </div>
        {([['Helm', PAVI_HELMETS, 'helmet'], ['Rompi', PAVI_VESTS, 'vest']] as const).map(([label, colors, key]) => (
          <div key={key} className="mt-3">
            <p className="text-xs font-bold text-[#FFFFFF]/55">{label}</p>
            <div className="mt-1.5 flex gap-3">
              {colors.map((c) => (
                <button key={c} type="button" aria-label={`${label} ${c}`} onClick={() => update({ [key]: c })}
                  className={`h-10 w-10 cursor-pointer rounded-full border border-[#FFFFFF]/15 transition ${avatar[key] === c ? 'scale-110 ring-2 ring-[#FFFFFF] ring-offset-2 ring-offset-[#15181D]' : ''}`} style={{ background: c }} />
              ))}
            </div>
          </div>
        ))}
        <p className="mt-3 text-xs font-bold text-[#FFFFFF]/55">Ekspresi</p>
        <div className="mt-1.5 flex gap-2">
          {PAVI_FACES.map((m) => (
            <button key={m} type="button" aria-label={`Ekspresi ${m}`} onClick={() => update({ mood: m })}
              className={`grid h-14 w-12 cursor-pointer place-items-end rounded-2xl bg-[#FFFFFF]/5 transition ${avatar.mood === m ? 'scale-110 ring-2 ring-[#FFFFFF] ring-offset-2 ring-offset-[#15181D]' : ''}`}>
              <Pavi size={36} helmet={avatar.helmet} vest={avatar.vest} mood={m} />
            </button>
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
