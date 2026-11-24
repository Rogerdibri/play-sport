'use client';

import { useState } from 'react';
import { availablePersonnelPositions, fieldPositionLabels, managerPersonnelAction, type PrivateState } from '@playsport/shared';
import { useNavigationDraft } from '../../navigation-hooks';
import { isChoiceDraft, isTextDraft } from '../../navigation-drafts';
import type { TeamSheetConnection } from './team-sheets';

export default function ManagerPersonnelRequests({ connection, state, disabled }: {
  connection: TeamSheetConnection; state: PrivateState; disabled: boolean;
}) {
  const scope = `${connection.draftScope}:manager-personnel`;
  const [kind, setKind] = useNavigationDraft<'substitution' | 'defense' | 'courtesy'>(`${scope}:kind`, 'substitution', isChoiceDraft(['substitution','defense','courtesy']));
  const [player, setPlayer] = useNavigationDraft(`${scope}:player`, '', isTextDraft);
  const [outgoing, setOutgoing] = useNavigationDraft(`${scope}:outgoing`, '', isTextDraft);
  const [position, setPosition] = useNavigationDraft(`${scope}:position`, '', isTextDraft);
  const [jersey, setJersey] = useNavigationDraft(`${scope}:jersey`, '', isTextDraft);
  const [base, setBase] = useNavigationDraft(`${scope}:base`, '1', isChoiceDraft(['1','2','3']));
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const sheet = connection.data?.sheets.find(row => row.teamId === connection.data?.ownTeamId);
  if (!sheet || connection.data?.canDecide) return null;
  const players = kind === 'defense' ? sheet.lineup : sheet.presentSubstitutes;
  const positions = availablePersonnelPositions(sheet, kind === 'defense' ? player : outgoing, kind === 'defense');
  const submit = async () => {
    setError(''); setNotice('');
    try {
      if (kind !== 'courtesy' && !positions.includes(position)) {
        throw new Error('Selecciona una posición que conserve la cantidad de defensores del lineup enviado.');
      }
      const action = managerPersonnelAction(kind, { player, outgoing: kind === 'courtesy' ? state.bases[Number(base)-1] ?? '' : outgoing,
        position, jersey, base: Number(base), name: '', role: 'DIRIGENTE' });
      await connection.request(sheet.teamId, action);
      setNotice('Solicitud enviada. El lineup no cambia hasta que el organizador o anotador la confirme.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo enviar la solicitud.'); }
  };
  return <details className="managerCard managerStepCard">
    <summary>Solicitar sustitución, cambio defensivo o corredor de cortesía</summary>
    <p>Solo para tu equipo. El orden al bate y la cantidad de defensores quedan fijos; un suplente hereda el turno del jugador saliente. Esto no registra jugadas ni aprueba el cambio.</p>
    <fieldset className="privateControls" disabled={disabled || connection.busy || Boolean(connection.error || connection.streamError)}>
      <label className="managerField"><span>Tipo de solicitud del manager</span><select value={kind}
        onChange={event => { const value = event.target.value; if (value === 'substitution' || value === 'defense' || value === 'courtesy') {
          setKind(value); setPlayer(''); setOutgoing(''); setPosition(''); setError(''); setNotice('');
        } }}>
        <option value="substitution">Sustitución</option><option value="defense">Cambio defensivo</option><option value="courtesy">Corredor de cortesía</option>
      </select></label>
      <label className="managerField"><span>{kind === 'defense' ? 'Jugador que cambia de posición' : 'Suplente presente que entra'}</span>
        <select value={player} onChange={event => {
          setPlayer(event.target.value);
          if (kind === 'defense') setPosition(sheet.lineup.find(row => row.identificationNumber === event.target.value)?.fieldPosition ?? '');
        }}><option value="">Selecciona al jugador</option>
          {players.map(row => <option key={row.identificationNumber} value={row.identificationNumber}>{row.displayName}</option>)}
        </select></label>
      {kind === 'substitution' ? <>
        <label className="managerField"><span>Jugador saliente de la sustitución</span><select value={outgoing} onChange={event => {
          setOutgoing(event.target.value);
          setPosition(sheet.lineup.find(row => row.identificationNumber === event.target.value)?.fieldPosition ?? '');
        }}>
          <option value="">Selecciona al jugador saliente</option>{sheet.lineup.map(row => <option key={row.identificationNumber} value={row.identificationNumber}>{row.displayName}</option>)}
        </select></label>
        <label className="managerField"><span>Camiseta del suplente entrante</span><input inputMode="numeric" maxLength={2} value={jersey} onChange={event => setJersey(event.target.value)} /></label>
      </> : null}
      {kind !== 'courtesy' ? <label className="managerField"><span>Posición defensiva solicitada</span><select value={positions.includes(position) ? position : ''} onChange={event => setPosition(event.target.value)}>
        <option value="">Selecciona una posición</option>
        {positions.map(id => <option key={id} value={id}>{fieldPositionLabels[id]}</option>)}
      </select></label> : <label className="managerField"><span>Base del corredor saliente</span><select value={base} onChange={event => setBase(event.target.value)}>
        {[1,2,3].map(number => <option key={number} value={String(number)} disabled={!state.bases[number-1]}>Base {number}</option>)}
      </select></label>}
      <button className="managerButtonOutline" type="button" onClick={() => { void submit(); }}>Enviar solicitud de cambio</button>
    </fieldset>
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
  </details>;
}
