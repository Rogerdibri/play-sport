const base = 'http://localhost:4000/api/official-scoring';
const tournamentId = 'tour-global-1';
const organizerId = 'org-demo';

async function request(path, body) {
  const response = await fetch(`${base}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
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
      playerIdentificationNumbers: players.map((index) => index > 18 ? `PRUEBA${index}` : `PRUEBA${String(index).padStart(3, '0')}`)
    });
  }
}
await request('games/game-global-1/teams', {
  tournamentId, organizerId, homeTeamId: 'team-A', awayTeamId: 'team-B'
});
console.log('Demo preparada. En una plantilla nueva: PRUEBA001–009 para titulares y PRUEBA19–21 para probar suplentes y llegadas tardías. Las plantillas existentes no se modificaron.');
