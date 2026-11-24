'use client';
import { useEffect, useState } from 'react';
import type { AccountProfile } from '@playsport/shared';

export default function AccountAvatar({ account, size = 40 }: { account: AccountProfile; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [account.id, account.photo]);
  const parts = account.displayName.trim().split(/\s+/);
  const initials = `${parts[0]?.[0] ?? ''}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`.toUpperCase() || 'PS';
  return <span className="accountAvatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>
    {account.photo && !failed ? <img src={account.photo} alt={`Foto de ${account.displayName}`} width={size} height={size} onError={() => setFailed(true)} /> :
      <span role="img" aria-label={failed ? `No se pudo mostrar la foto de ${account.displayName}` : `${account.displayName} · sin foto`}>{initials}</span>}
    {failed ? <span className="accountAvatarError" role="status">Foto no disponible</span> : null}
  </span>;
}
