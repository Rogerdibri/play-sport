'use client';

import { useEffect, useState } from 'react';
import { demoProfilesKey, readDemoProfiles } from '@playsport/shared';
import { usePlatformSession } from './platform-session';
import { demoIdentity, sessionIdentityLabel } from './platform-navigation';

export default function SessionIdentity() {
  const { session, account, reportNavigationError } = usePlatformSession();
  const owner = session ? demoIdentity(session).id : '';
  const [profile, setProfile] = useState({ owner: '', name: '' });
  useEffect(() => {
    if (account || !owner) return;
    const load = () => {
      try {
        const document = readDemoProfiles(globalThis.localStorage.getItem(demoProfilesKey));
        setProfile({ owner, name: document.saved.find(item => item.accountId === owner)?.fullName ?? '' });
      } catch (failure) {
        reportNavigationError(failure instanceof Error ? failure.message : 'No se pudo recuperar el nombre de tu perfil.');
      }
    };
    const storage = (event: globalThis.StorageEvent) => { if (event.key === demoProfilesKey || event.key === null) load(); };
    load();
    globalThis.addEventListener('focus', load);
    globalThis.addEventListener('storage', storage);
    return () => { globalThis.removeEventListener('focus', load); globalThis.removeEventListener('storage', storage); };
  }, [account, session, owner, reportNavigationError]);
  return session ? <>{sessionIdentityLabel(session, account, profile.owner === owner ? profile.name : '')}</> : null;
}
