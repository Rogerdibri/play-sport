'use client';

import { useEffect, useState } from 'react';
import { readManagerTeamAccess, type ManagerTeamAccess } from '@playsport/shared';
import { accessRequest } from '../access/access-request';

export function useManagerTeamAccess(accountId?: string) {
  const [snapshot, setSnapshot] = useState<ManagerTeamAccess | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true, revision = 0;
    setSnapshot(null); setError('');
    if (!accountId) return;
    const load = async () => {
      const request = ++revision;
      try {
        const value = readManagerTeamAccess(await accessRequest('/api/sports-sheet/manager-teams'), accountId);
        if (active && revision === request) { setSnapshot(value); setError(''); }
      } catch (failure) {
        if (active && revision === request) {
          setSnapshot(null); setError(failure instanceof Error ? failure.message : 'No se pudieron verificar tus cupos de Manager.');
        }
      }
    };
    void load(); globalThis.addEventListener('focus', load);
    const timer = globalThis.setInterval(load, 30000);
    return () => { active = false; globalThis.removeEventListener('focus', load); globalThis.clearInterval(timer); };
  }, [accountId]);
  return { access: snapshot?.accountId === accountId ? snapshot : null, error };
}
