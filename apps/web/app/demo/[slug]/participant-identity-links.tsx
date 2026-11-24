'use client';

import { useRef, useState } from 'react';
import { normalizeProfileIdentification, type ParticipantIdentity, type PrivateSeed, type Side } from '@playsport/shared';

export default function ParticipantIdentityLinks({ seed, busy, onSave }: {
  seed: PrivateSeed; busy: boolean; onSave: (_identity: ParticipantIdentity) => Promise<void>; // eslint-disable-line no-unused-vars
}) {
  const [side, setSide] = useState<Side>('home');
  const [playerId, setPlayerId] = useState(seed.rosters.home[0]?.id ?? '');
  const player = seed.rosters[side].find(entry => entry.id === playerId);
  const existing = player ? player.identification ?? (/^[VE]-[1-9]\d{0,9}$/.test(normalizeProfileIdentification(player.id)) ?
    normalizeProfileIdentification(player.id) : '') : '';
  const [draft, setDraft] = useState<{ key: string; value: string } | null>(null);
  const key = JSON.stringify([side, playerId]);
  const identification = draft?.key === key ? draft.value : existing;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const chooseParticipant = (nextSide: Side, nextId: string) => {
    setSide(nextSide); setPlayerId(nextId); setDraft(null); setError(''); setNotice('');
  };
  const save = async () => {
    if (pending.current) return;
    pending.current = true; setSending(true); setError(''); setNotice('');
    try {
      await onSave({ side, playerId, identification });
      setDraft(null);
      setNotice('Vínculo guardado. La cuenta con identidad verificada podrá consultar únicamente sus propias estadísticas.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar el vínculo del participante.');
    } finally { pending.current = false; setSending(false); }
  };
  return <details className="managerCard managerStepCard participantIdentityLinks">
    <summary>Vincular participantes con su cuenta</summary>
    <p>La cédula se conserva privada. Vincula al participante para que recupere sus cifras al verificar su cuenta,
      aunque aún no tenga un plan. No obtiene acceso a la planilla completa ni a las cifras de otras personas.</p>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset className="participantIdentityFields" disabled={busy || sending}>
        <label className="managerField"><span>Equipo del participante</span><select value={side}
          onChange={event => {
            const next = event.target.value === 'away' ? 'away' : 'home';
            chooseParticipant(next, seed.rosters[next][0]?.id ?? '');
          }}>
          <option value="home">{seed.names.home}</option><option value="away">{seed.names.away}</option>
        </select></label>
        <label className="managerField"><span>Participante para vincular</span><select value={playerId}
          onChange={event => chooseParticipant(side, event.target.value)}>
          {seed.rosters[side].map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
        </select></label>
        <label className="managerField"><span>Cédula del participante</span><input value={identification} maxLength={40}
          placeholder="V-12345678" onChange={event => { setDraft({ key, value: event.target.value }); setNotice(''); setError(''); }} /></label>
      </fieldset>
      <p>Deja la cédula vacía para quitar el vínculo. Un suplente sin participación no genera estadísticas.</p>
      <button type="submit" className="managerButtonOutline" disabled={busy || sending || !player}>
        {sending ? 'Guardando vínculo…' : 'Guardar vínculo'}</button>
    </form>
    {error ? <p role="alert" className="managerWarning">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </details>;
}
