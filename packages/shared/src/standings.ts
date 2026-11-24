import type { CalendarGame } from './events-calendar.js';

export type StandingResult = {
  gameId: string; date: string; time: string; venueId: string; opponent: string;
  runsFor: number; runsAgainst: number; outcome: 'G' | 'P' | 'E';
  technicalDecision?: boolean;
};
export type StandingRow = {
  team: string; rank: number | null; played: number; wins: number; losses: number; ties: number;
  runsFor: number; runsAgainst: number; differential: number; percentage: number | null;
  streak: string; explanation: string; results: StandingResult[];
  direct: { opponent: string; wins: number; losses: number } | null;
};
export const standingsRule = 'Más juegos ganados y menos perdidos. Con el mismo récord, queda arriba quien ganó más juegos en el enfrentamiento directo entre ambos. Si la serie está igualada, no se han enfrentado o hay un empate múltiple sin regla definida, el desempate queda pendiente.';
export const standingsLegend = 'JJ: jugados · JG: ganados · JP: perdidos · PCT: JG / (JG + JP), sin contar empates · CF/CC: carreras a favor/en contra · DIF: CF − CC. Solo cuentan juegos finalizados de este torneo.';

export function calculateStandings(teams: readonly string[], games: readonly CalendarGame[]): StandingRow[] {
  if (teams.some(team => !team.trim()) || new Set(teams).size !== teams.length) throw new Error('La tabla contiene equipos vacíos o duplicados.');
  const rows = new Map<string, StandingRow>(teams.map(team => [team, {
    team, rank: null, played: 0, wins: 0, losses: 0, ties: 0, runsFor: 0, runsAgainst: 0,
    differential: 0, percentage: null, streak: '—', explanation: '', results: [], direct: null
  }]));
  const ids = new Set<string>();
  const ordered = [...games].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  for (const game of ordered) {
    if (ids.has(game.id)) throw new Error('Hay un juego duplicado en la clasificación.');
    ids.add(game.id);
    if (!rows.has(game.homeTeam) || !rows.has(game.awayTeam) || game.homeTeam === game.awayTeam) throw new Error('Un juego no pertenece a los equipos de este torneo.');
    if (game.status !== 'finished') continue;
    if (!game.score || ![game.score.home, game.score.away].every(score => Number.isSafeInteger(score) && score >= 0)) throw new Error('Un juego finalizado no tiene un resultado válido.');
    if (game.decidedWinner !== undefined && ![game.homeTeam, game.awayTeam].includes(game.decidedWinner)) throw new Error('El ganador de mesa técnica no pertenece al partido.');
    for (const side of ['home', 'away'] as const) {
      const row = rows.get(side === 'home' ? game.homeTeam : game.awayTeam)!;
      const runsFor = game.score[side];
      const runsAgainst = game.score[side === 'home' ? 'away' : 'home'];
      const outcome = game.decidedWinner !== undefined ? game.decidedWinner === row.team ? 'G' : 'P' :
        runsFor > runsAgainst ? 'G' : runsFor < runsAgainst ? 'P' : 'E';
      row.played++;
      if (outcome === 'G') row.wins++;
      else if (outcome === 'P') row.losses++;
      else row.ties++;
      row.runsFor += runsFor;
      row.runsAgainst += runsAgainst;
      row.results.push({ gameId: game.id, date: game.date, time: game.time, venueId: game.venueId,
        opponent: side === 'home' ? game.awayTeam : game.homeTeam, runsFor, runsAgainst, outcome,
        ...(game.decidedWinner !== undefined ? { technicalDecision: true } : {}) });
    }
  }
  const sorted = [...rows.values()].sort((a, b) => Number(b.played > 0) - Number(a.played > 0) || b.wins - a.wins || a.losses - b.losses || a.team.localeCompare(b.team));
  for (const row of sorted) {
    row.differential = row.runsFor - row.runsAgainst;
    row.percentage = row.wins + row.losses ? row.wins / (row.wins + row.losses) : null;
    const last = row.results.at(-1)?.outcome;
    if (last) {
      let length = 0;
      for (let index = row.results.length - 1; index >= 0 && row.results[index].outcome === last; index--) length++;
      row.streak = `${last}${length}`;
    }
    row.explanation = row.played ? `${row.wins} ganados y ${row.losses} perdidos.` : 'Sin juegos finalizados; todavía no tiene posición.';
  }
  for (let start = 0; start < sorted.length;) {
    const first = sorted[start];
    if (!first.played) break;
    let end = start + 1;
    while (end < sorted.length && sorted[end].played && sorted[end].wins === first.wins && sorted[end].losses === first.losses) end++;
    const group = sorted.slice(start, end);
    for (const row of group) row.rank = start + 1;
    if (group.length === 2) {
      const [a, b] = group;
      const direct = a.results.filter(result => result.opponent === b.team);
      const aWins = direct.filter(result => result.outcome === 'G').length;
      const bWins = direct.filter(result => result.outcome === 'P').length;
      a.direct = { opponent: b.team, wins: aWins, losses: bWins };
      b.direct = { opponent: a.team, wins: bWins, losses: aWins };
      if (aWins !== bWins) {
        const winner = aWins > bWins ? a : b;
        const loser = winner === a ? b : a;
        winner.explanation = `Desempate directo: ganó la serie ${Math.max(aWins, bWins)}–${Math.min(aWins, bWins)} ante ${loser.team}.`;
        loser.explanation = `Desempate directo: perdió la serie ${Math.min(aWins, bWins)}–${Math.max(aWins, bWins)} ante ${winner.team}.`;
        loser.rank = start + 2;
        sorted[start] = winner;
        sorted[start + 1] = loser;
      } else {
        const reason = direct.length ? `la serie directa está igualada ${aWins}–${bWins}` : 'no hay enfrentamientos directos finalizados';
        for (const row of group) row.explanation = `Desempate pendiente: ${reason}.`;
      }
    } else if (group.length > 2) {
      for (const row of group) row.explanation = `Desempate pendiente: empate entre ${group.length} equipos. Falta definir el desempate múltiple del torneo.`;
    }
    start = end;
  }
  return sorted;
}
