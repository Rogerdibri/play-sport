'use client';

import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { assignBattingOrder, availableLineupPositions, findDuplicateFieldPosition } from '@playsport/shared';
import type { PresentOfficial, TeamSheet } from '@playsport/shared';
import { demoCalendar, formatGameName, resolveParticipant } from './demo-calendar';
import { fillMissingDemoJerseys, getDemoJerseyNumber } from './demo-players';
import DemoJerseyAssignments from './demo-jersey-assignments';
import OfficialRunScoring from './official-run-scoring';
import LiveScoringHeader from './live-scoring-header';
import { DemoRecipientLinks, OfficialEntryForm, officialRoleLabels, readTeamSheets } from './team-sheets';
import { fieldPositionLabels, privatePositions as fieldPositionOptions } from './private-scorecard';

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

type FieldRepresentative = RosterPlayerView & {
  authorizedByManagerId: string;
  authorizedAt: string;
};

function readRepresentative(payload: unknown): FieldRepresentative | null {
  if (!payload || typeof payload !== 'object' || !('representative' in payload)) {
    throw new Error('No se pudo leer la autorización del representante.');
  }
  const value = payload.representative;
  if (value === null) return null;
  if (
    !value || typeof value !== 'object' ||
    !('displayName' in value) || typeof value.displayName !== 'string' ||
    !('identificationNumber' in value) || typeof value.identificationNumber !== 'string' ||
    !('authorizedByManagerId' in value) || typeof value.authorizedByManagerId !== 'string' ||
    !('authorizedAt' in value) || typeof value.authorizedAt !== 'string'
  ) {
    throw new Error('La autorización del representante contiene datos inválidos.');
  }
  return {
    displayName: value.displayName,
    identificationNumber: value.identificationNumber,
    authorizedByManagerId: value.authorizedByManagerId,
    authorizedAt: value.authorizedAt
  };
}

type LineupEntryDraft = {
  identificationNumber: string;
  battingOrder: number | null;
  fieldPosition: string;
  lineupRole: 'PLAYER' | 'DP' | 'FLEX' | 'EH';
  jerseyNumber: string;
};

const lineupRoleOptions: Array<{ value: LineupEntryDraft['lineupRole']; label: string }> = [
  { value: 'PLAYER', label: 'Jugador regular' },
  { value: 'DP', label: 'Bateador asignado' },
  { value: 'FLEX', label: 'Jugador flexible · defensa sin turno' },
  { value: 'EH', label: 'Bateador extra' }
];
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
  if (
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('ERR_CONNECTION_REFUSED')
  ) {
    return 'No hay conexión con el servicio de anotación. Verifica que esté activo y vuelve a intentarlo.';
  }

  if (message.includes('ya pertenece al roster del equipo')) {
    return 'Esta cedula ya esta en otro equipo dentro de este mismo torneo. Si puede jugar en otro equipo en torneos distintos.';
  }

  if (message.includes('ya dirige el equipo')) {
    return 'Ese dirigente ya dirige otro equipo dentro del mismo torneo. Puede dirigir en torneos diferentes.';
  }

  if (message.includes('no existe en el registro global')) {
    return 'Esta cedula no existe en el registro global. Registra al jugador una sola vez y luego vuelve a intentarlo.';
  }

  return message
    .replace(/\btournamentId\b/g, 'identificador del torneo')
    .replace(/\bteamId\b/g, 'identificador del equipo')
    .replace(/\bgameId\b/g, 'identificador del juego')
    .replace(/\bmanagerId\b/g, 'identificador del dirigente')
    .replace(/\bbattingOrder\b/g, 'orden de bateo')
    .replace(/\bfieldPosition\b/g, 'posición defensiva')
    .replace(/\bjerseyNumber\b/g, 'número de camiseta')
    .replace(/\blineupEntries\b/g, 'entradas de la alineación')
    .replace(/\blineupRole\b/g, 'rol de la alineación')
    .replace(/\bDP\b/g, 'bateador asignado')
    .replace(/\bFLEX\b/g, 'jugador flexible')
    .replace(/\bEH\b/g, 'bateador extra')
    .replace(/\bmanager\b/gi, 'dirigente')
    .replace(/\broster\b/gi, 'plantilla')
    .replace(/\blineup\b/gi, 'alineación');
}

