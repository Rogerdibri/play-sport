import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { readOfficialStandingGames, type OfficialStandingGame } from '@playsport/shared';

export default function usePublicOfficialGames(apiBase: string, enabled = true) {
  const [games, setGames] = useState<OfficialStandingGame[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let revision = 0;
    const controller = new AbortController();
    const load = async () => {
      const request = ++revision;
      try {
        const response = await fetch(`${apiBase}/standings`, { signal: controller.signal });
        if (!response.ok) throw new Error('No se pudieron consultar los partidos y resultados oficiales.');
        const next = readOfficialStandingGames(await response.json());
        if (active && request === revision) { setGames(next); setError(''); }
      } catch (failure) { if (active && request === revision) setError(failure instanceof Error ? failure.message : 'No se pudieron consultar los resultados oficiales.'); }
    };
    void load();
    const interval = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 5000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { active = false; controller.abort(); clearInterval(interval); listener.remove(); };
  }, [apiBase, enabled, retry]);
  return { games, error, refresh: () => setRetry(value => value + 1) };
}
