import type { TournamentPhase } from '@playsport/shared';

export function resizeTournamentGroups(
  phase: TournamentPhase,
  count: number,
  nextId: () => string,
): TournamentPhase['groups'] {
  if (!Number.isInteger(count) || count < 1 || count > 8)
    throw new Error('Selecciona una cantidad de grupos entre 1 y 8.');
  if (count === 1) return [];
  const current = phase.groups.length
    ? phase.groups
    : [
        {
          id: nextId(),
          name: 'Grupo 1',
          teamIds: [...phase.teamIds],
          ...(phase.teamLimit !== undefined
            ? { teamLimit: phase.teamLimit, qualifiers: phase.qualifiers }
            : {}),
        },
      ];
  return Array.from({ length: count }, (_, index) => {
    const group = current[index];
    return group
      ? { ...group, teamIds: [...group.teamIds] }
      : {
          id: nextId(),
          name: `Grupo ${index + 1}`,
          teamIds: [],
          teamLimit: null,
          qualifiers: null,
        };
  });
}
