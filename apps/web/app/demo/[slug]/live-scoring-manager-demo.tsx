'use client';

import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { InstitutionName } from '../../institutional-logos';
import { officialGameNames, RosterClient, rosterRoleLabels, isPresentOfficialRole } from '@playsport/shared';
import type { OfficialGameSummary, PresentOfficial, TeamSheet, ManagerRoster } from '@playsport/shared';
import { demoCalendar, formatGameName, resolveParticipant } from './demo-calendar';
import ManagerLineupTable, { lineupRoleOptions, lineupTableError, resetLineupRows, type LineupEntryDraft } from './manager-lineup-table';
import OfficialRunScoring from './official-run-scoring';
import LiveScoringHeader from './live-scoring-header';
import { DemoRecipientNotice, officialRoleLabels, readTeamSheets } from './team-sheets';
import { fieldPositionLabels } from './private-scorecard';
import { useNavigationBusy, useNavigationDraft, useScreenBack } from '../../navigation-hooks';
import { isStringListDraft, isTextDraft } from '../../navigation-drafts';
import usePublicOfficialGames from './use-public-official-games';
import OfficialResult from './official-result';

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

const isLineupDraft = (value: unknown): value is LineupEntryDraft[] => Array.isArray(value) && value.every((entry) =>
  entry && typeof entry === 'object' && typeof entry.identificationNumber === 'string' &&
  (entry.battingOrder === null || Number.isInteger(entry.battingOrder)) && typeof entry.fieldPosition === 'string' &&
  ['PLAYER', 'DP', 'FLEX', 'EH'].includes(entry.lineupRole) && typeof entry.jerseyNumber === 'string');
const isOfficialsDraft = (value: unknown): value is PresentOfficial[] => Array.isArray(value) && value.every((entry) =>
  entry && typeof entry === 'object' && isPresentOfficialRole(entry.role) &&
  typeof entry.identificationNumber === 'string' && typeof entry.displayName === 'string');

const officialScoringApiBase =
  process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? '/api/official-scoring';

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

