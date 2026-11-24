const base = 'http://localhost:4000/api/official-scoring';
const tournamentId = 'tour-global-1';
const organizerId = 'org-demo';
const cookie = process.env.PLAYSPORT_DEMO_ACCOUNT_COOKIE;
if (process.env.NODE_ENV === 'production' || !cookie)
  throw new Error('La siembra es solo local y requiere PLAYSPORT_DEMO_ACCOUNT_COOKIE de la cuenta de pruebas autorizada.');

async function request(path, body) {
  const response = await fetch(`${base}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Cookie: cookie,
      Origin: new URL(process.env.PLAYSPORT_WEB_ORIGIN ?? 'http://localhost:3000').origin },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${path}: ${data.message ?? response.status}`);
  }
  return data;
}

const authorizationResponse = await fetch(`${base}/tournaments/${tournamentId}/authorization`);
if (!authorizationResponse.ok && authorizationResponse.status !== 404) {
  throw new Error(`No se pudo consultar la autorización del torneo (${authorizationResponse.status}).`);
}
const existingAuthorization = authorizationResponse.ok ? await authorizationResponse.json() : null;
if (existingAuthorization && existingAuthorization.organizerId !== organizerId) {
  throw new Error('El torneo tiene otro organizador. No se modificaron sus autorizaciones.');
}
await request(`tournaments/${tournamentId}/authorization`, {
  organizerId,
  organizerIdentificationNumber: existingAuthorization ? undefined : 'ORGDEMO1',
  scorekeeperIdentities: existingAuthorization?.authorizedScorekeeperIds.includes('scorer-demo') ? undefined :
    [{ actorId: 'scorer-demo', identificationNumber: 'ANOTADORDEMO1' }],
  scorekeeperIds: Array.from(new Set([...(existingAuthorization?.authorizedScorekeeperIds ?? []), 'scorer-demo']))
});
const registry = await request('players?visibility=free');
const registered = new Set(registry.players.map((player) => player.identificationNumber));
for (let index = 1; index <= 18; index += 1) {
  const identificationNumber = `PRUEBA${String(index).padStart(3, '0')}`;
  if (!registered.has(identificationNumber)) {
    await request('players', {
      actorId: organizerId,
      displayName: `Jugador ficticio ${index}`,
      identificationNumber
    });
  }
}

for (let index = 19; index <= 23; index += 1) {
  const identificationNumber = `PRUEBA${index}`;
  if (!registered.has(identificationNumber)) {
    await request('players', {
      actorId: organizerId,
      displayName: `Suplente ficticio ${index}`,
      identificationNumber
    });
  }
}
const rosters = await request(`tournaments/${tournamentId}/teams/rosters`);
for (const [teamId, managerId, players] of [
  ['team-A', 'mgr-A', [1, 2, 3, 4, 5, 6, 7, 8, 9, 19, 20, 21]],
  ['team-B', 'mgr-B', [10, 11, 12, 13, 14, 15, 16, 17, 18]]
]) {
  if (!rosters.rosters.some((roster) => roster.teamId === teamId)) {
    await request(`tournaments/${tournamentId}/teams/${teamId}/roster`, {
      managerId, organizerId,
      managerIdentificationNumber: teamId === 'team-A' ? 'MANAGERDEMOA' : 'MANAGERDEMOB',
      playerIdentificationNumbers: players.map((index) => index > 18 ? `PRUEBA${index}` : `PRUEBA${String(index).padStart(3, '0')}`)
    });
  }
}
await request('games/game-global-1/teams', {
  tournamentId, organizerId, homeTeamId: 'team-A', awayTeamId: 'team-B'
});
const gameAuthorization = await request(`games/game-global-1/authorization?tournamentId=${tournamentId}`);
if (!gameAuthorization.hasGameScopedAuthorization) {
  await request('games/game-global-1/authorization', { tournamentId, organizerId, scorekeeperIds: ['scorer-demo'] });
}
const catalog = await request(`games?userId=${organizerId}&role=organizer`);
if (!catalog.games.find(game => game.gameId === 'game-global-1')?.details) {
  await request('games/game-global-1/details', { tournamentId, organizerId, details: {
    tournamentName: 'Torneo de demostración 2026', homeTeamName: 'Tigres del Valle', awayTeamName: 'Leones del Norte',
    date: '2026-11-05', time: '18:00', venue: 'Estadio de demostración'
  } });
}
if (process.argv.includes('--lineups')) {
  const state = await request(`games/game-global-1/state?tournamentId=${tournamentId}`);
  if (state.state.status !== 'scheduled' || state.playByPlay.totalEvents !== 0) {
    throw new Error('Las alineaciones de prueba solo se entregan en la demo programada y sin jugadas. No se modificó ningún lineup.');
  }
  const sheets = await request(`games/game-global-1/team-sheets?${new URLSearchParams({ tournamentId, userId: organizerId, role: 'organizer' })}`);
  for (const [teamId, managerId, first] of [['team-A', 'mgr-A', 1], ['team-B', 'mgr-B', 10]]) {
    if (sheets.sheets.some(sheet => sheet.teamId === teamId)) continue;
    const roster = rosters.rosters.find(entry => entry.teamId === teamId) ??
      (await request(`tournaments/${tournamentId}/teams/rosters`)).rosters.find(entry => entry.teamId === teamId);
    const lineupEntries = Array.from({ length: 9 }, (_, index) => ({
      identificationNumber: `PRUEBA${String(first + index).padStart(3, '0')}`,
      battingOrder: index + 1, fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][index],
      jerseyNumber: String(index + 1)
    }));
    if (!roster || roster.managerId !== managerId ||
        lineupEntries.some(player => !roster.rosterPlayerIdentificationNumbers.includes(player.identificationNumber))) {
      throw new Error(`El roster de ${teamId} no corresponde a los nueve jugadores ficticios esperados. No se inventaron jugadores ni se sustituyó una entrega.`);
    }
    await request('games/game-global-1/lineups', { tournamentId, teamId, managerId, lineupEntries });
  }
  console.log('Lineups ficticios recibidos para ambos equipos; las entregas existentes se conservaron. No se anotaron jugadas.');
}
console.log('Demo preparada. En una plantilla nueva: PRUEBA001–009 para titulares y PRUEBA19–21 para probar suplentes y llegadas tardías. Las plantillas existentes no se modificaron.');
