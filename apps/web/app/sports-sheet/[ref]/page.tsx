'use client';

import { useEffect, useState, use } from 'react';
import { readPublicSportsSheet, type PublicSportsSheet } from '@playsport/shared';
import SportsSheetView from '../sports-sheet-view';

export default function PublishedSportsSheet({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = use(params);
  const [sheet, setSheet] = useState<PublicSportsSheet | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let revision = 0;
    setSheet(null); setError('');
    const load = async () => {
      const request = ++revision;
      try {
        const response = await fetch(`/api/sports-sheet/public/${encodeURIComponent(ref)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(response.status === 404 ? 'Esta hoja deportiva no está publicada.' : 'No se pudo consultar la hoja deportiva.');
        const value = readPublicSportsSheet(body);
        if (active && request === revision) { setSheet(value); setError(''); }
      } catch (failure) {
        if (active && request === revision) {
          setSheet(null); setError(failure instanceof Error ? failure.message : 'No se pudo consultar la hoja deportiva.');
        }
      }
    };
    void load();
    globalThis.addEventListener('focus', load);
    const interval = globalThis.setInterval(load, 30000);
    return () => { active = false; globalThis.removeEventListener('focus', load); globalThis.clearInterval(interval); };
  }, [ref, attempt]);
  return <main className="moduleView sportsSheet"><header className="moduleHeader"><h1>Hoja deportiva</h1><p>Versión deportiva compartida por su titular.</p></header>
    {error ? <section className="managerCard managerStepCard"><p role="alert" className="managerWarning">{error}</p>
      <button className="managerButtonOutline" onClick={() => setAttempt(value => value + 1)}>Reintentar</button></section> :
      sheet ? <SportsSheetView key={ref} sheet={sheet} /> : <p role="status">Consultando hoja deportiva…</p>}
  </main>;
}