export default function LiveScoringManagerDemo({ rival = false, assignment, managerId }: {
  rival?: boolean; assignment?: OfficialGameSummary; managerId?: string;
}) {
  const managerTournamentId = assignment?.tournamentId ?? 'tour-global-1';
  const managerTeamId = assignment ? assignment.managerTeamId ?? '' : rival ? 'team-B' : 'team-A';
  const managerGameId = assignment?.gameId ?? 'game-global-1';
  const managerProfileId = assignment ? managerId ?? '' : rival ? 'mgr-B' : 'mgr-A';
  const officialCatalog = usePublicOfficialGames();
  const officialGame = officialCatalog.games?.find(game => game.gameId === managerGameId && game.tournamentId === managerTournamentId) ?? assignment;
  const managerTeamName = officialGame ? officialGameNames(officialGame)[managerTeamId] : rival ? 'Leones del Norte' : 'Tigres del Valle';
  const protestLocked = Boolean(officialGame?.protest) || Boolean(officialGame && ['final', 'protested', 'suspended'].includes(officialGame.status));
  const [managerContextReady, setManagerContextReady] = useState(false);

  const [managerRosterCedulas, setManagerRosterCedulas] = useState<string[]>([]);
  const [managerRosterPlayers, setManagerRosterPlayers] = useState<RosterPlayerView[]>([]);
  const [matchRoster, setMatchRoster] = useState<ManagerRoster | null>(null);
  const rosterClient = useMemo(() => new RosterClient(managerProfileId.startsWith('person:') ? '/api/sporting' :
    officialScoringApiBase.replace(/\/official-scoring\/?$/, ''), managerProfileId), [managerProfileId]);

  const draftScope = `${managerTournamentId}:${managerGameId}:${managerTeamId}:lineup`;
  const [managerLineupEntries, setManagerLineupEntries] = useNavigationDraft<LineupEntryDraft[]>(`${draftScope}:entries`, [], isLineupDraft);
  const [presentSubstitutes, setPresentSubstitutes] = useNavigationDraft<string[]>(`${draftScope}:substitutes`, [], isStringListDraft);
  const [presentOfficials, setPresentOfficials] = useNavigationDraft<PresentOfficial[]>(`${draftScope}:staff`, [], isOfficialsDraft);
  const [submittedTeamSheet, setSubmittedTeamSheet] = useState<TeamSheet | null>(null);
  const [teamSheetsVersion, setTeamSheetsVersion] = useState<number | null>(null);
  const [withdrawalRequested, setWithdrawalRequested] = useState(false);
  const [managerUiStatus, setManagerUiStatus] = useState<UiStatus>({ kind: 'idle', message: '' });
  const [managerSubmitting, setManagerSubmitting] = useState(false);
  useNavigationBusy(managerSubmitting);
  const [managerInitializationRequested, setManagerInitializationRequested] = useState(true);
  const [step, setStep] = useState<'game' | 'scorecard'>('game');
  const [representativeCedula, setRepresentativeCedula] = useNavigationDraft(`${draftScope}:representative`, '', isTextDraft);
  useScreenBack(() => setStep('game'), step === 'scorecard');
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
  const selectedHome = assignment ? { teamId: assignment.homeTeamId, name: assignment.details?.homeTeamName ?? assignment.homeTeamId } :
    selectedGame ? resolveParticipant(selectedGame.home, demoCalendar) : null;
  const selectedAway = assignment ? { teamId: assignment.awayTeamId, name: assignment.details?.awayTeamName ?? assignment.awayTeamId } :
    selectedGame ? resolveParticipant(selectedGame.away, demoCalendar) : null;
  const gameLabel = assignment ? `${selectedAway?.name} vs. ${selectedHome?.name}` : selectedGame ? formatGameName(selectedGame) : 'Sin partido asignado';
  const hasValidAssignment = assignment ? Boolean(managerProfileId && managerTeamId &&
    [assignment.homeTeamId, assignment.awayTeamId].includes(managerTeamId)) : Boolean(
    selectedGame && !selectedGame.result && selectedHome && selectedAway &&
    [selectedHome.teamId, selectedAway.teamId].includes(managerTeamId.trim())
  );

  const representativeMember = matchRoster?.members.find(row =>
    normalizeCedula(row.person.id) === normalizeCedula(representativeCedula) ||
    row.person.identification && normalizeCedula(row.person.identification) === normalizeCedula(representativeCedula));
  const representativeCandidate = representativeMember ? {
    identificationNumber: representativeMember.person.id, displayName: representativeMember.person.fullName
  } : null;
  const representativeConfirmed = Boolean(authorizedRepresentative && representativeMember &&
    [representativeMember.person.id, representativeMember.person.identification].some(id => id && normalizeCedula(id) === normalizeCedula(authorizedRepresentative.identificationNumber)));

  const buildManagerContext = (): ManagerContext => ({
    tournamentId: managerTournamentId.trim(),
    teamId: managerTeamId.trim(),
    gameId: managerGameId.trim(),
    managerId: managerProfileId.trim()
  });

  const postOfficialScoring = async (path: string, payload: unknown) => {
    const response = await fetch(`${officialScoringApiBase}/${path}`, {
      credentials: 'include',
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
      const response = await fetch(`${officialScoringApiBase}/${path}`, { credentials: 'include', signal: AbortSignal.timeout(10000) });
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
    setTeamSheetsVersion(snapshot.version);
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
      const [roster, representativePayload, submittedSheet, personnel] = await Promise.all([
        getOfficialScoring(`tournaments/${context.tournamentId}/teams/${context.teamId}/roster?visibility=free`),
        getOfficialScoring(`games/${context.gameId}/teams/${context.teamId}/representative?tournamentId=${context.tournamentId}`),
        loadSubmittedTeamSheet(context),
        rosterClient.load({ ...context, teamName: managerTeamName, tournamentName: managerTournamentId })
      ]);
      setMatchRoster(personnel);
      const representative = readRepresentative(representativePayload);
      setAuthorizedRepresentative(representative);
      setRepresentativeCedula((current) => current || representative?.identificationNumber || '');

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
      setManagerLineupEntries(current => current.map(entry =>
        entry.identificationNumber && !rosterIds.includes(entry.identificationNumber) ?
          { ...entry, identificationNumber: '', jerseyNumber: '', fieldPosition: '' } : entry));
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
        message: 'Completa los identificadores del torneo, equipo, juego y dirigente para activar el contexto del manager.'
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

  const submitLineupToGame = async () => {
    if (!representativeConfirmed) {
      setManagerUiStatus({ kind: 'error', message: 'Selecciona y guarda al dirigente de este partido desde el roster antes de enviar la alineación.' });
      return;
    }
    if (!hasValidAssignment) {
      setManagerUiStatus({ kind: 'error', message: 'No hay un partido asignado disponible para tu equipo. Contacta al organizador o anotador.' });
      return;
    }
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Activa primero el contexto en el panel del manager antes de enviar la alineación.'
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

      const error = lineupTableError(managerLineupEntries, managerRosterCedulas);
      if (error) {
        setManagerUiStatus({ kind: 'error', message: error });
        return;
      }
      const sortedEntries = managerLineupEntries
        .filter(entry => entry.identificationNumber)
        .map(entry => ({ ...entry, jerseyNumber: entry.jerseyNumber.padStart(2, '0') })).sort(
        (a, b) => (a.battingOrder ?? Number.MAX_SAFE_INTEGER) - (b.battingOrder ?? Number.MAX_SAFE_INTEGER)
      );

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
        message: 'Alineación, suplentes y personal presente entregados en las bandejas del organizador, los anotadores autorizados y el dirigente rival.'
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

  const canWithdraw = Boolean(submittedTeamSheet?.canWithdraw && officialGame?.status === 'scheduled' && !protestLocked);
  const withdrawLineup = async () => {
    if (!submittedTeamSheet || !canWithdraw || teamSheetsVersion === null) {
      setManagerUiStatus({ kind: 'error', message: 'Actualiza los datos: solo puedes cancelar tu alineación enviada antes de iniciar el partido.' });
      return;
    }
    setManagerSubmitting(true);
    setManagerUiStatus({ kind: 'idle', message: '' });
    try {
      const snapshot = readTeamSheets(await postOfficialScoring(
        `games/${managerGameId}/team-sheets/${managerTeamId}/withdraw`, {
          tournamentId: managerTournamentId, managerId: managerProfileId,
          expectedRevision: submittedTeamSheet.revision, expectedVersion: teamSheetsVersion
        }));
      if (snapshot.gameId !== managerGameId || snapshot.tournamentId !== managerTournamentId ||
          snapshot.ownTeamId !== managerTeamId || snapshot.sheets.some(sheet => sheet.teamId === managerTeamId)) {
        throw new Error('No se pudo confirmar la cancelación de tu alineación. Actualiza los datos del partido.');
      }
      setTeamSheetsVersion(snapshot.version);
      setSubmittedTeamSheet(null);
      setManagerLineupEntries(resetLineupRows());
      setWithdrawalRequested(false);
      setStep('game');
      setManagerUiStatus({ kind: 'success', message: 'Lineup enviado cancelado. El cuadro está vacío y listo para rehacerlo; debes volver a enviarlo. Se conservaron el dirigente, el roster y el equipo rival.' });
      officialCatalog.refresh();
    } catch (error) {
      setManagerUiStatus({ kind: 'error', message: adaptManagerError(error instanceof Error ? error.message : 'No se pudo cancelar la alineación enviada.') });
    } finally {
      setManagerSubmitting(false);
    }
  };
  const withdrawalControls = canWithdraw ? <section className="baseballWithdrawal" aria-label="Cancelar alineación antes del inicio">
    <div><strong>¿Necesitas cambiar tu alineación?</strong>
      <p>Antes del primer lanzamiento puedes retirar tu entrega y preparar un lineup nuevo.</p></div>
    {!withdrawalRequested ? <button type="button" className="managerButtonOutline baseballDangerButton"
      disabled={managerSubmitting || teamSheetsVersion === null} onClick={() => setWithdrawalRequested(true)}>Cancelar lineup enviado</button> :
      <div role="group" aria-label="Confirmar cancelación del lineup enviado">
        <p>Se retirará tu alineación de las bandejas del rival y los oficiales. Tu cuadro volverá a las 13 filas vacías para rehacerlo y enviarlo otra vez con un mínimo de 9 titulares. No se toca el roster ni el lineup rival.</p>
        <div className="managerButtonRow">
          <button type="button" className="managerButtonOutline baseballDangerButton" disabled={managerSubmitting}
            onClick={withdrawLineup}>{managerSubmitting ? 'Cancelando entrega…' : 'Sí, cancelar y rehacer'}</button>
          <button type="button" className="managerButtonOutline" disabled={managerSubmitting}
            onClick={() => setWithdrawalRequested(false)}>Conservar lineup enviado</button>
        </div>
      </div>}
  </section> : null;

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
  const availableSubstitutes = managerRosterPlayers.filter(player =>
    !managerLineupEntries.some(entry => entry.identificationNumber === player.identificationNumber));
  const selectedSubstituteCount = availableSubstitutes.filter(player => presentSubstitutes.includes(player.identificationNumber)).length;
  return (
    <div className="baseballManager">
    {!scorecardOpen ? <LiveScoringHeader /> : null}
    <section className="managerWorkspace" aria-label="Gestión del dirigente en vivo">
      {!scorecardOpen ? <>
      {officialCatalog.error ? <p role="alert">{officialCatalog.error}</p> : null}
      {officialGame && ['protested', 'final', 'suspended'].includes(officialGame.status) ? <article className="managerCard">
        <h2>Resultado del partido oficial</h2>
        <OfficialResult game={officialGame} />
        {officialGame.protest?.resolution ? <p>Fundamento: {officialGame.protest.resolution.reason} · Acta: {officialGame.protest.resolution.recordReference}</p> : null}
        <Link className="managerButtonOutline" href={`/demo/events-map?official=${encodeURIComponent(officialGame.gameId)}`}>Ver partido y acta · Solo lectura</Link>
      </article> : null}
      <nav className="managerSteps" aria-label="Pasos para preparar el partido">
        <ol>
          <li aria-current={step !== 'scorecard' ? 'step' : undefined}>1. Preparar partido: roster, dirigente y lineup</li>
          <li aria-current={step === 'scorecard' ? 'step' : undefined}>2. Partido oficial en vivo</li>
        </ol>
      </nav>
      </> : null}
      {statusNotice}
      {step !== 'scorecard' ? (
      <article className="managerCard managerStepCard baseballGameCard">
        <header className="baseballGameMasthead">
          <div><span className="baseballEyebrow">PlaySport · Clubhouse</span>
            <h2 ref={stepHeading} tabIndex={-1}>Preparar el partido asignado</h2></div>
          <span className="baseballGameStatus">{officialGame?.status === 'scheduled' ? 'Antes del primer lanzamiento' : 'Partido oficial'}</span>
        </header>
        <div className="baseballMatchup" aria-label={gameLabel}>
          <div><span>Visitante{managerTeamId === officialGame?.awayTeamId ? ' · Tu equipo' : ''}</span>
            <strong><InstitutionName id={officialGame?.awayTeamId ?? selectedAway?.teamId}>{officialGame?.details?.awayTeamName ?? selectedAway?.name ?? 'Rival por definir'}</InstitutionName></strong></div>
          <span className="baseballVersus" aria-hidden="true">VS</span>
          <div><span>Local{managerTeamId === officialGame?.homeTeamId ? ' · Tu equipo' : ''}</span>
            <strong><InstitutionName id={officialGame?.homeTeamId ?? selectedHome?.teamId}>{officialGame?.details?.homeTeamName ?? selectedHome?.name ?? 'Rival por definir'}</InstitutionName></strong></div>
        </div>
        <dl className="baseballGameFacts" aria-label="Datos fijos del partido asignado">
          <dt>Torneo asignado</dt><dd><InstitutionName kind="tournament" id={managerTournamentId}>{officialGame?.details?.tournamentName ?? managerTournamentId}</InstitutionName></dd>
          <dt>Equipo que diriges</dt><dd><InstitutionName id={managerTeamId}>{managerTeamName}</InstitutionName></dd>
          <dt>Fecha y hora</dt><dd>{officialGame?.details ? `${officialGame.details.date} · ${officialGame.details.time}` : 'Por confirmar'}</dd>
          <dt>Estadio</dt><dd>{officialGame?.details?.venue ?? 'Por confirmar'}</dd>
        </dl>
        <details className="baseballHelp"><summary>Información de la asignación</summary><p id="calendar-description">
          {assignment ? 'Partido de tu equipo configurado por el organizador. El lineup y los movimientos corresponden únicamente a este encuentro.' :
            'La fase y el número de juego provienen del calendario; el dirigente no puede cambiarlos. Los cruces avanzan con resultados oficiales confirmados.'}
        </p>
        {!assignment && calendarGames.length === 0 ? (
          <p className="managerWarning">No hay calendario disponible para este torneo.</p>
        ) : null}
        {!assignment ? <details>
          <summary>Resultados confirmados del calendario</summary>
          <ul>
            {calendarGames.filter((game) => game.result?.official).map((game) => (
              <li key={game.id}>
                {formatGameName(game)}: <InstitutionName example>{resolveParticipant(game.home, demoCalendar)?.name}</InstitutionName> {game.result?.home}
                {' – '}{game.result?.away} <InstitutionName example>{resolveParticipant(game.away, demoCalendar)?.name}</InstitutionName>
              </li>
            ))}
          </ul>
        </details> : null}

        <DemoRecipientNotice />
        </details>
        <section className="baseballDugout" aria-label="Dirigente del partido">
        <h3>Al mando del dugout</h3>
        <div className="baseballDugoutControls">
        <label className="managerField"><span>Seleccionar dirigente desde el roster</span>
          <select value={representativeCandidate?.identificationNumber ?? ''} disabled={managerSubmitting || !managerContextReady || protestLocked}
            onChange={event => { setRepresentativeCedula(event.target.value); setManagerUiStatus({ kind: 'idle', message: '' }); }}>
            <option value="">Elige al dirigente de este partido</option>
            {matchRoster?.members.map(row => <option key={row.person.id} value={row.person.id}>{row.person.fullName} · {rosterRoleLabels[row.role]}</option>)}
          </select>
        </label>
        <button type="button" className="managerButtonSolid" disabled={managerSubmitting || !managerContextReady || !representativeCandidate || protestLocked}
          onClick={authorizeRepresentative}>Guardar dirigente del partido</button>
        </div>
        {authorizedRepresentative ? <p className="baseballHint">Dirigente confirmado: <strong>{authorizedRepresentative.displayName}</strong>.</p> : <p className="baseballHint">Selecciona a un integrante del roster. Dirige solo este partido; no cambia al manager permanente ni sus permisos.</p>}
        {representativeCandidate && !representativeConfirmed ? <p role="status">La selección aún no está guardada para este partido.</p> : null}
        </section>
        <div className="baseballGameActions">
        <button
          type="button"
          className="managerButtonOutline"
          disabled={managerSubmitting || !hasValidAssignment}
          aria-busy={managerSubmitting}
          onClick={activateManagerContext}
        >
          {managerSubmitting ? 'Cargando datos del partido…' : managerContextReady ? 'Actualizar datos del partido asignado' : 'Cargar datos del partido asignado'}
        </button>

        <span className="baseballContextState" role="status">{managerSubmitting ? 'Cargando partido…' : managerContextReady ? 'Datos del partido listos' : 'Datos pendientes de cargar'}</span>
        <button type="button" className="managerButtonOutline" disabled={!managerContextReady || managerSubmitting} onClick={() => {
          setManagerUiStatus({ kind: 'idle', message: '' });
          setStep('scorecard');
        }}>Ver partido oficial en vivo</button>
        </div>
      </article>
      ) : null}
      {step !== 'scorecard' && managerContextReady && !submittedTeamSheet ? <article className="managerCard managerStepCard managerLineupPreparation">
        <header className="baseballSectionHeading"><div><span className="baseballEyebrow">Tarjeta de alineación · <InstitutionName id={managerTeamId}>{managerTeamName}</InstitutionName></span><h2>Cuadro de lineup</h2></div><span className="baseballDraftStamp">Borrador</span></header>
        <ManagerLineupTable entries={managerLineupEntries} players={managerRosterPlayers}
          disabled={managerSubmitting || protestLocked} onChange={setManagerLineupEntries} />
        <p className="baseballHint">Toca una fila para editarla. Esta tarjeta es del partido; tu roster permanente no cambia.</p>
      </article> : null}
      {step === 'scorecard' && selectedHome && selectedAway ? (
        <>
        {withdrawalControls ? <article className="managerCard managerStepCard">{withdrawalControls}</article> : null}
        <OfficialRunScoring
          apiBase={officialScoringApiBase}
          tournamentId={managerTournamentId}
          gameId={managerGameId}
          actorId={managerProfileId}
          actorRole="manager"
          allowManagerRequests={Boolean(assignment)}
          ownTeamId={managerTeamId}
          teamNames={officialGame ? officialGameNames(officialGame) : undefined}
          onBack={() => {
            setManagerUiStatus({ kind: 'idle', message: '' });
            setStep('game');
          }}
        />
        </>
      ) : null}

      {step !== 'scorecard' && managerContextReady ? (
      <>
      {submittedTeamSheet ? (
      <article className="managerCard managerStepCard managerLineupPreparation">
        <header className="baseballSectionHeading"><div><span className="baseballEyebrow">Tarjeta de alineación · <InstitutionName id={managerTeamId}>{managerTeamName}</InstitutionName></span><h2>Alineación ya entregada</h2></div><span className="baseballDraftStamp baseballSentStamp">Enviada</span></header>
        <p>Se recuperó la entrega guardada del partido, versión {submittedTeamSheet.revision}. No necesitas armarla ni enviarla otra vez.</p>
        <p>Comunica los cambios en el campo al anotador u organizador. Ellos los registran y aquí se reflejan en vivo; no necesitas usar el teléfono para solicitarlos.</p>
        {withdrawalControls}
        <ol className="baseballDeliveredLineup" aria-label="Alineación entregada recuperada">
          {submittedTeamSheet.lineup.map((player) => <li key={player.identificationNumber}>
            <strong className="baseballOrder">{player.battingOrder === null ? 'FLEX' : String(player.battingOrder).padStart(2, '0')}</strong>
            <span><strong>{player.displayName}</strong><small title={lineupRoleOptions.find(option => option.value === player.lineupRole)?.label}><span className="baseballPlayerId">{player.identificationNumber} · </span>{player.lineupRole === 'PLAYER' ? 'Regular' : player.lineupRole}</small></span>
            <span className="baseballJersey" aria-label={`Camiseta ${player.jerseyNumber ?? 'sin asignar'}`}>{player.jerseyNumber ?? '—'}</span>
            <abbr title={fieldPositionLabels[player.fieldPosition]}>{player.fieldPosition}</abbr>
          </li>)}
        </ol>
        <section className="baseballBench" aria-label="Suplentes presentes confirmados">
        <header className="baseballSectionHeading"><h3>Suplentes presentes confirmados</h3><span className="baseballBenchCount">{submittedTeamSheet.presentSubstitutes.length} presentes</span></header>
        {submittedTeamSheet.presentSubstitutes.length ? (
          <ul className="baseballBenchGrid">{submittedTeamSheet.presentSubstitutes.map(player => <li className="baseballBenchPlayer is-present" key={player.identificationNumber}>
            <span className="baseballBenchBadge" aria-hidden="true">SUP</span>
            <span className="baseballBenchIdentity"><strong>{player.displayName}</strong><small>{player.identificationNumber}</small></span>
            <span className="baseballBenchPresence">Confirmado</span>
          </li>)}</ul>
        ) : <p className="baseballHint">No se declararon suplentes presentes.</p>}
        </section>
        <h3>Personal presente</h3>
        {submittedTeamSheet.presentOfficials.length ? (
          <ul>{submittedTeamSheet.presentOfficials.map((official) => <li key={`${official.role}:${official.identificationNumber}`}>
            {officialRoleLabels[official.role]} · {official.displayName} · {official.identificationNumber}
          </li>)}</ul>
        ) : <p>No se declaró personal presente.</p>}
        <button type="button" className="managerButtonSolid" disabled={managerSubmitting || !managerContextReady} aria-busy={managerSubmitting} onClick={submitLineupToGame}>
          {managerSubmitting ? 'Recuperando alineación…' : 'Continuar a la planilla de anotaciones'}
        </button>
      </article>
      ) : (
      <article className="managerCard managerStepCard managerLineupPreparation">
        <header className="baseballSectionHeading"><div><span className="baseballEyebrow">Banca del equipo</span><h2>Suplentes presentes y envío</h2></div>
          <span className="baseballBenchCount">{selectedSubstituteCount} presentes · {availableSubstitutes.length} disponibles</span></header>
        <p className="baseballHint">Marca a los suplentes que ya están en el campo. Los jugadores elegidos en el lineup no aparecen en la banca.</p>
        <div className="baseballBenchGrid" role="group" aria-label="Elegir suplentes presentes">
        {availableSubstitutes.map(player => {
          const present = presentSubstitutes.includes(player.identificationNumber);
          return <label className={`baseballBenchPlayer${present ? ' is-present' : ''}`} key={player.identificationNumber}>
            <input type="checkbox" aria-label={`Suplente presente: ${player.displayName}`} checked={present}
              disabled={managerSubmitting || protestLocked} onChange={event => {
                setPresentSubstitutes(current => event.target.checked ? [...current, player.identificationNumber] : current.filter(id => id !== player.identificationNumber));
              }} />
            <span className="baseballBenchBadge" aria-hidden="true">SUP</span>
            <span className="baseballBenchIdentity"><strong>{player.displayName}</strong><small>{player.identificationNumber}</small></span>
            <span className="baseballBenchPresence">{present ? 'Presente' : 'Marcar presente'}</span>
          </label>;
        })}
        </div>
        {!availableSubstitutes.length ? <p className="baseballHint">No hay jugadores fuera del lineup disponibles como suplentes.</p> : null}
        {matchRoster ? <details className="baseballStaffPresence"><summary>Personal técnico presente (opcional)</summary>
          <p className="baseballHint">Marca al personal que acompaña al equipo. Su cargo y su inscripción no cambian.</p>
          <div className="baseballBenchGrid">{matchRoster.members.map(row => {
            const staffRole = row.role;
            if (!isPresentOfficialRole(staffRole)) return null;
            const aliases = [normalizeCedula(row.person.id), normalizeCedula(row.person.identification)];
            const present = presentOfficials.some(item => item.role === staffRole && aliases.includes(normalizeCedula(item.identificationNumber)));
            return <label className={`baseballBenchPlayer${present ? ' is-present' : ''}`} key={row.person.id}>
              <input type="checkbox" checked={present} aria-label={`Presente en este partido: ${row.person.fullName}`}
                disabled={managerSubmitting || protestLocked} onChange={event => setPresentOfficials(current => event.target.checked ?
                  [...current, { role: staffRole, identificationNumber: row.person.id, displayName: row.person.fullName }] :
                  current.filter(item => !(item.role === staffRole && aliases.includes(normalizeCedula(item.identificationNumber)))))} />
              <span className="baseballBenchIdentity"><strong>{row.person.fullName}</strong><small>{rosterRoleLabels[staffRole]}</small></span>
              <span className="baseballBenchPresence">{present ? 'Presente' : 'Marcar presente'}</span>
            </label>;
          })}</div>
        </details> : null}
        <ul>{presentOfficials.map((official) => <li key={`${official.role}:${official.identificationNumber}`}>
          {officialRoleLabels[official.role]} · {official.displayName} · {official.identificationNumber}
          <button type="button" className="chipSubtle" disabled={managerSubmitting} onClick={() => setPresentOfficials((current) => current.filter((entry) => entry !== official))}>Quitar de los presentes</button>
        </li>)}</ul>
        <p>El envío comparte la alineación y el personal presente. Antes de iniciar el partido puedes cancelar la entrega y rehacerla; una vez iniciado, el anotador u organizador registra las sustituciones y nuevas llegadas que le comuniques en el campo.</p>
        <button
          type="button"
          className="managerButtonOutline"
          disabled={managerSubmitting || !managerContextReady || protestLocked}
          aria-busy={managerSubmitting}
          onClick={submitLineupToGame}
        >
          {managerSubmitting ? 'Enviando alineación…' : 'Enviar alineación con posiciones'}
        </button>
      </article>
      )}

      </>
      ) : null}
    </section>
    </div>
  );
}
