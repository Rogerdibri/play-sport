'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountScorecardClient, FriendlyClient, fieldPositionLabels, readPrivateSave, replayPrivate, linkScorecardParticipant,
  type AccountScorecard, type FriendlyGame } from '@playsport/shared';
import { usePlatformSession } from '../../platform-session';
import { useNavigationBusy } from '../../navigation-hooks';
import PrivateScorecardView from '../../demo/[slug]/private-scorecard-view';
import ParticipantIdentityLinks from '../../demo/[slug]/participant-identity-links';

type PreviousAccess = { key: string; games: FriendlyGame[] };
type LocalScorecard = { scope: string; save: ReturnType<typeof readPrivateSave> };
const failureText = (error: unknown) => error instanceof Error ? error.message : 'No se pudieron recuperar los datos anteriores.';

export default function SavedGames() {
  const { account, ready } = usePlatformSession();
  if (!ready) return <p role="status">Comprobando tu cuenta…</p>;
  if (!account) return <section className="managerCard"><h1>Mis datos guardados</h1>
    <p>Inicia sesión para recuperar tus partidos privados.</p><Link href="/account">Iniciar sesión</Link></section>;
  return <Recovery key={account.id} accountName={account.displayName} />;
}
function Recovery({ accountName }: { accountName: string }) {
  const scorecards = useMemo(() => new AccountScorecardClient(), []);
  const friendlies = useMemo(() => new FriendlyClient('/api'), []);
  const [saved, setSaved] = useState<AccountScorecard[]>([]);
  const [previous, setPrevious] = useState<PreviousAccess[]>([]);
  const [local, setLocal] = useState<LocalScorecard[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [opened, setOpened] = useState<AccountScorecard | null>(null);
  const browserKeys = useRef<string[]>([]);
  const nativePending = useRef(false);
  const legacyParent = useRef<string | null>(null);
  const nativeTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  useNavigationBusy(busy);
  useEffect(() => {
    let active = true;
    void scorecards.list().then(rows => { if (active) setSaved(rows); })
      .catch(error => { if (active) setError(failureText(error)); });
    return () => { active = false; };
  }, [scorecards]);
  const preview = useCallback(async (keys: string[]) => {
    const results = await Promise.allSettled([...new Set(keys)].map(async key => ({ key, games: await friendlies.previewLegacy(key) })));
    setPrevious(results.flatMap(result => result.status === 'fulfilled' && result.value.games.length ? [result.value] : []));
    const failures = results.flatMap(result => result.status === 'rejected' ? [failureText(result.reason)] : []);
    if (failures.length) setError(failures.join(' '));
    setNotice('Revisión terminada. Nada se ha incorporado ni eliminado. Si aparecen datos anteriores, selecciona solo los que te pertenecen.');
  }, [friendlies]);
  const finishNative = useCallback(() => {
    nativePending.current = false;
    legacyParent.current = null;
    if (nativeTimer.current !== null) globalThis.clearTimeout(nativeTimer.current);
    nativeTimer.current = null;
  }, []);
  useEffect(() => {
    const receive = (event: Event) => {
      if (!nativePending.current || !(event instanceof globalThis.CustomEvent)) return;
      finishNative();
      const value: unknown = event.detail;
      if (!value || typeof value !== 'object' || !('keys' in value) || !Array.isArray(value.keys) ||
          !value.keys.every((key: unknown) => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key))) {
        setError('La app no pudo recuperar los accesos anteriores. No se modificaron sus datos.');
        setBusy(false); return;
      }
      void preview([...browserKeys.current, ...value.keys]).catch(error => setError(failureText(error))).finally(() => setBusy(false));
    };
    globalThis.addEventListener('playsport:legacy-accesses', receive);
    const fromParent = (event: MessageEvent) => {
      if (!legacyParent.current || event.source !== globalThis.parent || event.origin !== legacyParent.current ||
          !event.data || event.data.type !== 'playsport:legacy-accesses:response') return;
      receive(new globalThis.CustomEvent('playsport:legacy-accesses', { detail: event.data }));
    };
    globalThis.addEventListener('message', fromParent);
    return () => { finishNative(); globalThis.removeEventListener('playsport:legacy-accesses', receive); globalThis.removeEventListener('message', fromParent); };
  }, [preview, finishNative]);
  const scan = async () => {
    setBusy(true); setError(''); setNotice(''); setSelected([]); setConfirmed(false);
    try {
      const keys: string[] = [], cards: LocalScorecard[] = [];
      for (let index = 0; index < globalThis.localStorage.length; index++) {
        const key = globalThis.localStorage.key(index);
        if (!key) continue;
        if (key.startsWith('playsport:demo-registration:access:')) {
          const value = globalThis.localStorage.getItem(key);
          if (!value || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Un acceso anterior es inválido. No se reemplazó ni eliminó.');
          keys.push(value);
        } else if (key.startsWith('playsport:private-scorecard:v1:') && !key.includes(':scoring-practice-v1:')) {
          const raw = globalThis.localStorage.getItem(key);
          if (raw !== null) cards.push({ scope: `legacy:${key}`, save: readPrivateSave(raw) });
        }
      }
      setLocal(cards);
      browserKeys.current = keys;
      await preview(keys);
      const host = globalThis.window;
      const bridge = 'ReactNativeWebView' in host ? host.ReactNativeWebView : null;
      const native = bridge && typeof bridge === 'object' && 'postMessage' in bridge && typeof bridge.postMessage === 'function' ? bridge.postMessage.bind(bridge) : null;
      let parentOrigin: string | null = null;
      if (!native && globalThis.parent !== host) {
        const prefix = 'playsport:legacy-parent:';
        if (!host.name.startsWith(prefix)) throw new Error('No se pudo identificar el contenedor de Expo web. Abre PlaySport desde la app para recuperar sus datos anteriores.');
        const value = host.name.slice(prefix.length), parsed = new URL(value);
        if (parsed.origin !== value || !['http:', 'https:'].includes(parsed.protocol))
          throw new Error('El origen del contenedor de Expo web es inválido. No se modificaron sus datos.');
        parentOrigin = value;
      }
      if (native || parentOrigin) {
        setNotice('');
        legacyParent.current = parentOrigin;
        nativePending.current = true;
        nativeTimer.current = globalThis.setTimeout(() => {
          finishNative(); setBusy(false); setError('La app no respondió al revisar sus accesos anteriores. Reintenta; no se modificaron sus datos.');
        }, 15000);
        if (native) native(JSON.stringify({ type: 'playsport:legacy-accesses' }));
        else if (parentOrigin) globalThis.parent.postMessage({ type: 'playsport:legacy-accesses' }, parentOrigin);
        return;
      }
    } catch (error) { setError(failureText(error)); }
    finishNative();
    setBusy(false);
  };
  const incorporate = async () => {
    if (!confirmed || !selected.length || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      for (const access of previous) {
        const ids = access.games.filter(game => selected.includes(game.id)).map(game => game.id);
        if (!ids.length) continue;
        await friendlies.importLegacy(access.key, ids);
        setPrevious(rows => rows.map(row => row.key === access.key ? { ...row, games: row.games.filter(game => !ids.includes(game.id)) } : row));
      }
      for (const card of local.filter(card => selected.includes(card.scope))) {
        const stored = await scorecards.save(card.scope, 0, card.save);
        setSaved(rows => [...rows, stored]);
        setLocal(rows => rows.filter(row => row.scope !== card.scope));
      }
      setSelected([]); setConfirmed(false);
      setNotice('Los datos seleccionados ya pertenecen a tu cuenta y están disponibles en tus otros dispositivos. Las copias locales se conservaron.');
    } catch (error) { setError(failureText(error)); }
    finally { setBusy(false); }
  };
  if (opened) {
    const state = { ...replayPrivate(opened.save.seed, opened.save.commands), ...(opened.save.clock ? { clock: opened.save.clock } : {}) };
    return <main className="moduleView savedGames"><header className="moduleHeader"><h1>Mi planilla privada guardada</h1>
      <p>Consulta privada de la copia guardada, solo lectura. No modifica partidos ni estadísticas oficiales.</p></header>
      <button type="button" className="managerButtonOutline" disabled={busy} onClick={() => setOpened(null)}>Volver a mis datos guardados</button>
      <ParticipantIdentityLinks seed={opened.save.seed} busy={busy} onSave={async identity => {
        setBusy(true);
        try {
          const updated = await scorecards.save(opened.scope, opened.revision, {
            ...opened.save, seed: linkScorecardParticipant(opened.save.seed, identity),
          });
          setSaved(rows => rows.map(row => row.scope === updated.scope ? updated : row));
          setOpened(updated);
        } finally { setBusy(false); }
      }} />
      <PrivateScorecardView observation={state}
      apiBase="" tournamentId="private-archive" gameId={opened.scope} managerId="" homeId="home" awayId="away"
      ownSide="home" homeName={state.seed.names.home} awayName={state.seed.names.away} initialLineup={state.lineups.home}
      positionLabels={fieldPositionLabels} onBack={() => setOpened(null)} /></main>;
  }
  const options = [...previous.flatMap(access => access.games.map(game => ({
    id: game.id, title: `${game.seed.names.away} vs. ${game.seed.names.home} · Amistoso`
  }))), ...local.map(card => ({ id: card.scope, title: `${card.save.seed.names.away} vs. ${card.save.seed.names.home} · Planilla privada` }))];
  return <main className="moduleView savedGames">
    <header className="moduleHeader"><h1>Mis datos guardados</h1><p>Cuenta: {accountName}</p>
      <p>Tus amistosos y planillas privadas se mantienen separados de los partidos y estadísticas oficiales.</p></header>
    <Link href="/demo/friendly-games" className="managerButtonOutline">Ver mis amistosos</Link>
    {error ? <p role="alert" className="managerWarning">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <section className="managerCard"><h2>Planillas privadas de mi cuenta</h2>
      {saved.length ? <ul>{saved.map(card => <li key={card.scope}><button type="button" className="managerButtonOutline"
        onClick={() => setOpened(card)}>{card.save.seed.names.away} vs. {card.save.seed.names.home}</button></li>)}</ul> : <p>No tienes planillas privadas sincronizadas.</p>}
    </section>
    <section className="managerCard"><h2>Recuperar datos anteriores de este dispositivo</h2>
      <p>Si este dispositivo fue compartido, puede contener datos de otra persona. Revisa los equipos y selecciona únicamente los tuyos. No se incorporan automáticamente.</p>
      <button type="button" className="managerButtonOutline" disabled={busy} onClick={() => void scan()}>Buscar datos anteriores</button>
      <fieldset disabled={busy}>
        {options.map(option => <label key={option.id} className="managerField"><span><input type="checkbox" checked={selected.includes(option.id)}
          onChange={event => setSelected(rows => event.target.checked ? [...rows, option.id] : rows.filter(id => id !== option.id))} /> {option.title}</span></label>)}
        {options.length ? <><label className="managerField"><span><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
          Confirmo que los datos seleccionados son míos y deseo incorporarlos a la cuenta {accountName}.</span></label>
          <button type="button" className="managerButtonSolid" disabled={!confirmed || !selected.length} onClick={() => void incorporate()}>Incorporar seleccionados a mi cuenta</button></> : null}
      </fieldset>
    </section>
  </main>;
}
