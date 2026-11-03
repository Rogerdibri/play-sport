'use client';

import { useMemo, useState } from 'react';

type UiStatus = {
  kind: 'idle' | 'success' | 'error';
  message: string;
};

type ManagerContext = {
  tournamentId: string;
  teamId: string;
  gameId: string;
  managerId: string;
};

type RosterPlayerView = {
  displayName: string;
  identificationNumber: string;
};

type LineupEntryDraft = {
  identificationNumber: string;
  battingOrder: number;
  fieldPosition: string;
};

const fieldPositionOptions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
const officialScoringApiBase =
  process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? 'http://localhost:4000/api/official-scoring';

function normalizeCedula(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function parseApiMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const maybeMessage = (payload as { message?: unknown }).message;

  if (typeof maybeMessage === 'string') {
    return maybeMessage;
  }

  if (Array.isArray(maybeMessage)) {
    const parts = maybeMessage.filter((item) => typeof item === 'string');
    return parts.join(' ');
  }

  return null;
}

function adaptManagerError(message: string) {
  if (message.includes('ya pertenece al roster del equipo')) {
    return 'Esta cedula ya esta en otro equipo dentro de este mismo torneo. Si puede jugar en otro equipo en torneos distintos.';
  }

  if (message.includes('ya dirige el equipo')) {
    return 'Ese manager ya dirige otro equipo dentro del mismo torneo. Puede dirigir en torneos diferentes.';
  }

  if (message.includes('no existe en el registro global')) {
    return 'Esta cedula no existe en el registro global. Registra al jugador una sola vez y luego vuelve a intentarlo.';
  }

  return message;
}

