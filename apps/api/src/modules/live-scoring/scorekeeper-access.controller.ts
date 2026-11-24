import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Post, Query, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { aggregateStatistics, scorekeeperPlanLevel, statisticsGroupKey } from '@playsport/shared';
import { AccountsService } from '../accounts/accounts.service';
import { accountToken, assertAccountOrigin } from '../accounts/account-http';
import { OfficialScoringService } from './official-scoring.service';

@Controller('sports-sheet')
export class ScorekeeperAccessController {
  constructor(private readonly accounts: AccountsService, private readonly scoring: OfficialScoringService) {}
  private own(req: IncomingMessage) {
    const account = this.accounts.authenticate(accountToken(req));
    if (account.identity?.status !== 'verified' || !account.identity.actorId)
      throw new ForbiddenException('Verifica tu identidad para consultar tus accesos de Anotador.');
    return { account, actorId: account.identity.actorId };
  }
  private query(query: Record<string, unknown>, keys: string[]) {
    if (Object.keys(query).some(key => !keys.includes(key)) ||
        Object.values(query).some(value => typeof value !== 'string' || !value || value.length > 1000))
      throw new BadRequestException('La consulta de Anotador contiene parámetros no válidos.');
  }
  @Get('scorekeeper-tournaments')
  @Header('Cache-Control', 'private, no-store')
  access(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>) {
    this.query(query, []);
    const { account, actorId } = this.own(req);
    return { ...this.accounts.scorekeeperAccess(account, this.scoring.scorekeeperTournaments(actorId)),
      substitutions: this.scoring.scorekeeperSubstituteGames(actorId) };
  }
  @Post('scorekeeper-tournaments')
  @Header('Cache-Control', 'private, no-store')
  select(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>, @Body() body: unknown) {
    this.query(query, []); assertAccountOrigin(req);
    const { account, actorId } = this.own(req);
    return { ...this.accounts.changeScorekeeperTournaments(account, this.scoring.scorekeeperTournaments(actorId), body),
      substitutions: this.scoring.scorekeeperSubstituteGames(actorId) };
  }
  @Get('scorekeeper-substitutions')
  @Header('Cache-Control', 'private, no-store')
  substitutions(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>) {
    this.query(query, ['tournamentId', 'gameId']);
    if (typeof query.tournamentId !== 'string' || typeof query.gameId !== 'string') throw new BadRequestException('Selecciona el torneo y partido de la suplencia.');
    const { account, actorId } = this.own(req);
    return { accountId: account.id, tournamentId: query.tournamentId, gameId: query.gameId,
      ...this.scoring.scorekeeperSubstitutions(actorId, query.tournamentId, query.gameId) };
  }
  @Post('scorekeeper-substitutions')
  @Header('Cache-Control', 'private, no-store')
  changeSubstitution(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>, @Body() body: unknown) {
    this.query(query, []); assertAccountOrigin(req);
    const { account, actorId } = this.own(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('La suplencia no es válida.');
    const row = Object.fromEntries(Object.entries(body));
    const fields = ['expectedAccountId', 'tournamentId', 'gameId', 'expectedRevision', 'action', 'reason',
      ...(row.action === 'grant' ? ['identification'] : ['substituteActorId'])];
    if (Object.keys(row).some(key => !fields.includes(key)) || row.expectedAccountId !== account.id ||
        typeof row.tournamentId !== 'string' || !row.tournamentId.trim() || row.tournamentId.length > 1000 ||
        typeof row.gameId !== 'string' || !row.gameId.trim() || row.gameId.length > 1000 ||
        !Number.isSafeInteger(row.expectedRevision) || Number(row.expectedRevision) < 0 ||
        row.action !== 'grant' && row.action !== 'revoke' || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 500)
      throw new BadRequestException('Completa tu cuenta, el partido, el motivo y la revisión de la suplencia.');
    this.scoring.scorekeeperSubstitutions(actorId, row.tournamentId, row.gameId);
    let substituteActorId: string, name: string | undefined, identification: string | undefined;
    if (row.action === 'grant') {
      if (typeof row.identification !== 'string' || !/^[ve][-\s]?\d+$/i.test(row.identification.trim()))
        throw new BadRequestException('Indica la cédula vinculada a la cuenta del suplente.');
      const person = this.accounts.verifiedPerson(row.identification.trim());
      if (!person?.identity.actorId) throw new ForbiddenException('El suplente debe tener una cuenta existente con su cédula verificada.');
      substituteActorId = person.identity.actorId; name = person.identity.fullName; identification = person.identity.identification;
    } else {
      if (typeof row.substituteActorId !== 'string' || !row.substituteActorId.startsWith('person:')) throw new BadRequestException('Selecciona la suplencia que deseas revocar.');
      substituteActorId = row.substituteActorId;
    }
    return { accountId: account.id, tournamentId: row.tournamentId, gameId: row.gameId,
      ...this.scoring.changeScorekeeperSubstitution({ organizerId: actorId, tournamentId: row.tournamentId, gameId: row.gameId,
        expectedRevision: Number(row.expectedRevision), action: row.action, reason: row.reason, substituteActorId, name, identification }) };
  }
  @Get('scorekeeper-games')
  @Header('Cache-Control', 'private, no-store')
  games(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>) {
    this.query(query, []);
    const { account, actorId } = this.own(req);
    return { accountId: account.id, ...this.scoring.listOfficialGames(actorId, 'scorekeeper', true) };
  }
  @Post('scorekeeper-extra')
  @Header('Cache-Control', 'private, no-store')
  request(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>, @Body() body: unknown) {
    this.query(query, []); assertAccountOrigin(req);
    const { account, actorId } = this.own(req);
    if (!body || typeof body !== 'object' || !('tournamentId' in body) || !('gameId' in body) ||
        typeof body.tournamentId !== 'string' || typeof body.gameId !== 'string' ||
        !this.scoring.scorekeeperGameAssigned(actorId, body.tournamentId, body.gameId))
      throw new ForbiddenException('Solo puedes solicitar acceso a un partido asignado por su organizador.');
    return this.accounts.requestScorekeeperExtra(account, body);
  }
  @Get('scorekeeper-statistics')
  @Header('Cache-Control', 'private, no-store')
  statistics(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>) {
    this.query(query, ['tournamentId', 'gameId']);
    if (typeof query.tournamentId !== 'string') throw new BadRequestException('Selecciona un único torneo.');
    const { account, actorId } = this.own(req), level = scorekeeperPlanLevel(account);
    if (level < 2) throw new ForbiddenException('El box score completo requiere Anotador nivel 2 o 3.');
    const gameId = typeof query.gameId === 'string' ? query.gameId : undefined;
    if (!gameId && level !== 3) throw new ForbiddenException('Los acumulados individuales por torneo requieren Anotador nivel 3.');
    const tournaments = this.scoring.scorekeeperTournaments(actorId);
    const substitution = Boolean(gameId && this.scoring.isScorekeeperSubstitute(actorId, query.tournamentId, gameId));
    if (!substitution) this.accounts.assertScorekeeperAccess(account, tournaments, query.tournamentId, gameId);
    const access = this.accounts.scorekeeperAccess(account, tournaments);
    if (!access.tournaments.some(team => team.tournamentId === query.tournamentId && team.enabled) &&
        (!gameId || !this.scoring.scorekeeperGameAssigned(actorId, query.tournamentId, gameId)))
      throw new ForbiddenException('El acceso puntual permite consultar únicamente el partido asignado.');
    const result = this.scoring.scorekeeperStatistics(actorId, query.tournamentId, gameId);
    const groups = new Map<string, typeof result.players>();
    if (!gameId) for (const player of result.players) {
      const key = JSON.stringify([player.id, statisticsGroupKey(player.game)]);
      groups.set(key, [...(groups.get(key) ?? []), player]);
    }
    return { accountId: account.id, tournamentId: query.tournamentId, gameId: gameId ?? null, ...result,
      totals: [...groups.values()].map(rows => ({ id: rows[0].id, name: rows[0].name,
        group: [rows[0].game.sport === 'baseball' ? 'Béisbol' : rows[0].game.sport === 'softball' ? 'Softbol' : 'Sin deporte definido',
          rows[0].game.modality, rows[0].game.category, `PCL/${rows[0].game.eraBase ?? 'sin base'}`].join(' · '),
        line: aggregateStatistics(rows.map(row => row.game)) })) };
  }
}
