import type { PrivatePlayer, PrivateSeed } from './private-scorecard';

export const demoPlayers = Array.from({ length: 23 }, (_, index) => {
  const number = index + 1;
  const identificationNumber = number <= 18
    ? `PRUEBA${String(number).padStart(3, '0')}`
    : `PRUEBA${number}`;
  return {
    identificationNumber,
    displayName: `${number <= 18 ? 'Jugador' : 'Suplente'} ficticio ${number}`,
    jerseyNumber: String(number)
  };
});

const demoJerseyNumbers = new Map(demoPlayers.map((player) => [player.identificationNumber, player.jerseyNumber]));

export function getDemoJerseyAssignments(assignedPlayers: ReadonlyArray<{ id: string; jersey: string }> = []) {
  const assigned = new Map(assignedPlayers.filter((player) => player.jersey.trim()).map((player) => [player.id, player.jersey]));
  return demoPlayers.map((player) => ({
    ...player, jerseyNumber: assigned.get(player.identificationNumber) ?? player.jerseyNumber
  }));
}

export function getDemoJerseyNumber(identificationNumber: string): string {
  return demoJerseyNumbers.get(identificationNumber.trim().toUpperCase()) ?? '';
}

export function fillMissingDemoJerseys<T extends { identificationNumber: string; jerseyNumber: string }>(
  entries: T[]
): T[] {
  let changed = false;
  const filled = entries.map((entry) => {
    const jerseyNumber = getDemoJerseyNumber(entry.identificationNumber);
    if (entry.jerseyNumber.trim() || !jerseyNumber) return entry;
    changed = true;
    return { ...entry, jerseyNumber };
  });
  return changed ? filled : entries;
}

export function fillDemoScorecardJerseys(seed: PrivateSeed): PrivateSeed {
  const fill = (players: PrivatePlayer[], assigned: PrivatePlayer[] = []) => players.map((player) => {
    const demoNumber = getDemoJerseyNumber(player.id);
    if (player.jersey.trim() || !demoNumber) return player;
    return {
      ...player,
      jersey: assigned.find((entry) => entry.id === player.id && entry.jersey.trim())?.jersey || demoNumber
    };
  });
  const lineups = { home: fill(seed.lineups.home), away: fill(seed.lineups.away) };
  return {
    ...seed,
    lineups,
    rosters: {
      home: fill(seed.rosters.home, lineups.home),
      away: fill(seed.rosters.away, lineups.away)
    }
  };
}