export default function LiveScoringManagerDemo({ rival = false }: { rival?: boolean }) {
  const managerTournamentId = 'tour-global-1';
  const managerTeamId = rival ? 'team-B' : 'team-A';
  const managerGameId = 'game-global-1';
  const managerProfileId = rival ? 'mgr-B' : 'mgr-A';
  const managerTeamName = rival ? 'Leones del Norte' : 'Tigres del Valle';
  const exampleIdentification = rival ? 'PRUEBA010' : 'PRUEBA001';
  const [managerContextReady, setManagerContextReady] = useState(false);

  const [managerRosterCedulas, setManagerRosterCedulas] = useState<string[]>([]);
  const [managerRosterPlayers, setManagerRosterPlayers] = useState<RosterPlayerView[]>([]);

  const [managerLineupCedulaDraft, setManagerLineupCedulaDraft] = useState('');
  const [managerLineupRoleDraft, setManagerLineupRoleDraft] = useState<LineupEntryDraft['lineupRole']>('PLAYER');
  const [managerLineupJerseyNumberDraft, setManagerLineupJerseyNumberDraft] = useState('');
  const [managerLineupEntries, setManagerLineupEntries] = useState<LineupEntryDraft[]>([]);
  const [presentSubstitutes, setPresentSubstitutes] = useState<string[]>([]);
  const [presentOfficials, setPresentOfficials] = useState<PresentOfficial[]>([]);
  const [submittedTeamSheet, setSubmittedTeamSheet] = useState<TeamSheet | null>(null);
  const availablePositions = useMemo(() => availableLineupPositions(
    managerLineupEntries, normalizeCedula(managerLineupCedulaDraft)
  ).filter((position) => managerLineupRoleDraft !== 'FLEX' || position !== 'NA'),
  [managerLineupEntries, managerLineupCedulaDraft, managerLineupRoleDraft]);

  useEffect(() => {
    if (submittedTeamSheet) return;
    const filled = fillMissingDemoJerseys(managerLineupEntries);
    if (filled !== managerLineupEntries) setManagerLineupEntries(filled);
  }, [managerLineupEntries, submittedTeamSheet]);

  const [managerUiStatus, setManagerUiStatus] = useState<UiStatus>({ kind: 'idle', message: '' });
  const [managerSubmitting, setManagerSubmitting] = useState(false);
  const [managerInitializationRequested, setManagerInitializationRequested] = useState(true);
  const [step, setStep] = useState<'game' | 'representative' | 'lineup' | 'scorecard'>('game');
  const [representativeCedula, setRepresentativeCedula] = useState('');
  const [authorizedRepresentative, setAuthorizedRepresentative] = useState<FieldRepresentative | null>(null);
  const stepHeading = useRef<ComponentRef<'h2'>>(null);
  const statusMessage = useRef<ComponentRef<'div'>>(null);
  useEffect(() => {
    stepHeading.current?.focus();
  }, [step]);
  useEffect(() => {
    if (managerUiStatus.kind === 'error') statusMessage.current?.focus();
  }, [managerUiStatus, step]);

  const calendarGames = demoCalendar.filter((game) => game.tournamentId === managerTournamentId.trim());
  const selectedGame = calendarGames.find((game) => game.id === managerGameId);
  const selectedHome = selectedGame ? resolveParticipant(selectedGame.home, demoCalendar) : null;
  const selectedAway = selectedGame ? resolveParticipant(selectedGame.away, demoCalendar) : null;
  const hasValidAssignment = Boolean(
    selectedGame && !selectedGame.result && selectedHome && selectedAway &&
    [selectedHome.teamId, selectedAway.teamId].includes(managerTeamId.trim())
  );

  const rosterNamesByCedula = useMemo(() => {
    const map = new Map<string, string>();

    for (const player of managerRosterPlayers) {
      map.set(player.identificationNumber, player.displayName);
    }

    return map;
  }, [managerRosterPlayers]);
  const representativeCandidate = managerRosterPlayers.find(
    (player) => player.identificationNumber === normalizeCedula(representativeCedula) &&
      managerRosterCedulas.includes(player.identificationNumber)
  );

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
    try {
      const response = await fetch(`${officialScoringApiBase}/${path}`, { signal: AbortSignal.timeout(10000) });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = parseApiMessage(body) ?? `Error ${response.status}`;
        throw new Error(message);
      }
      return body;
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error('La carga del partido tardó demasiado. Pulsa «Cargar datos del partido asignado» para reintentar.');
      }
      throw error;
    }
  };

  const loadSubmittedTeamSheet = async (context: ManagerContext) => {
    const snapshot = readTeamSheets(await getOfficialScoring(
      `games/${context.gameId}/team-sheets?${new URLSearchParams({
        tournamentId: context.tournamentId, userId: context.managerId, role: 'manager'
      })}`
    ));
    if (snapshot.gameId !== context.gameId || snapshot.tournamentId !== context.tournamentId ||
        snapshot.ownTeamId !== context.teamId) {
      throw new Error('La entrega recibida no corresponde al partido y equipo asignados.');
    }
    return snapshot.sheets.find((sheet) => sheet.teamId === context.teamId) ?? null;
  };

  const restoreSubmittedTeamSheet = (sheet: TeamSheet | null) => {
    setSubmittedTeamSheet(sheet);
    if (!sheet) return;
    setManagerLineupEntries(sheet.lineup.map((entry) => ({
      identificationNumber: entry.identificationNumber,
      battingOrder: entry.battingOrder,
      fieldPosition: entry.fieldPosition,
      lineupRole: entry.lineupRole,
      jerseyNumber: entry.jerseyNumber ?? ''
    })));
    setPresentSubstitutes(sheet.presentSubstitutes.map((player) => player.identificationNumber));
    setPresentOfficials(sheet.presentOfficials);
  };

  const loadRosterFromContext = async (context: ManagerContext, opts?: { silent?: boolean }) => {
    setManagerSubmitting(true);

    try {
      const [roster, representativePayload, submittedSheet] = await Promise.all([
        getOfficialScoring(`tournaments/${context.tournamentId}/teams/${context.teamId}/roster?visibility=free`),
        getOfficialScoring(`games/${context.gameId}/teams/${context.teamId}/representative?tournamentId=${context.tournamentId}`),
        loadSubmittedTeamSheet(context)
      ]);
      const representative = readRepresentative(representativePayload);
      setAuthorizedRepresentative(representative);
      setRepresentativeCedula((current) => current || representative?.identificationNumber || '');
      if (!representative) {
        setStep((current) => current === 'lineup' ? 'representative' : current);
      }

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
        assignBattingOrder(current
          .filter((entry) => rosterIds.includes(entry.identificationNumber))
          .sort(
            (a, b) =>
              (a.battingOrder ?? Number.MAX_SAFE_INTEGER) -
              (b.battingOrder ?? Number.MAX_SAFE_INTEGER)
          ))
      );
      restoreSubmittedTeamSheet(submittedSheet);

      if (!opts?.silent) {
        setManagerUiStatus({
          kind: 'success',
          message: `Contexto activado. Plantilla oficial cargada para ${context.teamId} (${rosterIds.length} jugadores).`
        });
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo revisar la plantilla oficial.';

      if (message.includes('No existe roster oficial para el equipo')) {
        setManagerRosterCedulas([]);
        setManagerRosterPlayers([]);
        setManagerLineupEntries([]);
        setAuthorizedRepresentative(null);
        setSubmittedTeamSheet(null);

        if (!opts?.silent) {
          setManagerUiStatus({
            kind: 'success',
            message: `Contexto activado para ${context.teamId} en ${context.tournamentId}. Aún no hay una plantilla guardada.`
          });
        }

        return true;
      }

      setManagerUiStatus({ kind: 'error', message: adaptManagerError(message) });
      return false;
    } finally {
      setManagerSubmitting(false);
    }
  };

  const activateManagerContext = async () => {
    const context = buildManagerContext();

    if (!hasValidAssignment) {
      setManagerUiStatus({
        kind: 'error',
        message: 'El organizador o anotador debe asignar un partido válido para tu equipo. Los cruces pendientes requieren resultados oficiales.'
      });
      return;
    }

    if (!context.tournamentId || !context.teamId || !context.gameId || !context.managerId) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Completa los identificadores del torneo, equipo, juego y dirigente para activar el contexto del perfil.'
      });
      return;
    }

    setManagerUiStatus({ kind: 'idle', message: '' });
    const contextLoaded = await loadRosterFromContext(context);
    setManagerContextReady(contextLoaded);
  };

  useEffect(() => {
    if (managerInitializationRequested) {
      setManagerInitializationRequested(false);
      void activateManagerContext();
    }
  }, [managerInitializationRequested, activateManagerContext]);

  const authorizeRepresentative = async () => {
    if (!managerContextReady || !representativeCandidate) {
      setManagerUiStatus({ kind: 'error', message: 'Introduce la cédula de un integrante de la plantilla oficial de tu equipo.' });
      return;
    }
    setManagerSubmitting(true);
    setManagerUiStatus({ kind: 'idle', message: '' });
    try {
      const result = await postOfficialScoring(
        `games/${managerGameId}/teams/${managerTeamId}/representative`,
        {
          tournamentId: managerTournamentId,
          managerId: managerProfileId,
          identificationNumber: representativeCandidate.identificationNumber
        }
      );
      const representative = readRepresentative(result);
      if (!representative) throw new Error('El servicio no confirmó la autorización del representante.');
      setAuthorizedRepresentative(representative);
      setStep('lineup');
      setManagerUiStatus({
        kind: 'success',
        message: `${representative.displayName} está autorizado para representarte en el campo solo durante este partido.`
      });
    } catch (error) {
      setManagerUiStatus({
        kind: 'error',
        message: adaptManagerError(error instanceof Error ? error.message : 'No se pudo autorizar al representante.')
      });
    } finally {
      setManagerSubmitting(false);
    }
  };

  const selectLineupPlayer = (identificationNumber: string) => {
    setManagerLineupCedulaDraft(identificationNumber);
    const existing = managerLineupEntries.find(
      (entry) => entry.identificationNumber === normalizeCedula(identificationNumber)
    );
    setManagerLineupJerseyNumberDraft(existing?.jerseyNumber || getDemoJerseyNumber(identificationNumber));
    if (existing) {
      setManagerLineupRoleDraft(existing.lineupRole);
    }
  };

  const upsertLineupEntry = (selectedPosition: string) => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Primero activa el contexto de torneo/equipo en tu perfil.'
      });
      return;
    }

    const identificationNumber = normalizeCedula(managerLineupCedulaDraft);
    const battingOrder = managerLineupRoleDraft === 'FLEX' ? null : 1;
    const fieldPosition = selectedPosition.trim().toUpperCase();
    const jerseyNumber = managerLineupJerseyNumberDraft.trim();

    if (identificationNumber.length < 4) {
      setManagerUiStatus({ kind: 'error', message: 'Selecciona una cédula válida para la alineación.' });
      return;
    }

    if (!managerRosterCedulas.includes(identificationNumber)) {
      setManagerUiStatus({
        kind: 'error',
        message: 'La cédula de la alineación debe existir en la plantilla oficial de este equipo.'
      });
      return;
    }

    if (!fieldPositionOptions.includes(fieldPosition)) {
      setManagerUiStatus({
        kind: 'error',
        message: `Posición de juego inválida. Usa: ${fieldPositionOptions.map((position) => fieldPositionLabels[position]).join(', ')}.`
      });
      return;
    }

    if (managerLineupRoleDraft === 'FLEX' && fieldPosition === 'NA') {
      setManagerUiStatus({ kind: 'error', message: 'El jugador flexible debe tener una posición defensiva.' });
      return;
    }

    const otherEntries = managerLineupEntries.filter((entry) => entry.identificationNumber !== identificationNumber);
    const occupyingPlayer = otherEntries.find((entry) => fieldPosition !== 'NA' && entry.fieldPosition === fieldPosition);
    if (occupyingPlayer) {
      setManagerUiStatus({
        kind: 'error',
        message: `${fieldPositionLabels[fieldPosition]} ya está asignado a ${occupyingPlayer.identificationNumber}. Selecciona una posición disponible.`
      });
      return;
    }
    if (otherEntries.length >= 14) {
      setManagerUiStatus({ kind: 'error', message: 'La alineación permite hasta 13 bateadores y un jugador flexible.' });
      return;
    }
    if (battingOrder !== null && otherEntries.filter((entry) => entry.battingOrder !== null).length >= 13) {
      setManagerUiStatus({ kind: 'error', message: 'La alineación permite hasta 13 bateadores.' });
      return;
    }
    if (managerLineupRoleDraft === 'FLEX' && otherEntries.some((entry) => entry.lineupRole === 'FLEX')) {
      setManagerUiStatus({ kind: 'error', message: 'La alineación permite un solo jugador flexible.' });
      return;
    }

    if (!/^\d{1,2}$/.test(jerseyNumber)) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Ingresa un numero de camiseta entre 0 y 99.'
      });
      return;
    }

    const duplicatedJerseyNumber = managerLineupEntries.find(
      (entry) =>
        entry.jerseyNumber === jerseyNumber && entry.identificationNumber !== identificationNumber
    );

    if (duplicatedJerseyNumber) {
      setManagerUiStatus({
        kind: 'error',
        message: `El numero de camiseta ${jerseyNumber} ya esta asignado a ${duplicatedJerseyNumber.identificationNumber}.`
      });
      return;
    }

    setManagerLineupEntries((current) => {
      const updated = { identificationNumber, battingOrder, fieldPosition, lineupRole: managerLineupRoleDraft, jerseyNumber };
      const next = current.some((entry) => entry.identificationNumber === identificationNumber)
        ? current.map((entry) => entry.identificationNumber === identificationNumber ? updated : entry)
        : [...current, updated];
      return assignBattingOrder(next);
    });

    setManagerLineupCedulaDraft('');
    setManagerLineupRoleDraft('PLAYER');
    setManagerLineupJerseyNumberDraft('');
    setManagerUiStatus({ kind: 'idle', message: '' });
  };

  const removeLineupEntry = (identificationNumber: string) => {
    setManagerLineupEntries((current) =>
      assignBattingOrder(current.filter((entry) => entry.identificationNumber !== identificationNumber))
    );
  };

  const buildLineupFromRoster = () => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Activa primero tu contexto de torneo y equipo para crear la alineación.'
      });
      return;
    }

    if (managerRosterCedulas.length === 0) {
      setManagerUiStatus({ kind: 'error', message: 'Primero carga o arma una plantilla con cédulas.' });
      return;
    }

    const autoPositions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF4', 'SF', 'LF', 'CF'];
    const seeded = managerRosterCedulas.slice(0, 9).map((identificationNumber, index) => ({
      identificationNumber,
      battingOrder: index + 1,
      fieldPosition: autoPositions[Math.min(index, autoPositions.length - 1)],
      lineupRole: 'PLAYER' as const,
      jerseyNumber: getDemoJerseyNumber(identificationNumber)
    }));

    setManagerLineupEntries(seeded);
    setManagerUiStatus({ kind: 'success', message: 'Alineación base generada desde la plantilla. Puedes ajustar las posiciones.' });
  };

  const submitLineupToGame = async () => {
    if (!authorizedRepresentative) {
      setStep('representative');
      setManagerUiStatus({ kind: 'error', message: 'Autoriza primero a tu representante en el campo para este partido.' });
      return;
    }
    if (!hasValidAssignment) {
      setManagerUiStatus({ kind: 'error', message: 'No hay un partido asignado disponible para tu equipo. Contacta al organizador o anotador.' });
      return;
    }
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Activa primero el contexto en tu perfil antes de enviar la alineación.'
      });
      return;
    }

    const context = buildManagerContext();

    if (!context.gameId || !context.tournamentId || !context.teamId || !context.managerId) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Indica los identificadores del juego, torneo, equipo y dirigente antes de enviar la alineación.'
      });
      return;
    }

    setManagerSubmitting(true);
    setManagerUiStatus({ kind: 'idle', message: '' });
    try {
      const existingSheet = await loadSubmittedTeamSheet(context);
      if (existingSheet) {
        restoreSubmittedTeamSheet(existingSheet);
        setManagerUiStatus({
          kind: 'success',
          message: 'Se recuperó la alineación ya entregada y sus cambios confirmados. No se volvió a enviar ni se modificó el historial.'
        });
        setStep('scorecard');
        return;
      }
      if (submittedTeamSheet) {
        restoreSubmittedTeamSheet(null);
        throw new Error('No se encontró la entrega anterior. Revisa el borrador y los datos del partido antes de enviarlo.');
      }

      if (managerLineupEntries.length === 0) {
        setManagerUiStatus({
          kind: 'error',
          message: 'Primero agrega jugadores a la alineación indicando su posición de juego.'
        });
        return;
      }

      const completedEntries = fillMissingDemoJerseys(managerLineupEntries);
      if (completedEntries !== managerLineupEntries) setManagerLineupEntries(completedEntries);
      const sortedEntries = [...completedEntries].sort(
        (a, b) => (a.battingOrder ?? Number.MAX_SAFE_INTEGER) - (b.battingOrder ?? Number.MAX_SAFE_INTEGER)
      );
      const duplicatePosition = findDuplicateFieldPosition(sortedEntries);
      if (duplicatePosition) {
        setManagerUiStatus({
          kind: 'error',
          message: `La posición ${fieldPositionLabels[duplicatePosition]} está repetida. Corrige el borrador antes de enviar la alineación.`
        });
        return;
      }
      const battingEntries = sortedEntries.filter((entry) => entry.battingOrder !== null);
      const dpCount = sortedEntries.filter((entry) => entry.lineupRole === 'DP').length;
      const flexCount = sortedEntries.filter((entry) => entry.lineupRole === 'FLEX').length;
      if (battingEntries.length < 9 || battingEntries.length > 13 || sortedEntries.length > 14) {
        setManagerUiStatus({ kind: 'error', message: 'La alineación debe tener de 9 a 13 bateadores y permite un jugador flexible adicional.' });
        return;
      }

      if (dpCount !== flexCount || flexCount > 1) {
        setManagerUiStatus({ kind: 'error', message: 'El bateador asignado y el jugador flexible deben registrarse juntos.' });
        return;
      }
      const missingJerseyNumber = sortedEntries.find((entry) => !/^\d{1,2}$/.test(entry.jerseyNumber));

      if (missingJerseyNumber) {
        setManagerUiStatus({
          kind: 'error',
          message: `Asigna un número de camiseta entre 0 y 99 a ${missingJerseyNumber.identificationNumber} y agrega o actualiza su entrada antes de enviar.`
        });
        return;
      }

      const missingFromRoster = sortedEntries.find(
        (entry) => !managerRosterCedulas.includes(entry.identificationNumber)
      );

      if (missingFromRoster) {
        setManagerUiStatus({
          kind: 'error',
          message: `La cédula ${missingFromRoster.identificationNumber} no está en la plantilla oficial del equipo.`
        });
        return;
      }

      const hasNonConsecutiveOrder = battingEntries.some((entry, index) => entry.battingOrder !== index + 1);
      if (hasNonConsecutiveOrder) {
        setManagerUiStatus({
          kind: 'error',
          message: 'La alineación debe usar un orden de bateo consecutivo comenzando en 1.'
        });
        return;
      }

      await postOfficialScoring(`games/${context.gameId}/lineups`, {
        tournamentId: context.tournamentId,
        teamId: context.teamId,
        managerId: context.managerId,
        playerIdentificationNumbers: sortedEntries.map((entry) => entry.identificationNumber),
        lineupEntries: sortedEntries,
        presentSubstituteIdentificationNumbers: presentSubstitutes.filter((id) =>
          managerRosterCedulas.includes(id) && !sortedEntries.some((entry) => entry.identificationNumber === id)),
        presentOfficials
      });
      setManagerUiStatus({
        kind: 'success',
        message: 'Alineación, suplentes y directivos presentes entregados en las bandejas del organizador, los anotadores autorizados y el dirigente rival.'
      });
      setStep('scorecard');
      try {
        const deliveredSheet = await loadSubmittedTeamSheet(context);
        if (!deliveredSheet) throw new Error('No se encontró la entrega confirmada.');
        restoreSubmittedTeamSheet(deliveredSheet);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'No se pudo consultar la entrega.';
        setManagerUiStatus({
          kind: 'error',
          message: `La alineación se envió y se abrió la planilla, pero no se pudo actualizar su comprobante: ${adaptManagerError(detail)}`
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo enviar la alineación.';
      setManagerUiStatus({ kind: 'error', message: adaptManagerError(message) });
    } finally {
      setManagerSubmitting(false);
    }
  };

  const statusNotice = managerUiStatus.kind === 'idle' ? null : (
    <div
      ref={statusMessage}
      tabIndex={-1}
      role={managerUiStatus.kind === 'error' ? 'alert' : 'status'}
      className={managerUiStatus.kind === 'success' ? 'managerStatus success' : 'managerStatus error'}
    >
      {managerUiStatus.message}
    </div>
  );

  const scorecardOpen = step === 'scorecard' && Boolean(selectedHome && selectedAway);
  return (
    <>
    {!scorecardOpen ? <LiveScoringHeader /> : null}
    <section className="managerWorkspace" aria-label="Gestión del dirigente en vivo">
      {!scorecardOpen ? <>
      <nav className="managerSteps" aria-label="Pasos para preparar el partido">
        <ol>
          <li aria-current={step === 'game' ? 'step' : undefined}>1. Verificar partido</li>
          <li aria-current={step === 'representative' ? 'step' : undefined}>2. Autorizar representante</li>
          <li aria-current={step === 'lineup' ? 'step' : undefined}>3. Preparar alineación</li>
          <li aria-current={step === 'scorecard' ? 'step' : undefined}>4. Partido oficial en vivo</li>
        </ol>
      </nav>
      {step !== 'lineup' ? statusNotice : null}
      </> : null}
      {step === 'game' ? (
      <article className="managerCard managerStepCard">
        <h2 ref={stepHeading} tabIndex={-1}>Partido asignado al dirigente</h2>
        <p>
          El organizador o anotador selecciona el partido. El dirigente recibe el torneo, equipo y juego
          asignados y prepara la alineación del día usando la plantilla oficial ya inscrita.
        </p>

        <label className="managerField">
          <span>Torneo asignado</span>
          <input
            value="Torneo de demostración"
            readOnly
          />
        </label>

        <label className="managerField">
          <span>Equipo asignado</span>
          <input value={selectedHome?.teamId === managerTeamId ? selectedHome.name : selectedAway?.name ?? 'Por definir'} readOnly />
        </label>

        <label className="managerField">
          <span>Partido asignado por el organizador o anotador</span>
          <input
            value={selectedGame ? formatGameName(selectedGame) : 'Sin partido asignado'}
            readOnly
            aria-describedby="calendar-description"
          />
        </label>
        <p id="calendar-description">
          Asignación simulada con datos ficticios. La fase y el número de juego provienen del calendario;
          el dirigente no puede cambiarlos. Los cruces avanzan con resultados oficiales confirmados.
        </p>
        {calendarGames.length === 0 ? (
          <p className="managerWarning">No hay calendario de demostración para este torneo. Usa tour-global-1.</p>
        ) : null}
        {selectedGame ? (
          <p role="status">
            {formatGameName(selectedGame)} · {selectedHome?.name ?? 'Ganador por definir'} contra {selectedAway?.name ?? 'Ganador por definir'}
          </p>
        ) : null}
        <details>
          <summary>Resultados confirmados del calendario de demostración</summary>
          <ul>
            {calendarGames.filter((game) => game.result?.official).map((game) => (
              <li key={game.id}>
                {formatGameName(game)}: {resolveParticipant(game.home, demoCalendar)?.name} {game.result?.home}
                {' – '}{game.result?.away} {resolveParticipant(game.away, demoCalendar)?.name}
              </li>
            ))}
          </ul>
        </details>

        <label className="managerField">
          <span>Perfil del dirigente</span>
          <input
            value={`Dirigente de ${managerTeamName}`}
            readOnly
          />
        </label>

        <button
          type="button"
          className="managerButtonSolid"
          disabled={managerSubmitting || !hasValidAssignment}
          aria-busy={managerSubmitting}
          onClick={activateManagerContext}
        >
          {managerSubmitting ? 'Cargando datos del partido…' : managerContextReady ? 'Actualizar datos del partido asignado' : 'Cargar datos del partido asignado'}
        </button>

        <p className="managerStateText" role="status">Estado: {managerSubmitting ? 'Cargando el partido; espera a que termine.' : managerContextReady ? 'Contexto activo' : 'Contexto pendiente. Carga los datos para habilitar la confirmación.'}</p>
        <button
          type="button"
          className="managerButtonSolid"
          disabled={!managerContextReady || managerSubmitting || !hasValidAssignment}
          onClick={() => {
            setManagerUiStatus({ kind: 'idle', message: '' });
            setStep('representative');
          }}
        >
          Confirmar partido y continuar
        </button>
        <button type="button" className="managerButtonOutline" disabled={!managerContextReady || managerSubmitting} onClick={() => {
          setManagerUiStatus({ kind: 'idle', message: '' });
          setStep('scorecard');
        }}>Ver partido oficial en vivo</button>
        <DemoRecipientLinks />
      </article>
      ) : null}
      {step === 'game' ? <DemoJerseyAssignments assignedPlayers={[
        ...(submittedTeamSheet?.initialLineup ?? []).map((player) => ({ id: player.identificationNumber, jersey: player.jerseyNumber ?? '' })),
        ...managerLineupEntries.map((player) => ({ id: player.identificationNumber, jersey: player.jerseyNumber }))
      ]} /> : null}

      {step === 'representative' ? (
        <article className="managerCard managerStepCard">
          <h2 ref={stepHeading} tabIndex={-1}>Representante en el campo para este partido</h2>
          <p>{selectedGame ? formatGameName(selectedGame) : ''} · {managerTeamName}</p>
          <p>
            Tú sigues actuando desde la cuenta del dirigente. Autoriza a un integrante de tu plantilla
            para que te represente físicamente en el campo. Esta autorización no cambia al dirigente
            permanente ni concede acceso a su cuenta.
          </p>
          <label className="managerField">
            <span>Cédula del representante en el campo</span>
            <input
              value={representativeCedula}
              onChange={(event) => {
                setRepresentativeCedula(event.target.value);
                setManagerUiStatus({ kind: 'idle', message: '' });
              }}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder={`Ej. ${exampleIdentification}`}
              aria-describedby="representative-help"
            />
          </label>
          <p id="representative-help">Para probar, introduce {exampleIdentification} o la cédula de otro integrante de la plantilla oficial.</p>
          {representativeCandidate ? (
            <div className="managerInlineList" aria-live="polite">
              <h3>Datos del integrante de la plantilla</h3>
              <p>Nombre: {representativeCandidate.displayName}</p>
              <p>Cédula: {representativeCandidate.identificationNumber}</p>
              <p>Equipo: {managerTeamName}</p>
            </div>
          ) : representativeCedula.trim() ? (
            <p className="managerWarning" role="status">No se encontró esa cédula en la plantilla oficial de este equipo.</p>
          ) : null}
          {authorizedRepresentative ? (
            <p>Representante autorizado actualmente: {authorizedRepresentative.displayName} · {authorizedRepresentative.identificationNumber}.</p>
          ) : null}
          <div className="managerButtonRow">
            <button type="button" className="managerButtonOutline" disabled={managerSubmitting} onClick={() => {
              setManagerUiStatus({ kind: 'idle', message: '' });
              setStep('game');
            }}>Volver al partido</button>
            <button
              type="button"
              className="managerButtonSolid"
              disabled={managerSubmitting || !managerContextReady || !representativeCandidate}
              onClick={authorizeRepresentative}
            >
              {managerSubmitting ? 'Guardando autorización…' : 'Autorizar para este partido y continuar'}
            </button>
          </div>
        </article>
      ) : null}

      {step === 'scorecard' && selectedHome && selectedAway ? (
        <OfficialRunScoring
          apiBase={officialScoringApiBase}
          tournamentId={managerTournamentId}
          gameId={managerGameId}
          actorId={managerProfileId}
          actorRole="manager"
          ownTeamId={managerTeamId}
          onBack={() => {
            setManagerUiStatus({ kind: 'idle', message: '' });
            setStep('game');
          }}
        />
      ) : null}

      {step === 'lineup' ? (
      <>
      <article className="managerCard managerStepCard">
        <h2 ref={stepHeading} tabIndex={-1}>Preparar alineación del partido</h2>
        <p>{selectedGame ? formatGameName(selectedGame) : ''} · {managerTeamName}</p>
        {authorizedRepresentative ? (
          <p>
            Representante en el campo: <strong>{authorizedRepresentative.displayName}</strong>
            {' · '}{authorizedRepresentative.identificationNumber}. Autorizado por el dirigente para este juego.
          </p>
        ) : (
          <p className="managerWarning">Debes autorizar a un representante antes de enviar la alineación.</p>
        )}
        <button type="button" className="managerButtonOutline" disabled={managerSubmitting} onClick={() => {
          setRepresentativeCedula(authorizedRepresentative?.identificationNumber ?? '');
          setManagerUiStatus({ kind: 'idle', message: '' });
          setStep('representative');
        }}>Volver a la autorización del representante</button>
      </article>

      {submittedTeamSheet ? (
      <article className="managerCard managerStepCard">
        <h2>Alineación ya entregada</h2>
        <p>Se recuperó la entrega guardada del partido, versión {submittedTeamSheet.revision}. No necesitas armarla ni enviarla otra vez.</p>
        <p>Comunica los cambios en el campo al anotador u organizador. Ellos los registran y aquí se reflejan en vivo; no necesitas usar el teléfono para solicitarlos.</p>
        <ul aria-label="Alineación entregada recuperada">
          {submittedTeamSheet.lineup.map((player) => <li key={player.identificationNumber}>
            {player.battingOrder === null ? 'Sin turno' : `Turno ${player.battingOrder}`} · {player.displayName} · {player.identificationNumber}
            {' · '}{lineupRoleOptions.find((option) => option.value === player.lineupRole)?.label}
            {' · '}{fieldPositionLabels[player.fieldPosition]} · camiseta {player.jerseyNumber ?? 'sin asignar'}
          </li>)}
        </ul>
        <h3>Suplentes presentes confirmados</h3>
        {submittedTeamSheet.presentSubstitutes.length ? (
          <ul>{submittedTeamSheet.presentSubstitutes.map((player) => <li key={player.identificationNumber}>{player.displayName} · {player.identificationNumber}{getDemoJerseyNumber(player.identificationNumber) ? ` · Camiseta ${getDemoJerseyNumber(player.identificationNumber)}` : ''}</li>)}</ul>
        ) : <p>No se declararon suplentes presentes.</p>}
        <h3>Directivos presentes</h3>
        {submittedTeamSheet.presentOfficials.length ? (
          <ul>{submittedTeamSheet.presentOfficials.map((official) => <li key={`${official.role}:${official.identificationNumber}`}>
            {officialRoleLabels[official.role]} · {official.displayName} · {official.identificationNumber}
          </li>)}</ul>
        ) : <p>No se declararon directivos presentes.</p>}
        <button type="button" className="managerButtonSolid" disabled={managerSubmitting || !managerContextReady} aria-busy={managerSubmitting} onClick={submitLineupToGame}>
          {managerSubmitting ? 'Recuperando alineación…' : 'Continuar a la planilla de anotaciones'}
        </button>
        {statusNotice}
      </article>
      ) : (
      <article className="managerCard managerStepCard">
        <h2>Constructor de alineación</h2>
        <p>
          Selecciona el jugador, revisa su camiseta y rol y elige su posición. Al elegirla se incorpora inmediatamente a la alineación, sin pulsar otro botón. Solo se permiten cédulas incluidas en la plantilla
          oficial del equipo.
        </p>
        <p>
          Aquí solo se prepara la alineación de este partido. Agregar o quitar un jugador de la
          alineación no modifica la plantilla del torneo. Sus altas, bajas y plazos de modificación
          corresponden a un apartado independiente.
        </p>

        {managerRosterCedulas.length > 0 ? (
          <div className="chipWrap" role="group" aria-label="Jugadores inscritos disponibles para la alineación">
            {managerRosterCedulas.map((id) => (
              <button key={`lineup-${id}`} type="button" className="chipSubtle" onClick={() => selectLineupPlayer(id)}>
                {rosterNamesByCedula.get(id)} · {id}{getDemoJerseyNumber(id) ? ` · Camiseta ${getDemoJerseyNumber(id)}` : ''}
              </button>
            ))}
          </div>
        ) : null}

        <label className="managerField">
          <span>Cédula para la alineación</span>
          <input
            value={managerLineupCedulaDraft}
            onChange={(event) => selectLineupPlayer(event.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
          />
        </label>

        <p>El orden de bateo se asigna automáticamente al agregar jugadores. Si actualizas uno, conserva su lugar; al quitarlo, se ajustan los turnos. El jugador flexible no batea.</p>

        <label className="managerField">
          <span>Rol en la alineación</span>
          <select
            value={managerLineupRoleDraft}
            onChange={(event) => setManagerLineupRoleDraft(event.target.value as LineupEntryDraft['lineupRole'])}
          >
            {lineupRoleOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="managerField">
          <span>Número de camiseta para este juego (0–99)</span>
          <input
            value={managerLineupJerseyNumberDraft}
            onChange={(event) => setManagerLineupJerseyNumberDraft(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
            placeholder="Ej. 12"
          />
        </label>
        <p>Los jugadores ficticios tienen camisetas de prueba precargadas. Puedes cambiar el número antes de elegir la posición.</p>

        <label className="managerField">
          <span>Posición defensiva</span>
          <select
            value=""
            disabled={managerSubmitting || !managerRosterCedulas.includes(normalizeCedula(managerLineupCedulaDraft))}
            onChange={(event) => upsertLineupEntry(event.target.value)}
          >
            <option value="" disabled>Selecciona una posición disponible</option>
            {availablePositions.map((position) => (
              <option key={position} value={position}>{fieldPositionLabels[position] ?? position}</option>
            ))}
          </select>
        </label>
        <p>La posición elegida desaparece del selector de inmediato y el jugador queda agregado. Al quitarlo, su posición vuelve a estar disponible. «Sin posición defensiva» no ocupa una posición en el campo.</p>

        <p>La regla del corredor temporal la configura el organizador del torneo, no el dirigente.</p>

        <div className="managerButtonRow">
          {managerLineupEntries.some((entry) => entry.identificationNumber === normalizeCedula(managerLineupCedulaDraft)) ? (
          <button
            type="button"
            className="managerButtonSolid"
            disabled={managerSubmitting}
            onClick={() => upsertLineupEntry(
              managerLineupEntries.find((entry) => entry.identificationNumber === normalizeCedula(managerLineupCedulaDraft))?.fieldPosition ?? ''
            )}
          >
            Guardar cambios de camiseta y rol
          </button>
          ) : null}
          <button
            type="button"
            className="managerButtonOutline"
            disabled={managerSubmitting}
            onClick={buildLineupFromRoster}
          >
            Generar alineación base
          </button>
        </div>

        {managerLineupEntries.length > 0 ? (
          <div className="managerInlineList">
            <h3>Borrador de alineación · {managerLineupEntries.filter((entry) => entry.battingOrder !== null).length} bateadores / {managerLineupEntries.length} jugadores</h3>
            {managerLineupEntries.map((entry) => (
              <button
                key={`${entry.identificationNumber}-${entry.battingOrder ?? entry.lineupRole}`}
                type="button"
                className="lineupEntry"
                onClick={() => removeLineupEntry(entry.identificationNumber)}
              >
                {entry.battingOrder === null ? 'Sin turno' : `#${entry.battingOrder}`} · {lineupRoleOptions.find((option) => option.value === entry.lineupRole)?.label} · Camiseta {entry.jerseyNumber || '—'} · {rosterNamesByCedula.get(entry.identificationNumber)} · {entry.identificationNumber} · {fieldPositionLabels[entry.fieldPosition]} · quitar de la alineación
              </button>
            ))}
          </div>
        ) : null}

        <h3>Suplentes presentes para este partido</h3>
        <p>Marca solo a quienes ya están en el campo. Esta lista usa la plantilla oficial y no agrega jugadores al torneo.</p>
        {managerRosterPlayers.filter((player) => !managerLineupEntries.some((entry) => entry.identificationNumber === player.identificationNumber)).map((player) => (
          <label className="privateCheck" key={player.identificationNumber}>
            <input type="checkbox" checked={presentSubstitutes.includes(player.identificationNumber)} disabled={managerSubmitting} onChange={(event) => {
              setPresentSubstitutes((current) => event.target.checked ? [...current, player.identificationNumber] : current.filter((id) => id !== player.identificationNumber));
            }} />
            {player.displayName} · {player.identificationNumber}{getDemoJerseyNumber(player.identificationNumber) ? ` · Camiseta ${getDemoJerseyNumber(player.identificationNumber)}` : ''}
          </label>
        ))}
        <OfficialEntryForm disabled={managerSubmitting} onAdd={(official) => {
          if (presentOfficials.some((entry) => entry.role === official.role && entry.identificationNumber === official.identificationNumber)) {
            throw new Error('Ese directivo ya está incluido en ese cargo.');
          }
          setPresentOfficials((current) => [...current, official]);
        }} />
        <ul>{presentOfficials.map((official) => <li key={`${official.role}:${official.identificationNumber}`}>
          {officialRoleLabels[official.role]} · {official.displayName} · {official.identificationNumber}
          <button type="button" className="chipSubtle" disabled={managerSubmitting} onClick={() => setPresentOfficials((current) => current.filter((entry) => entry !== official))}>Quitar de los presentes</button>
        </li>)}</ul>
        <p>El envío comparte la alineación y el personal presente. Después de entregada, el anotador u organizador registra las sustituciones y nuevas llegadas que le comuniques en el campo. Aquí consultarás el partido oficial en vivo.</p>
        <button
          type="button"
          className="managerButtonOutline"
          disabled={managerSubmitting || !managerContextReady}
          aria-busy={managerSubmitting}
          onClick={submitLineupToGame}
        >
          {managerSubmitting ? 'Enviando alineación…' : 'Enviar alineación con posiciones'}
        </button>
        {statusNotice}
      </article>
      )}

      </>
      ) : null}
    </section>
    </>
  );
}
