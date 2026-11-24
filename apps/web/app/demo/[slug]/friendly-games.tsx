'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FriendlyClient, availableLineupPositions, fieldPositionLabels, friendlyDraftLineup,
  friendlySetupFromDraft, initialFriendlyDraft, isFriendlyDraft, type FriendlyGame, type FriendlyOperation, type Side } from '@playsport/shared';
import { usePlatformSession } from '../../platform-session';
import { useNavigationBusy, useNavigationDraft, useScreenBack } from '../../navigation-hooks';
import PrivateScorecardView from './private-scorecard-view';
import { useTeamSheets } from './team-sheets';
import { ExampleTeamName } from '../../institutional-logos';
import ParticipantIdentityLinks from './participant-identity-links';

const errorText = (failure: unknown) => failure instanceof Error ? failure.message : 'No se pudo guardar el amistoso.';

export default function FriendlyGames() {
  const { account, ready } = usePlatformSession();
  if (!ready) return <p role="status">Preparando tus amistosos…</p>;
  if (!account) return <section className="managerCard"><h1>Partidos amistosos</h1>
    <p>Inicia sesión para guardar y recuperar tus amistosos privados en cualquier dispositivo. Los participantes no necesitan cuenta.</p>
    <Link href="/account" className="managerButtonSolid">Iniciar sesión</Link></section>;
  return <FriendlyWorkspace key={account.id} accountId={account.id} />;
}
export function FriendlyWorkspace({ accountId }: { accountId: string }) {
  const client = useMemo(() => new FriendlyClient('/api'), []);
  const [games, setGames] = useState<FriendlyGame[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft, draftReady] = useNavigationDraft(`friendly:create:${accountId}`, initialFriendlyDraft, isFriendlyDraft);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const generation = useRef(0);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [side, setSide] = useState<Side>('home');
  const [loadedRetry, setLoadedRetry] = useState(0);
  useNavigationBusy(busy);
  useScreenBack(() => { setSelectedId(null); setCreating(false); }, Boolean(selectedId || creating));
  useEffect(() => {
    let active = true;
    const request = ++generation.current;
    void client.list().then(next => { if (active && request === generation.current) { setGames(next); setError(''); setLoadedRetry(retry); } })
      .catch(failure => { if (active && request === generation.current) setError(errorText(failure)); });
    return () => { active = false; };
  }, [client, retry]);
  const selected = games?.find(game => game.id === selectedId);
  const current = useRef(selected);
  current.current = selected;
  const update = async (operation: FriendlyOperation) => {
    if (sending.current) throw new Error('Espera a que termine de guardarse la anotación anterior.');
    const game = current.current;
    if (!game) throw new Error('Selecciona el amistoso antes de anotar.');
    generation.current++; sending.current = true; setBusy(true); setError('');
    try {
      const next = await client.update(game, operation);
      current.current = next;
      setGames(previous => previous?.map(item => item.id === next.id ? next : item) ?? [next]);
    } catch (failure) { setError(errorText(failure)); throw failure; }
    finally { sending.current = false; setBusy(false); }
  };
  const create = async () => {
    if (sending.current) return;
    generation.current++; sending.current = true; setBusy(true); setError('');
    try {
      const game = await client.create(friendlySetupFromDraft(draft));
      setGames(previous => [...(previous ?? []), game]); setSelectedId(game.id); setCreating(false); setDraft(initialFriendlyDraft);
    } catch (failure) { setError(errorText(failure)); }
    finally { sending.current = false; setBusy(false); }
  };
  const changeParticipant = (team: Side, index: number, patch: Partial<{ name: string; position: string }>) => {
    setDraft(previous => {
      const rows = friendlyDraftLineup(previous, team).map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row);
      return { ...previous, [team === 'home' ? 'homePlayers' : 'awayPlayers']: rows.map(row => row.name).join('\n'),
        [team === 'home' ? 'homePositions' : 'awayPositions']: rows.map(row => row.position) };
    });
  };
  const changeSubstitutes = (team: Side, change: (_names: string[]) => string[]) => { // eslint-disable-line no-unused-vars
    const key = team === 'home' ? 'homeSubstitutes' : 'awaySubstitutes';
    setDraft(previous => ({ ...previous, [key]: change(previous[key] ?? []) }));
  };
  return <section className="friendlyWorkspace">
    <header className="moduleHeader">
      <p className="eyebrow">AMISTOSOS · PRIVADOS · NO OFICIALES</p><h1>Partidos amistosos</h1>
      <p>Solo tú puedes consultar la planilla completa y anotar tus amistosos. No aparecen en la cartelera ni en las estadísticas oficiales.
        Un participante vinculado por cédula puede consultar únicamente sus propias cifras desde su cuenta verificada.</p>
      <p>Los participantes no necesitan cuenta: basta con su nombre. Tus amistosos se guardan en tu cuenta y puedes recuperarlos en otro dispositivo o rol.</p>
      <Link href="/account/saved-games">Recuperar partidos guardados anteriormente en este dispositivo</Link>
    </header>
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    <div className="managerButtonRow">
      <button type="button" className="managerButtonOutline" disabled={busy} onClick={() => setRetry(value => value + 1)}>Actualizar mis amistosos</button>
      {selectedId || creating ? <button type="button" className="managerButtonOutline" disabled={busy}
        onClick={() => { setSelectedId(null); setCreating(false); }}>Volver a mis amistosos</button> :
        <button type="button" className="managerButtonSolid" disabled={busy || !games} onClick={() => setCreating(true)}>Crear amistoso</button>}
    </div>
    {!games ? <p role="status">{error ? 'No se pudieron cargar tus amistosos. Reintenta sin reemplazar el acceso guardado.' : 'Consultando tus amistosos…'}</p> :
      creating ? <form className="managerCard managerStepCard" onSubmit={event => { event.preventDefault(); void create(); }}>
        <h2>Equipos y alineaciones</h2>
        <p>Orden al bate del 1 al 12. Completa al menos 9 participantes por equipo; los turnos 10, 11 y 12 son opcionales, sin dejar huecos. Puedes elegir la posición defensiva antes de comenzar, sin repetirla en el mismo equipo, o dejarla sin asignar.</p>
        <fieldset disabled={busy || !draftReady}>
          <label className="managerField"><span>Deporte</span><select value={draft.sport}
            onChange={event => setDraft({ ...draft, sport: event.target.value === 'baseball' ? 'baseball' : 'softball' })}>
            <option value="baseball">Béisbol · 9 entradas</option><option value="softball">Sóftbol · 7 entradas</option>
          </select></label>
          {(['away', 'home'] as const).map(team => {
            const rows = friendlyDraftLineup(draft, team);
            const label = team === 'home' ? 'local' : 'visitante';
            return <div key={team}>
            <label className="managerField"><span>Nombre del equipo {team === 'home' ? 'local' : 'visitante'}</span>
              <input required maxLength={100} value={draft[team]} onChange={event => setDraft({ ...draft, [team]: event.target.value })} /></label>
            <ol className="friendlyCreationLineup" aria-label={`Lineup del ${label}`}>
              {rows.map((row, index) => <li className="friendlyCreationRow" key={index}>
                <span className="lineupPreviewOrder" aria-label={`Turno al bate ${index + 1}`}>{index + 1}</span>
                <label className="managerField"><span>Nombre {index + 1}{index >= 9 ? ' (opcional)' : ''}</span>
                  <input aria-label={`Nombre del ${label}, turno ${index + 1}`} required={index < 9} maxLength={100}
                    value={row.name} onChange={event => changeParticipant(team, index, { name: event.target.value })} /></label>
                <label className="managerField"><span>Posición defensiva</span>
                  <select aria-label={`Posición del ${label}, turno ${index + 1}`} value={row.position}
                    onChange={event => changeParticipant(team, index, { position: event.target.value })}>
                    {availableLineupPositions(rows.map((entry, rowIndex) => ({ identificationNumber: String(rowIndex), fieldPosition: entry.position })), String(index))
                      .map(position => <option key={position} value={position}>{position === 'NA' ? 'Sin asignar' : `${position} · ${fieldPositionLabels[position]}`}</option>)}
                  </select></label>
              </li>)}
            </ol>
            <details className="friendlyCreationBench">
              <summary>Suplentes del {label} ({(draft[team === 'home' ? 'homeSubstitutes' : 'awaySubstitutes'] ?? []).length})</summary>
              <p>Opcionales, sin tope adicional. No ocupan turnos al bate ni posiciones defensivas hasta entrar por un titular.</p>
              <ul className="friendlyCreationLineup" aria-label={`Banca del ${label}`}>
                {(draft[team === 'home' ? 'homeSubstitutes' : 'awaySubstitutes'] ?? []).map((name, index) =>
                  <li className="friendlySubstituteRow" key={index}>
                    <label className="managerField"><span>Suplente {index + 1}</span>
                      <input required maxLength={100} aria-label={`Nombre del suplente ${index + 1} del ${label}`}
                        value={name} onInvalid={event => event.currentTarget.closest('details')?.setAttribute('open', '')}
                        onChange={event => {
                          const value = event.target.value;
                          changeSubstitutes(team, names => names.map((entry, current) => current === index ? value : entry));
                        }} />
                    </label>
                    <button type="button" className="managerButtonOutline" aria-label={`Quitar suplente ${index + 1} del ${label}`}
                      onClick={() => changeSubstitutes(team, names => names.filter((_entry, current) => current !== index))}>Quitar</button>
                  </li>)}
              </ul>
              <button type="button" className="managerButtonOutline" onClick={() => changeSubstitutes(team, names => [...names, ''])}>Agregar suplente al {label}</button>
            </details>
          </div>; })}
          <button type="submit" className="managerButtonSolid">{busy ? 'Guardando…' : 'Comenzar amistoso'}</button>
        </fieldset>
      </form> : selected ? <>
        <p>AMISTOSO · {selected.state.finished ? 'Finalizado · Solo lectura' : 'En curso'} · <ExampleTeamName>{selected.seed.names.away}</ExampleTeamName> {selected.state.scores.away}–{selected.state.scores.home} <ExampleTeamName>{selected.seed.names.home}</ExampleTeamName></p>
        <div className="managerButtonRow" role="group" aria-label="Equipo para consultar y ajustar posiciones">
          {(['away', 'home'] as const).map(team => <button key={team} type="button" className="managerButtonOutline"
            disabled={busy} aria-pressed={side === team} onClick={() => setSide(team)}><ExampleTeamName>{selected.seed.names[team]}</ExampleTeamName></button>)}
        </div>
        <ParticipantIdentityLinks seed={selected.seed} busy={busy} onSave={participantIdentity => update({ participantIdentity })} />
        <FriendlyScorecard key={`${selected.id}:${loadedRetry}`} game={selected} side={side} busy={busy} update={update} onBack={() => setSelectedId(null)} />
      </> : games.length ? <div className="eventsGameGrid">{[...games].reverse().map(game => <article className="managerCard eventsGame" key={game.id}>
        <p>AMISTOSO · {game.state.finished ? 'Finalizado' : 'En curso'}</p><h2><ExampleTeamName>{game.seed.names.away}</ExampleTeamName> vs. <ExampleTeamName>{game.seed.names.home}</ExampleTeamName></h2>
        <p>{game.state.scores.away}–{game.state.scores.home} · {game.sport === 'baseball' ? 'Béisbol' : 'Sóftbol'}</p>
        <button type="button" className="managerButtonOutline" onClick={() => setSelectedId(game.id)}>
          {game.state.finished ? 'Ver resultado y estadísticas' : 'Continuar anotación'}</button>
      </article>)}</div> : <p>Aún no has creado amistosos.</p>}
  </section>;
}
export function FriendlyScorecard({ game, side, busy, update, onBack }: {
  game: FriendlyGame; side: Side; busy: boolean;
  update: (_operation: FriendlyOperation) => Promise<void>; // eslint-disable-line no-unused-vars
  onBack: () => void;
}) {
  const connection = useTeamSheets({ apiBase: '', gameId: game.id, tournamentId: '', userId: '', role: 'manager', enabled: false });
  return <PrivateScorecardView friendly apiBase="" tournamentId="friendly" gameId={game.id} managerId="" homeId="home" awayId="away"
    ownSide={side} homeName={game.seed.names.home} awayName={game.seed.names.away} initialLineup={game.seed.lineups[side]}
    positionLabels={fieldPositionLabels} onBack={onBack} official={{
      session: { seed: game.seed, commands: game.commands, state: game.state }, readOnly: game.state.finished, busy,
      canUndo: game.commands.length > 0, connection,
      onCommand: command => update({ command }), onUndo: () => update({ undo: true }),
      onFriendlyArrival: (side, outId, name) => update({ arrivalSubstitution: { side, outId, name } }),
      onDuration: async () => { throw new Error('La duración se elige al crear el amistoso.'); },
      onErrorOuts: errorOuts => update({ errorOuts }), onClock: clockAction => update({ clockAction })
    }} />;
}
