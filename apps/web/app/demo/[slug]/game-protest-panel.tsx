'use client';

import { useState } from 'react';
import { InstitutionName } from '../../institutional-logos';
import type { GameProtest, PersonnelRole, OfficialGameStatus } from '@playsport/shared';
import { useNavigationBusy, useNavigationDraft } from '../../navigation-hooks';
import { isTextDraft } from '../../navigation-drafts';

export default function GameProtestPanel({ apiBase, gameId, tournamentId, actorId, role, status, version, protest, names, disabled, onUpdated }: {
  apiBase: string; gameId: string; tournamentId: string; actorId: string; role: PersonnelRole | 'public';
  status: OfficialGameStatus; version: number; protest?: GameProtest; names: Record<string, string>; disabled: boolean;
  onUpdated: (_value: unknown) => void; // eslint-disable-line no-unused-vars
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scope = `${tournamentId}:${gameId}:protest:${role}`;
  const [teamId, setTeamId] = useNavigationDraft(`${scope}:team`, '', isTextDraft);
  const [reason, setReason] = useNavigationDraft(`${scope}:reason`, '', isTextDraft);
  const [reference, setReference] = useNavigationDraft(`${scope}:act`, '', isTextDraft);
  useNavigationBusy(busy);
  const resolution = protest?.resolution;
  const deciding = role === 'organizer' && status === 'protested' && protest && !resolution;
  const declaring = role === 'scorekeeper' && status === 'in_progress' && !protest;
  if (!protest && !declaring) return null;
  return <section className="managerCard managerStepCard" aria-label="Protesta y mesa técnica">
    {protest ? <>
      <h2>{resolution ? 'Resultado determinado por mesa técnica' : 'Bajo protesta · Pendiente de mesa técnica'}</h2>
      <p>Equipo reclamante: <strong><InstitutionName id={protest.teamId}>{names[protest.teamId] ?? protest.teamId}</InstitutionName></strong> · {protest.reason}</p>
      <p>Entrada {protest.moment.inning} · {protest.moment.outs} outs · Cuenta {protest.moment.balls}–{protest.moment.strikes} ·
        Marcador registrado {protest.moment.awayScore}–{protest.moment.homeScore}.</p>
      {resolution ? <>
        <p><strong>Ganador: <InstitutionName id={resolution.winnerTeamId}>{names[resolution.winnerTeamId] ?? resolution.winnerTeamId}</InstitutionName></strong> · Perdedor: <InstitutionName id={resolution.loserTeamId}>{names[resolution.loserTeamId] ?? resolution.loserTeamId}</InstitutionName></p>
        <p>Fundamento: {resolution.reason}</p><p>Acta: {resolution.recordReference}</p>
        <p>Registrado por {resolution.recordedBy} · {resolution.recordedAt}</p>
      </> : <p>La anotación está pausada. No suma victoria ni derrota hasta registrar el acta de mesa técnica. El anotador puede atender otro partido.</p>}
      <p>Las carreras y estadísticas anotadas se conservan; el ganador oficial puede diferir del marcador.</p>
    </> : <button type="button" className="managerButtonOutline" disabled={disabled || busy} aria-expanded={expanded}
      onClick={() => setExpanded(value => !value)}>Juego bajo protesta</button>}
    {deciding || declaring && expanded ? <form onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      setBusy(true); setError('');
      try {
        const response = await fetch(`${apiBase}/games/${encodeURIComponent(gameId)}/protest${deciding ? '/decision' : ''}`, {
          credentials: 'include',
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(deciding ? { tournamentId, organizerId: actorId, expectedOfficialVersion: version,
            winnerTeamId: teamId, reason, recordReference: reference } :
            { tournamentId, actorId, actorRole: role, expectedOfficialVersion: version, teamId, reason })
        });
        const value: unknown = await response.json();
        if (!response.ok) throw new Error(value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ?
          value.message : 'No se pudo registrar la protesta o la decisión.');
        onUpdated(value);
      } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo registrar la protesta o la decisión.'); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={disabled || busy}>
        <legend>{deciding ? 'Mesa técnica · Registrar resolución' : 'Registrar juego bajo protesta'}</legend>
        <label className="managerField"><span>{deciding ? 'Ganador según el acta' : 'Equipo que presenta la protesta'}</span>
          <select required value={teamId} onChange={event => setTeamId(event.target.value)}><option value="">Selecciona un equipo</option>
            {Object.entries(names).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        {deciding && teamId ? <p>Perdedor: {Object.entries(names).find(([id]) => id !== teamId)?.[1]}</p> : null}
        <label className="managerField"><span>{deciding ? 'Fundamento de la decisión' : 'Motivo de la protesta'}</span>
          <textarea required maxLength={deciding ? 4000 : 2000} value={reason} onChange={event => setReason(event.target.value)} />
        </label>
        {deciding ? <label className="managerField"><span>Referencia del acta de mesa técnica</span>
          <input required maxLength={500} value={reference} onChange={event => setReference(event.target.value)} /></label> : null}
        <label><input type="checkbox" required /> {deciding ? 'Confirmo que transcribo la decisión de la mesa técnica. No es una decisión unilateral ni una reapertura.' :
          'Confirmo que el juego quedará pausado y no se podrán registrar más jugadas.'}</label>
        <button type="submit" className="managerButtonSolid">{busy ? 'Guardando…' : deciding ? 'Registrar decisión de mesa técnica' : 'Confirmar juego bajo protesta'}</button>
      </fieldset>
    </form> : null}
    {error ? <p role="alert" className="managerWarning">{error}</p> : null}
  </section>;
}
