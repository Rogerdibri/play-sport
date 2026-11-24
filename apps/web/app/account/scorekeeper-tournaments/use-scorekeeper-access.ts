'use client';

import { useEffect, useState } from 'react';
import { readScorekeeperAccess, type ScorekeeperAccess } from '@playsport/shared';
import { accessRequest } from '../access/access-request';

export function useScorekeeperAccess(accountId?: string) {
  const [access, setAccess] = useState<ScorekeeperAccess | null>(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true, generation = 0;
    setAccess(null); setError('');
    if (!accountId) return;
    const load = async () => {
      const request = ++generation;
      try {
        const next = readScorekeeperAccess(await accessRequest('/api/sports-sheet/scorekeeper-tournaments'), accountId);
        if (active && generation === request) { setAccess(next); setError(''); }
      } catch (failure) {
        if (active && generation === request) { setAccess(null); setError(failure instanceof Error ? failure.message : 'No se pudieron consultar tus cupos de Anotador.'); }
      }
    };
    void load(); globalThis.addEventListener('focus', load);
    const timer = globalThis.setInterval(load, 30000);
    return () => { active = false; globalThis.removeEventListener('focus', load); globalThis.clearInterval(timer); };
  }, [accountId, attempt]);
  return { access: access?.accountId === accountId ? access : null, error, refresh: () => setAttempt(value => value + 1) };
}
