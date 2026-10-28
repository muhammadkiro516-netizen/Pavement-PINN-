import React from 'react';
import { Compass, Lock } from 'lucide-react';
import { Empty, SnapButton, SnapPage } from '../../components/ui/snap';
import { usePageHost } from '../../app/pageContext';
import type { RouteDefinition } from '../../app/routeConfig';

/** Unknown URL. */
export const NotFoundPage: React.FC = () => {
  const { closePage } = usePageHost();
  return (
    <SnapPage title="Tidak ditemukan">
      <Empty icon={<Compass className="h-6 w-6" />} title="Halaman ini tidak ada" text="Alamatnya mungkin salah ketik atau sudah dipindah." action={<SnapButton onClick={closePage}>Kembali ke beranda</SnapButton>} />
    </SnapPage>
  );
};

/** Known URL that the signed-in role may not open. */
export const ForbiddenPage: React.FC<{ route: RouteDefinition }> = ({ route }) => {
  const { closePage } = usePageHost();
  return (
    <SnapPage title="Akses dibatasi">
      <Empty icon={<Lock className="h-6 w-6" />} title={route.title} text="Halaman ini bukan untuk peran akun Anda." action={<SnapButton onClick={closePage}>Kembali ke beranda</SnapButton>} />
    </SnapPage>
  );
};