export default function LiveScoringManagerDemo() {
  const [managerTournamentId, setManagerTournamentId] = useState('tour-global-1');
  const [managerTeamId, setManagerTeamId] = useState('team-A');
  const [managerGameId, setManagerGameId] = useState('game-global-1');
  const [managerProfileId, setManagerProfileId] = useState('mgr-A');
  const [managerContextReady, setManagerContextReady] = useState(false);

  const [managerRosterCedulaDraft, setManagerRosterCedulaDraft] = useState('');
  const [managerRosterCedulas, setManagerRosterCedulas] = useState<string[]>([]);
  const [managerRosterPlayers, setManagerRosterPlayers] = useState<RosterPlayerView[]>([]);

  const [managerLineupCedulaDraft, setManagerLineupCedulaDraft] = useState('');
  const [managerLineupBattingOrderDraft, setManagerLineupBattingOrderDraft] = useState('1');
  const [managerLineupFieldPositionDraft, setManagerLineupFieldPositionDraft] = useState('P');
  const [managerLineupEntries, setManagerLineupEntries] = useState<LineupEntryDraft[]>([]);

  const [managerUiStatus, setManagerUiStatus] = useState<UiStatus>({ kind: 'idle', message: '' });
  const [managerSubmitting, setManagerSubmitting] = useState(false);

  const rosterNamesByCedula = useMemo(() => {
    const map = new Map<string, string>();

    for (const player of managerRosterPlayers) {
      map.set(player.identificationNumber, player.displayName);
    }

    return map;
  }, [managerRosterPlayers]);

  const updateManagerTournamentId = (value: string) => {
    setManagerTournamentId(value);
    setManagerContextReady(false);
  };

  const updateManagerTeamId = (value: string) => {
    setManagerTeamId(value);
    setManagerContextReady(false);
  };

  const updateManagerGameId = (value: string) => {
    setManagerGameId(value);
    setManagerContextReady(false);
  };

  const updateManagerProfileId = (value: string) => {
    setManagerProfileId(value);
    setManagerContextReady(false);
  };

  const buildManagerContext = (): ManagerContext => ({
    tournamentId: managerTournamentId.trim(),
    teamId: managerTeamId.trim(),
    gameId: managerGameId.trim(),
    managerId: managerProfileId.trim()
  });

  const postOfficialScoring = async (path: string, payload: unknown) => {
    const response = await fetch(`${officialScoringApiBase}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = parseApiMessage(body) ?? `Error ${response.status}`;
      throw new Error(message);
    }

    return body;
  };

  const getOfficialScoring = async (path: string) => {
    const response = await fetch(`${officialScoringApiBase}/${path}`);
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const message = parseApiMessage(body) ?? `Error ${response.status}`;
      throw new Error(message);
    }

    return body;
  };

  const loadRosterFromContext = async (context: ManagerContext, opts?: { silent?: boolean }) => {
    setManagerSubmitting(true);

    try {
      const roster = await getOfficialScoring(
        `tournaments/${context.tournamentId}/teams/${context.teamId}/roster?visibility=free`
      );

      const rosterIdsRaw =
        (roster as { rosterPlayerIdentificationNumbers?: unknown }).rosterPlayerIdentificationNumbers;
      const rosterIds = Array.isArray(rosterIdsRaw)
        ? Array.from(
            new Set(
              rosterIdsRaw
                .filter((item): item is string => typeof item === 'string')
                .map((item) => normalizeCedula(item))
                .filter((item) => item.length >= 4)
            )
          )
        : [];

      const rosterPlayersRaw = (roster as { rosterPlayers?: unknown }).rosterPlayers;
      const rosterPlayers = Array.isArray(rosterPlayersRaw)
        ? rosterPlayersRaw
            .map((item) => {
              if (!item || typeof item !== 'object') {
                return null;
              }

              const displayName =
                typeof (item as { displayName?: unknown }).displayName === 'string'
                  ? (item as { displayName: string }).displayName.trim()
                  : '';

              const identificationNumberSource =
                (item as { identificationNumber?: unknown }).identificationNumber ??
                (item as { playerId?: unknown }).playerId;

              const identificationNumber =
                typeof identificationNumberSource === 'string'
                  ? normalizeCedula(identificationNumberSource)
                  : '';

              if (!displayName || identificationNumber.length < 4) {
                return null;
              }

              return {
                displayName,
                identificationNumber
              } as RosterPlayerView;
            })
            .filter((item): item is RosterPlayerView => Boolean(item))
        : [];

      setManagerRosterCedulas(rosterIds);
      setManagerRosterPlayers(rosterPlayers);
      setManagerLineupEntries((current) =>
        current
          .filter((entry) => rosterIds.includes(entry.identificationNumber))
          .sort((a, b) => a.battingOrder - b.battingOrder)
      );

      if (!opts?.silent) {
        setManagerUiStatus({
          kind: 'success',
          message: `Contexto activado. Roster oficial cargado para ${context.teamId} (${rosterIds.length} jugador(es)).`
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo revisar el roster oficial.';

      if (message.includes('No existe roster oficial para el equipo')) {
        setManagerRosterCedulas([]);
        setManagerRosterPlayers([]);
        setManagerLineupEntries([]);

        if (!opts?.silent) {
          setManagerUiStatus({
            kind: 'success',
            message: `Contexto activado para ${context.teamId} en ${context.tournamentId}. Aun no hay roster guardado.`
          });
        }

        return;
      }

      setManagerUiStatus({ kind: 'error', message: adaptManagerError(message) });
    } finally {
      setManagerSubmitting(false);
    }
  };

  const activateManagerContext = async () => {
    const context = buildManagerContext();

    if (!context.tournamentId || !context.teamId || !context.gameId || !context.managerId) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Completa tournamentId, teamId, gameId y managerId para activar el contexto del perfil.'
      });
      return;
    }

    setManagerContextReady(true);
    setManagerUiStatus({ kind: 'idle', message: '' });
    await loadRosterFromContext(context);
  };

  const pushRosterCedula = () => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Primero activa el contexto de torneo/equipo en perfil antes de editar roster o lineup.'
      });
      return;
    }

    const normalized = normalizeCedula(managerRosterCedulaDraft);

    if (normalized.length < 4) {
      setManagerUiStatus({ kind: 'error', message: 'Ingresa una cedula valida (minimo 4 caracteres).' });
      return;
    }

    if (managerRosterCedulas.includes(normalized)) {
      setManagerUiStatus({ kind: 'error', message: `La cedula ${normalized} ya esta en el draft del roster.` });
      return;
    }

    setManagerRosterCedulas((current) => [...current, normalized]);
    setManagerRosterCedulaDraft('');
    setManagerUiStatus({ kind: 'idle', message: '' });
  };

  const removeRosterCedula = (identificationNumber: string) => {
    setManagerRosterCedulas((current) => current.filter((id) => id !== identificationNumber));
    setManagerLineupEntries((current) =>
      current.filter((entry) => entry.identificationNumber !== identificationNumber)
    );
  };

  const submitRosterToTournament = async () => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Primero activa el contexto en perfil (torneo, equipo, juego y manager).'
      });
      return;
    }

    const context = buildManagerContext();

    if (!context.tournamentId || !context.teamId || !context.managerId) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Debes indicar tournamentId, teamId y managerId antes de guardar roster.'
      });
      return;
    }

    if (managerRosterCedulas.length === 0) {
      setManagerUiStatus({ kind: 'error', message: 'Agrega al menos una cedula al roster antes de guardar.' });
      return;
    }

    setManagerSubmitting(true);
    setManagerUiStatus({ kind: 'idle', message: '' });

    try {
      await postOfficialScoring(`tournaments/${context.tournamentId}/teams/${context.teamId}/roster`, {
        managerId: context.managerId,
        playerIdentificationNumbers: managerRosterCedulas
      });

      await loadRosterFromContext(context, { silent: true });

      setManagerUiStatus({
        kind: 'success',
        message: `Roster guardado para ${context.teamId} en ${context.tournamentId}.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar el roster.';
      setManagerUiStatus({ kind: 'error', message: adaptManagerError(message) });
    } finally {
      setManagerSubmitting(false);
    }
  };

  const upsertLineupEntry = () => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Primero activa el contexto de torneo/equipo en tu perfil.'
      });
      return;
    }

    const identificationNumber = normalizeCedula(managerLineupCedulaDraft);
    const battingOrder = Number.parseInt(managerLineupBattingOrderDraft, 10);
    const fieldPosition = managerLineupFieldPositionDraft.trim().toUpperCase();

    if (identificationNumber.length < 4) {
      setManagerUiStatus({ kind: 'error', message: 'Selecciona una cedula valida para el lineup.' });
      return;
    }

    if (!managerRosterCedulas.includes(identificationNumber)) {
      setManagerUiStatus({
        kind: 'error',
        message: 'La cedula del lineup debe existir en el roster oficial de este equipo.'
      });
      return;
    }

    if (!Number.isInteger(battingOrder) || battingOrder < 1 || battingOrder > 99) {
      setManagerUiStatus({ kind: 'error', message: 'La posicion de bateo debe ser un numero entre 1 y 99.' });
      return;
    }

    if (!fieldPositionOptions.includes(fieldPosition)) {
      setManagerUiStatus({
        kind: 'error',
        message: `Posicion de juego invalida. Usa: ${fieldPositionOptions.join(', ')}.`
      });
      return;
    }

    const duplicatedOrder = managerLineupEntries.find(
      (entry) => entry.battingOrder === battingOrder && entry.identificationNumber !== identificationNumber
    );

    if (duplicatedOrder) {
      setManagerUiStatus({
        kind: 'error',
        message: `El orden ${battingOrder} ya esta asignado a ${duplicatedOrder.identificationNumber}.`
      });
      return;
    }

    setManagerLineupEntries((current) => {
      const next = current.filter((entry) => entry.identificationNumber !== identificationNumber);
      next.push({ identificationNumber, battingOrder, fieldPosition });
      return next.sort((a, b) => a.battingOrder - b.battingOrder);
    });

    setManagerLineupCedulaDraft('');
    setManagerLineupBattingOrderDraft(String(managerLineupEntries.length + 1));
    setManagerLineupFieldPositionDraft('P');
    setManagerUiStatus({ kind: 'idle', message: '' });
  };

  const removeLineupEntry = (identificationNumber: string) => {
    setManagerLineupEntries((current) =>
      current.filter((entry) => entry.identificationNumber !== identificationNumber)
    );
  };

  const buildLineupFromRoster = () => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Activa primero tu contexto de torneo/equipo para crear el lineup.'
      });
      return;
    }

    if (managerRosterCedulas.length === 0) {
      setManagerUiStatus({ kind: 'error', message: 'Primero carga o arma un roster con cedulas.' });
      return;
    }

    const autoPositions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
    const seeded = managerRosterCedulas.map((identificationNumber, index) => ({
      identificationNumber,
      battingOrder: index + 1,
      fieldPosition: autoPositions[Math.min(index, autoPositions.length - 1)]
    }));

    setManagerLineupEntries(seeded);
    setManagerUiStatus({ kind: 'success', message: 'Lineup base generado desde el roster. Ajusta posiciones si quieres.' });
  };

  const submitLineupToGame = async () => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Activa primero el contexto en perfil antes de enviar lineup.'
      });
      return;
    }

    const context = buildManagerContext();

    if (!context.gameId || !context.tournamentId || !context.teamId || !context.managerId) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Debes indicar gameId, tournamentId, teamId y managerId antes de enviar lineup.'
      });
      return;
    }

    if (managerLineupEntries.length === 0) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Primero construye el lineup indicando orden de bateo y posicion de juego.'
      });
      return;
    }

    const sortedEntries = [...managerLineupEntries].sort((a, b) => a.battingOrder - b.battingOrder);

    const missingFromRoster = sortedEntries.find(
      (entry) => !managerRosterCedulas.includes(entry.identificationNumber)
    );

    if (missingFromRoster) {
      setManagerUiStatus({
        kind: 'error',
        message: `La cedula ${missingFromRoster.identificationNumber} no esta en el roster oficial del equipo.`
      });
      return;
    }

    const hasNonConsecutiveOrder = sortedEntries.some((entry, index) => entry.battingOrder !== index + 1);
    if (hasNonConsecutiveOrder) {
      setManagerUiStatus({
        kind: 'error',
        message: 'El lineup debe usar orden de bateo consecutivo iniciando en 1.'
      });
      return;
    }

    setManagerSubmitting(true);
    setManagerUiStatus({ kind: 'idle', message: '' });

    try {
      await postOfficialScoring(`games/${context.gameId}/lineups`, {
        tournamentId: context.tournamentId,
        teamId: context.teamId,
        managerId: context.managerId,
        playerIdentificationNumbers: sortedEntries.map((entry) => entry.identificationNumber),
        lineupEntries: sortedEntries
      });

      setManagerUiStatus({
        kind: 'success',
        message: `Lineup enviado para ${context.teamId} en juego ${context.gameId}.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo enviar el lineup.';
      setManagerUiStatus({ kind: 'error', message: adaptManagerError(message) });
    } finally {
      setManagerSubmitting(false);
    }
  };

  return (
    <section className="managerWorkspace" aria-label="Flujo manager en vivo">
      <article className="managerCard">
        <h2>Perfil manager</h2>
        <p>
          Al ingresar al perfil, selecciona torneo, equipo, juego y manager para activar el contexto antes de
          revisar roster o crear lineup.
        </p>

        <label className="managerField">
          <span>Tournament ID</span>
          <input
            value={managerTournamentId}
            onChange={(event) => updateManagerTournamentId(event.target.value)}
            autoComplete="off"
          />
        </label>

        <label className="managerField">
          <span>Team ID</span>
          <input value={managerTeamId} onChange={(event) => updateManagerTeamId(event.target.value)} autoComplete="off" />
        </label>

        <label className="managerField">
          <span>Game ID</span>
          <input value={managerGameId} onChange={(event) => updateManagerGameId(event.target.value)} autoComplete="off" />
        </label>

        <label className="managerField">
          <span>Manager ID</span>
          <input
            value={managerProfileId}
            onChange={(event) => updateManagerProfileId(event.target.value)}
            autoComplete="off"
          />
        </label>

        <button
          type="button"
          className="managerButtonSolid"
          disabled={managerSubmitting}
          onClick={activateManagerContext}
        >
          {managerContextReady ? 'Actualizar contexto activo' : 'Activar contexto de manager'}
        </button>

        <p className="managerStateText">Estado: {managerContextReady ? 'Contexto activo' : 'Contexto pendiente'}</p>
      </article>

      <article className="managerCard">
        <h2>Roster oficial del equipo</h2>
        <p>
          Un manager puede dirigir varios equipos en torneos distintos, pero no dos equipos dentro del mismo torneo.
        </p>

        {managerContextReady ? (
          <button
            type="button"
            className="managerButtonOutline"
            disabled={managerSubmitting}
            onClick={() => loadRosterFromContext(buildManagerContext())}
          >
            Revisar roster oficial
          </button>
        ) : (
          <div className="managerWarning">Activa primero el contexto desde Perfil para revisar roster.</div>
        )}

        <label className="managerField">
          <span>Agregar cedula al roster</span>
          <input
            value={managerRosterCedulaDraft}
            onChange={(event) => setManagerRosterCedulaDraft(event.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="V12345678"
          />
        </label>

        <button
          type="button"
          className="managerButtonSolid"
          disabled={managerSubmitting}
          onClick={pushRosterCedula}
        >
          Agregar cedula al draft
        </button>

        {managerRosterCedulas.length > 0 ? (
          <div className="chipWrap">
            {managerRosterCedulas.map((id) => (
              <button key={id} type="button" className="chip" onClick={() => removeRosterCedula(id)}>
                {rosterNamesByCedula.get(id) ? `${rosterNamesByCedula.get(id)} · ${id}` : id} · quitar
              </button>
            ))}
          </div>
        ) : null}

        {managerRosterPlayers.length > 0 ? (
          <div className="managerInlineList">
            <h3>Roster cargado desde API</h3>
            {managerRosterPlayers.map((player) => (
              <p key={player.identificationNumber}>
                {player.displayName} · {player.identificationNumber}
              </p>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          className="managerButtonSolid"
          disabled={managerSubmitting}
          onClick={submitRosterToTournament}
        >
          Guardar roster en torneo
        </button>
      </article>

      <article className="managerCard">
        <h2>Builder de lineup</h2>
        <p>
          Selecciona cedula, posicion de bateo y posicion de juego. Solo se permiten cedulas incluidas en el roster
          oficial del equipo.
        </p>

        {managerRosterCedulas.length > 0 ? (
          <div className="chipWrap">
            {managerRosterCedulas.map((id) => (
              <button key={`lineup-${id}`} type="button" className="chipSubtle" onClick={() => setManagerLineupCedulaDraft(id)}>
                {id}
              </button>
            ))}
          </div>
        ) : null}

        <label className="managerField">
          <span>Cedula para lineup</span>
          <input
            value={managerLineupCedulaDraft}
            onChange={(event) => setManagerLineupCedulaDraft(event.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
          />
        </label>

        <label className="managerField">
          <span>Posicion de bateo</span>
          <input
            value={managerLineupBattingOrderDraft}
            onChange={(event) => setManagerLineupBattingOrderDraft(event.target.value)}
            inputMode="numeric"
          />
        </label>

        <label className="managerField">
          <span>Posicion de juego (P, C, 1B, 2B, 3B, SS, LF, CF, RF, DH)</span>
          <input
            value={managerLineupFieldPositionDraft}
            onChange={(event) => setManagerLineupFieldPositionDraft(event.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
          />
        </label>

        <div className="managerButtonRow">
          <button
            type="button"
            className="managerButtonSolid"
            disabled={managerSubmitting}
            onClick={upsertLineupEntry}
          >
            Agregar o actualizar entrada
          </button>
          <button
            type="button"
            className="managerButtonOutline"
            disabled={managerSubmitting}
            onClick={buildLineupFromRoster}
          >
            Generar lineup base
          </button>
        </div>

        {managerLineupEntries.length > 0 ? (
          <div className="managerInlineList">
            <h3>Lineup draft</h3>
            {managerLineupEntries.map((entry) => (
              <button
                key={`${entry.identificationNumber}-${entry.battingOrder}`}
                type="button"
                className="lineupEntry"
                onClick={() => removeLineupEntry(entry.identificationNumber)}
              >
                #{entry.battingOrder} · {entry.identificationNumber} · {entry.fieldPosition} · quitar
              </button>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          className="managerButtonOutline"
          disabled={managerSubmitting}
          onClick={submitLineupToGame}
        >
          Enviar lineup con posiciones
        </button>
      </article>

      {managerUiStatus.kind !== 'idle' ? (
        <div className={managerUiStatus.kind === 'success' ? 'managerStatus success' : 'managerStatus error'}>
          {managerUiStatus.message}
        </div>
      ) : null}
    </section>
  );
}
