'use client';

import { useEffect, useState } from 'react';
import { readOfficialStandingGames, type OfficialStandingGame } from '@playsport/shared';

export default function usePublicOfficialGames() {
  const [games, setGames] = useState<OfficialStandingGame[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const controller = new AbortController();
    const load = async () => {
      const request = ++revision;
      try {
        const base = process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? '/api/official-scoring';
        const response = await fetch(`${base}/standings`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('No se pudieron consultar los partidos y resultados oficiales.');
        const next = readOfficialStandingGames(await response.json());
        if (active && request === revision) { setGames(next); setError(''); }
      } catch (failure) { if (active && request === revision) setError(failure instanceof Error ? failure.message : 'No se pudieron consultar los resultados oficiales.'); }
    };
    const visible = () => { if (!globalThis.document.hidden) void load(); };
    void load();
    const interval = setInterval(visible, 5000);
    globalThis.document.addEventListener('visibilitychange', visible);
    return () => { active = false; controller.abort(); clearInterval(interval); globalThis.document.removeEventListener('visibilitychange', visible); };
  }, [retry]);
  return { games, error, refresh: () => setRetry(value => value + 1) };
}
