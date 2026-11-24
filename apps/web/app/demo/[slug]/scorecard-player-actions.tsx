'use client';
/* eslint-env browser */

import { useEffect, useRef, useState } from 'react';
import { defensivePlayContext, type PrivateCommand, type PrivatePlayer, type PrivateState, type Side } from '@playsport/shared';
import { useScreenBack } from '../../navigation-hooks';

export type PlayerSelection = {
  side: Side; id: string; context: string; mode: 'menu' | 'profile' | 'bench' | 'internal' | 'roster';
};
type Props = {
  state: PrivateState; selected: PlayerSelection; canManage: boolean; disabled: boolean; pendingApproval: boolean;
  presentIds?: string[]; positionLabels: Record<string, string>; onClose(): void;
  onMode(mode: PlayerSelection['mode']): void; // eslint-disable-line no-unused-vars
  onCommand(command: PrivateCommand): Promise<boolean>; // eslint-disable-line no-unused-vars
  onFriendlyArrival?(name: string): Promise<boolean>; // eslint-disable-line no-unused-vars
};

export default function ScorecardPlayerActions(props: Props) {
  const { state, selected, canManage, disabled, pendingApproval, positionLabels, onClose, onMode, onCommand } = props;
  const [candidate, setCandidate] = useState<PrivatePlayer | null>(null);
  const [jersey, setJersey] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const player = state.lineups[selected.side].find(entry => entry.id === selected.id) ??
    state.seed.rosters[selected.side].find(entry => entry.id === selected.id);
  const active = state.lineups[selected.side].some(entry => entry.id === selected.id);
  const stale = selected.context !== defensivePlayContext(state);
  const blocked = disabled || busy || stale;
  useScreenBack(onClose, !busy, 5);
  useEffect(() => {
    if (selected.mode === 'internal') return;
    const previous = document.activeElement;
    panel.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [selected.mode]);
  if (!player) return <p role="alert">El jugador ya no está disponible. <button type="button" onClick={onClose}>Cerrar</button></p>;
  const roster = state.seed.rosters[selected.side];
  const free = roster.filter(entry => !state.lineups[selected.side].some(active => active.id === entry.id) &&
    !(selected.side === state.side && state.bases.includes(entry.id)));
  const reserve = free.filter(entry => props.presentIds === undefined || props.presentIds.includes(entry.id));
  const absent = free.filter(entry => props.presentIds !== undefined && !props.presentIds.includes(entry.id));
  const run = async (operation: () => Promise<boolean>) => {
    if (sending.current) return;
    setError('');
    if (blocked || !canManage || !active) { setError('La hoja cambió o este rol no puede realizar el movimiento. Vuelve a seleccionar al jugador.'); return; }
    sending.current = true; setBusy(true);
    try {
      if (await operation()) onClose();
      else setError('El movimiento no se guardó. Espera a que termine la operación anterior o actualiza la hoja.');
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar el cambio.'); }
    finally { sending.current = false; setBusy(false); }
  };
  const replace = (incoming: PrivatePlayer, shirt: string) => {
    if (!state.seed.friendly && (!/^\d{1,2}$/.test(shirt) ||
      state.lineups[selected.side].some(entry => entry.id !== player.id && Number(entry.jersey) === Number(shirt)))) {
      setError('Indica la camiseta que trajo puesta (0–99), sin repetir una de otro jugador activo.');
      return;
    }
    void run(() => onCommand({
      kind: 'substitution', side: selected.side, outId: player.id, inId: incoming.id, position: player.position,
      jersey: state.seed.friendly ? '' : shirt, ...(selected.mode === 'roster' ? { arrival: true } : {})
    }));
  };
  const choose = (incoming: PrivatePlayer) => {
    if (selected.mode !== 'roster' && (state.seed.friendly || /^\d{1,2}$/.test(incoming.jersey))) replace(incoming, incoming.jersey);
    else { setCandidate(incoming); setJersey(incoming.jersey); setError(''); }
  };
  const changeMode = (mode: PlayerSelection['mode']) => { setCandidate(null); setJersey(''); setError(''); onMode(mode); };
  if (selected.mode === 'internal') return <div className="scorecardInternalPrompt" role="status">
    <strong>Cambio interno: {player.name}</strong>
    <p>Toca al otro jugador de {state.seed.names[selected.side]} en la hoja o alineación. Solo intercambian posiciones; conservan sus turnos al bate.</p>
    {stale ? <p role="alert">La hoja cambió. Cancela y vuelve a seleccionar al jugador.</p> : null}
    <button type="button" className="managerButtonOutline" onClick={onClose}>Cancelar cambio interno</button>
  </div>;
  return <div className="scorecardPlayerBackdrop" onKeyDown={event => {
    if (event.key === 'Escape' && !busy) onClose();
    if (event.key === 'Tab') {
      const controls = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]');
      const first = controls?.[0], last = controls?.[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {
        event.preventDefault(); first?.focus();
      }
    }
  }}>
    <div className="managerCard scorecardPlayerDialog" role="dialog" aria-modal="true" aria-labelledby="scorecard-player-title"
      tabIndex={-1} ref={panel}>
      <header className="privateSheetHeader">
        <h2 id="scorecard-player-title">{player.name}</h2>
        <button type="button" className="managerButtonOutline" disabled={busy} onClick={onClose}>Cerrar opciones del jugador</button>
      </header>
      <p>{state.seed.names[selected.side]} · {player.order === null ? 'Sin turno' : `${player.order}.º bate`} · {positionLabels[player.position]}</p>
      {selected.mode === 'menu' ? <div className="scorecardPlayerChoices">
        <button type="button" className="managerButtonOutline" onClick={() => changeMode('profile')}>Ver perfil</button>
        {canManage && active ? <>
          <button type="button" className="managerButtonOutline" disabled={blocked} onClick={() => changeMode('bench')}>Sustituir por un suplente</button>
          <button type="button" className="managerButtonOutline" disabled={blocked} onClick={() => changeMode('internal')}>Cambio interno</button>
        </> : null}
        {!active ? <p>Este jugador no está en la alineación actual; sus actuaciones anteriores se conservan.</p> : null}
      </div> : selected.mode === 'profile' ? <section>
        <h3>Perfil en este partido</h3>
        <dl className="scorecardPlayerProfile">
          <dt>Jugador</dt><dd>{player.name}</dd>
          <dt>Equipo</dt><dd>{state.seed.names[selected.side]}</dd>
          <dt>Posición</dt><dd>{positionLabels[player.position]}</dd>
          {!state.seed.friendly ? <><dt>Camiseta</dt><dd>{player.jersey || 'Sin registrar'}</dd></> : null}
          <dt>Estado</dt><dd>{active ? 'En la alineación' : 'Fuera de la alineación'}</dd>
        </dl>
      </section> : <section>
        <h3>{selected.mode === 'bench' ? 'Toca al suplente que entra' : state.seed.friendly ? 'Participante que llega' : 'Roster: jugadores que aún no llegaron'}</h3>
        {pendingApproval ? <p>El cambio se enviará al anotador u organizador para confirmación; no modifica el lineup todavía.</p> : null}
        {candidate ? <form onSubmit={event => { event.preventDefault(); replace(candidate, jersey.trim()); }}>
          <p>Entra <strong>{candidate.name}</strong> por {player.name}, conservando el {player.order}.º turno.</p>
          <label className="managerField"><span>Camiseta que trajo puesta</span>
            <input autoFocus required maxLength={2} pattern="[0-9]{1,2}" inputMode="numeric" value={jersey}
              disabled={blocked} onChange={event => setJersey(event.target.value)} />
          </label>
          <div className="managerButtonRow">
            <button type="submit" className="managerButtonSolid" disabled={blocked}>Guardar camiseta y cambio</button>
            <button type="button" className="managerButtonOutline" disabled={busy} onClick={() => setCandidate(null)}>Elegir otro jugador</button>
          </div>
        </form> : selected.mode === 'roster' && state.seed.friendly ? <form onSubmit={event => {
          event.preventDefault();
          if (!name.trim() || name.length > 100 || !props.onFriendlyArrival) { setError('Completa el nombre del participante.'); return; }
          const submit = props.onFriendlyArrival;
          void run(() => submit(name.trim()));
        }}>
          <label className="managerField"><span>Nombre del participante que llega</span>
            <input required maxLength={100} value={name} disabled={blocked} onChange={event => setName(event.target.value)} />
          </label>
          <button className="managerButtonSolid" type="submit" disabled={blocked}>Ingresar a reserva y sustituir</button>
        </form> : <div className="scorecardPlayerChoices">
          {(selected.mode === 'bench' ? reserve : absent).map(incoming => <button type="button" key={incoming.id}
            className="managerButtonOutline" disabled={blocked} onClick={() => choose(incoming)}>
            {incoming.name}{incoming.jersey ? ` · #${incoming.jersey}` : ''}
          </button>)}
          {!(selected.mode === 'bench' ? reserve : absent).length ? <p>{selected.mode === 'bench' ? 'No hay suplentes disponibles.' : 'Todos los jugadores del roster ya están registrados como presentes.'}</p> : null}
        </div>}
        {selected.mode === 'bench' ? <button type="button" className="managerButtonOutline" disabled={blocked}
          onClick={() => changeMode('roster')}>Ingresar a reserva</button> : null}
      </section>}
      {error || stale ? <p className="managerWarning" role="alert">{error || 'La hoja cambió. Cierra y vuelve a seleccionar al jugador.'}</p> : null}
      {selected.mode !== 'menu' ? <button type="button" className="managerButtonOutline" disabled={busy}
        onClick={() => changeMode('menu')}>Volver a opciones del jugador</button> : null}
    </div>
  </div>;
}
