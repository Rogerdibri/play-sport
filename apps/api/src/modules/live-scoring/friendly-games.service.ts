import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { changeGameClock, pauseGameClock, isGameClockAction, isTimedScoringCommand, startOrResumeGameClock } from '@playsport/shared';
import { assertScoringSubmission, createGameReport, isFriendlyArrivalSubstitution, isFriendlyCommand, isParticipantIdentity, linkScorecardParticipant,
  personalScorecardStatistics, minimumDestinations, readFriendlyGame, readFriendlySetup, replayPrivate, setLastPrivateErrorOuts,
  type FriendlyGame, type FriendlyParticipant, type PrivateCommand, type PrivatePlayer } from '@playsport/shared';

type StoredGame = Omit<FriendlyGame, 'state'> & { ownerId: string };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
@Injectable()
export class FriendlyGamesService {
  private readonly path: string;
  constructor(path?: string) { this.path = path ?? resolve(process.env.PLAYSPORT_FRIENDLY_PATH ?? '.local/friendly-games.json'); }
  private read(): StoredGame[] {
    if (!existsSync(this.path)) return [];
    const value: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
    if (!record(value) || value.version !== 1 || !Array.isArray(value.games)) throw new Error('El archivo de amistosos es inválido. No se sobrescribió.');
    const games = value.games.map((item: unknown) => {
      if (!record(item) || typeof item.ownerId !== 'string' || !item.ownerId) throw new Error('El amistoso no tiene un creador válido.');
      const game = readFriendlyGame(item);
      return { id: game.id, ownerId: item.ownerId, revision: game.revision, sport: game.sport,
        createdAt: game.createdAt, updatedAt: game.updatedAt, seed: game.seed, commands: game.commands,
        ...(game.clock ? { clock: game.clock } : {}) };
    });
    if (new Set(games.map(game => game.id)).size !== games.length) throw new Error('Hay amistosos duplicados. No se sobrescribió el archivo.');
    return games;
  }
  private write<T>(change: (_games: StoredGame[]) => T): T { // eslint-disable-line no-unused-vars
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const lockPath = `${this.path}.lock`;
    let lock: number;
    try { lock = openSync(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new ConflictException('Los amistosos están guardándose. Vuelve a intentar.');
      throw error;
    }
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const games = this.read();
      const result = change(games);
      writeFileSync(temporary, JSON.stringify({ version: 1, games }), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
      return result;
    } finally { if (existsSync(temporary)) unlinkSync(temporary); closeSync(lock); unlinkSync(lockPath); }
  }
  list(ownerId: string) { return { games: this.read().filter(game => game.ownerId === ownerId).map(readFriendlyGame) }; }
  personalStatistics(identification: string) {
    return this.read().flatMap(game => personalScorecardStatistics(readFriendlyGame(game).state, identification, {
      kind: 'friendly', gameId: game.id, tournamentId: 'friendly', tournamentName: 'Partido amistoso', version: game.revision,
    }));
  }
  report(ownerId: string, id: string, detailed: boolean) {
    const game = this.read().find(entry => entry.id === id && entry.ownerId === ownerId);
    if (!game) throw new NotFoundException('No se encontró ese amistoso en tu cuenta.');
    return createGameReport(readFriendlyGame(game).state, { source: 'friendly', detailed });
  }
  importLegacy(ownerId: string, legacyOwnerId: string, ids: string[]) {
    return this.write(games => {
      const selected = [...new Set(ids)].map(id => {
        const game = games.find(item => item.id === id);
        if (!game || game.ownerId !== legacyOwnerId && game.ownerId !== ownerId)
          throw new ForbiddenException('No se puede incorporar un amistoso que no pertenece a este acceso anterior.');
        return game;
      });
      for (const game of selected) {
        if (game.ownerId === ownerId) continue;
        game.ownerId = ownerId;
        game.revision++;
        game.updatedAt = new Date().toISOString();
      }
      return { games: selected.map(readFriendlyGame) };
    });
  }
  create(ownerId: string, input: unknown): FriendlyGame {
    const setup = this.validate(() => readFriendlySetup(input));
    const players = (participants: FriendlyParticipant[], starters = true): PrivatePlayer[] => participants.map(({ name, position }, index) => ({
      id: randomUUID(), name, jersey: '', position, order: starters ? index + 1 : null
    }));
    const lineups = { home: players(setup.lineups.home), away: players(setup.lineups.away) };
    const rosters = structuredClone(lineups);
    for (const side of ['home', 'away'] as const)
      rosters[side].push(...players(setup.substitutes[side].map(name => ({ name, position: 'NA' })), false));
    const timestamp = new Date().toISOString();
    const game: StoredGame = { id: `friendly-${randomUUID()}`, ownerId, revision: 1, sport: setup.sport,
      createdAt: timestamp, updatedAt: timestamp, commands: [], seed: {
        friendly: true, names: setup.names, lineups, rosters,
        courtesyRunnerSource: 'ROSTER', regulationInnings: setup.sport === 'baseball' ? 9 : 7,
        sport: setup.sport, scoringRules: setup.sport === 'baseball' ? 'baseball' : 'softball-fastpitch',
        ...(setup.sport === 'softball' ? { softballTieBreakerFromInning: 8 } : {})
      } };
    return this.write(games => { games.push(game); return readFriendlyGame(game); });
  }
  update(ownerId: string, id: string, input: unknown): FriendlyGame {
    if (!record(input)) throw new BadRequestException('La anotación requiere una operación válida.');
    const operations = [input.undo, input.command, input.errorOuts, input.clockAction, input.arrivalSubstitution, input.participantIdentity].filter(value => value !== undefined);
    if (operations.length !== 1 || input.clockAction !== undefined && !isGameClockAction(input.clockAction)) {
      throw new BadRequestException('Envía una sola operación válida del amistoso por vez.');
    }
    if (!record(input) || typeof input.expectedRevision !== 'number' || !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 1 || !((input.undo === true && input.command === undefined && input.errorOuts === undefined) ||
        (input.undo === undefined && input.errorOuts === undefined && isFriendlyCommand(input.command)) ||
        isGameClockAction(input.clockAction) || isFriendlyArrivalSubstitution(input.arrivalSubstitution) || isParticipantIdentity(input.participantIdentity) ||
        (input.undo === undefined && input.command === undefined && (input.errorOuts === null ||
          typeof input.errorOuts === 'number' && Number.isInteger(input.errorOuts) && input.errorOuts >= 0 && input.errorOuts <= 3)))) {
      throw new BadRequestException('La anotación requiere una jugada válida y la versión vigente.');
    }
    return this.write(games => {
      const game = games.find(item => item.id === id);
      if (!game) throw new NotFoundException('No existe este amistoso.');
      if (game.ownerId !== ownerId) throw new ForbiddenException('Solo el creador puede consultar o anotar este amistoso.');
      if (game.revision !== input.expectedRevision) throw new ConflictException('El amistoso cambió en otra pantalla. Actualiza antes de anotar; no se guardó la jugada.');
      if (isParticipantIdentity(input.participantIdentity)) {
        const participant = input.participantIdentity;
        game.seed = this.validate(() => linkScorecardParticipant(game.seed, participant));
        game.revision++;
        game.updatedAt = new Date().toISOString();
        return readFriendlyGame(game);
      }
      const state = replayPrivate(game.seed, game.commands);
      if (state.finished) throw new ConflictException('Este amistoso ya finalizó y solo permite consulta.');
      if (isFriendlyArrivalSubstitution(input.arrivalSubstitution)) {
        const { side, outId, name } = input.arrivalSubstitution;
        const outgoing = state.lineups[side].find(player => player.id === outId);
        if (!outgoing) throw new BadRequestException('El jugador saliente ya no está activo. Actualiza la hoja.');
        const incoming: PrivatePlayer = { id: randomUUID(), name: name.trim(), position: 'NA', jersey: '', order: null };
        game.seed.rosters[side].push(incoming);
        const command: PrivateCommand = {
          kind: 'substitution', side, outId, inId: incoming.id, position: outgoing.position, jersey: ''
        };
        this.validate(() => assertScoringSubmission(replayPrivate(game.seed, game.commands), command));
        game.commands.push(command);
      } else if (isGameClockAction(input.clockAction)) {
        const action = input.clockAction;
        game.clock = this.validate(() => changeGameClock(game.clock, action, new Date().toISOString()));
      } else if (input.undo === true) {
        if (!game.commands.length) throw new BadRequestException('No hay anotaciones para deshacer.');
        game.commands.pop();
      } else if (input.errorOuts === null || typeof input.errorOuts === 'number') {
        game.commands = this.validate(() => setLastPrivateErrorOuts(game.seed, game.commands, input.errorOuts === null ? undefined : Number(input.errorOuts))).commands;
      } else {
        const command = input.command;
        if (!isFriendlyCommand(command)) throw new BadRequestException('La jugada del amistoso no es válida.');
        this.validate(() => assertScoringSubmission(state, command));
        game.commands.push(command.kind === 'play' && command.destinations === undefined ?
          { ...command, destinations: minimumDestinations(state, command.result) } : command);
      }
      const nextState = this.validate(() => replayPrivate(game.seed, game.commands));
      if (isFriendlyCommand(input.command) && isTimedScoringCommand(input.command))
        game.clock = this.validate(() => startOrResumeGameClock(game.clock, new Date().toISOString()));
      if (nextState.finished && game.clock) game.clock = pauseGameClock(game.clock, new Date().toISOString());
      game.revision++; game.updatedAt = new Date().toISOString();
      return readFriendlyGame(game);
    });
  }
  private validate<T>(action: () => T): T {
    try { return action(); }
    catch (error) { if (error instanceof Error) throw new BadRequestException(error.message); throw error; }
  }
}
