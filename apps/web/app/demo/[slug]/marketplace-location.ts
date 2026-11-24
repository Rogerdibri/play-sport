'use client';

import { useEffect, useState } from 'react';
import { DemoProfileStore, demoProfilesKey, type ProfileLocation } from '@playsport/shared';
import { demoIdentity } from '../../platform-navigation';
import { usePlatformSession } from '../../platform-session';

export function savedMarketplaceLocation(
  saved: readonly { accountId: string; location: ProfileLocation }[], profileId: string | null
): ProfileLocation | null {
  const location = profileId ? saved.find(profile => profile.accountId === profileId)?.location : null;
  return location ? { ...location } : null;
}

export function useMarketplaceProfileLocation() {
  const { session } = usePlatformSession();
  const profileId = session ? demoIdentity(session).id : null;
  const [result, setResult] = useState<{ profileId: string | null; location: ProfileLocation | null; ready: boolean; error: string }>({
    profileId: null, location: null, ready: false, error: ''
  });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const store = new DemoProfileStore({
          getItem: async key => globalThis.localStorage.getItem(key),
          setItem: async (key, value) => { globalThis.localStorage.setItem(key, value); }
        });
        const location = profileId ? savedMarketplaceLocation((await store.load()).saved, profileId) : null;
        if (active) setResult({ profileId, location, ready: true, error: '' });
      } catch (failure) {
        if (active) setResult({ profileId, location: null, ready: true,
          error: failure instanceof Error ? failure.message : 'No se pudo recuperar la ubicación de tu perfil.' });
      }
    };
    const changed = (event: { key: string | null }) => { if (event.key === demoProfilesKey || event.key === null) void load(); };
    void load(); globalThis.addEventListener('storage', changed);
    return () => { active = false; globalThis.removeEventListener('storage', changed); };
  }, [profileId, retry]);
  return {
    location: result.profileId === profileId ? result.location : null,
    ready: result.profileId === profileId && result.ready,
    error: result.profileId === profileId ? result.error : '',
    retry: () => setRetry(value => value + 1)
  };
}
