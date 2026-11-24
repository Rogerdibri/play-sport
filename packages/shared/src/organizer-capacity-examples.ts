import { newTournament, newTournamentFixture, type TournamentDocument, type TournamentPhase } from './tournaments.js';

function phase(id: string, name: string, kind: TournamentPhase['kind'], teamIds: string[], extra: Partial<TournamentPhase> = {}): TournamentPhase {
  return { id, name, kind, teamIds, teamLimit: teamIds.length, status: 'draft', sourcePhaseId: '', groups: [],
    turns: 1, bestOf: 1, qualifiers: null, pairing: 'seeded', rules: '', ...extra };
}
function tournament(id: string, name: string, count: number): TournamentDocument {
  const doc = { ...newTournament(id), name, teamLimit: count };
  doc.teams = Array.from({ length: count }, (_, index) => ({
    id: `${id}:team-${index + 1}`, name: `Equipo ${index + 1}`, managerId: '', managerIdentification: '',
    status: 'accepted', rosterStatus: 'approved', rosterSignature: '', blocked: false, blockReason: '',
    blockScopes: [], withdrawalReason: '',
  }));
  return doc;
}
const five = tournament('organizer-example-five', 'Cinco equipos · Una vuelta y cierre', 5);
const ids = five.teams.map(team => team.id);
five.phases = [phase('initial', 'Ronda inicial', 'round-robin', ids, { qualifiers: 4 }),
  phase('semi', 'Semifinales', 'knockout', ids.slice(0, 4), { sourcePhaseId: 'initial', qualifiers: 2 }),
  phase('final', 'Final', 'knockout', ids.slice(0, 2), { sourcePhaseId: 'semi' })];
five.fixtures = [{ ...newTournamentFixture('initial-first', 'initial'), homeTeamId: ids[0], awayTeamId: ids[1] }];
const eight = tournament('organizer-example-eight', 'Ocho equipos · Dos grupos y dos vueltas', 8);
const eightIds = eight.teams.map(team => team.id);
eight.phases = [phase('initial', 'Grupos · Dos vueltas', 'round-robin', eightIds, { turns: 2, groups: [
  { id: 'first', name: 'Grupo A', teamIds: eightIds.slice(0, 4), teamLimit: 4, qualifiers: 2 },
  { id: 'second', name: 'Grupo B', teamIds: eightIds.slice(4), teamLimit: 4, qualifiers: 2 },
] }), phase('semi', 'Semifinales', 'knockout', eightIds.slice(0, 4), { sourcePhaseId: 'initial', qualifiers: 2 }),
phase('final', 'Final', 'knockout', eightIds.slice(0, 2), { sourcePhaseId: 'semi' })];
const two = tournament('organizer-example-two', 'Dos equipos · Formato personalizado', 2);
two.phases = [phase('manual', 'Partidos personalizados', 'custom', two.teams.map(team => team.id), { maxGames: 13, pairing: 'manual' })];
two.fixtures = [{ ...newTournamentFixture('manual-first', 'manual'), homeTeamId: two.teams[0].id, awayTeamId: two.teams[1].id }];
const ties: TournamentDocument = {
  ...five, id: 'organizer-example-ties', name: 'Cinco equipos · 13 ordinarios y 3 desempates',
  phases: [...five.phases, phase('ties', 'Desempates de clasificación', 'custom', ids.slice(0, 2),
    { purpose: 'tie-breaker', tieBreakReason: 'Igualdad por los cupos de semifinales', sourcePhaseId: 'initial', maxGames: 3 })],
};
export const organizerCapacityExamples = [five, eight, two, ties] as const;
