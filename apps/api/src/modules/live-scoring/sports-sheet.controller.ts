import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import type { AccountProfile, SportsSheetTeam } from '@playsport/shared';
import { AccountsService } from '../accounts/accounts.service';
import { accountToken, assertAccountOrigin } from '../accounts/account-http';
import { OfficialScoringService } from './official-scoring.service';
import { FriendlyGamesService } from './friendly-games.service';
import { exampleStatisticsGames, exampleCareerGames, hasAccountFeature, readStatisticsFilters, filterStatisticsGames, statisticsFilterKeys } from '@playsport/shared';

@Controller('sports-sheet')
export class SportsSheetController {
  constructor(private readonly accounts: AccountsService, private readonly scoring: OfficialScoringService,
    private readonly friendly: FriendlyGamesService) {}
  private teams(account: AccountProfile): SportsSheetTeam[] {
    if (account.identity?.status !== 'verified') return [];
    if (!account.identity.actorId) throw new ConflictException('No se pudo resolver tu identidad deportiva verificada.');
    const publicTeams = this.scoring.publicSportsTournaments().tournaments;
    const rows = [
      ...this.scoring.listPlayerTeams(account.identity.identification).map(team => ({ ...team, role: 'player' as const })),
      ...this.scoring.listManagerSportsTeams(account.identity.actorId, account.id)
        .map(team => ({ ...team, role: 'manager' as const })),
    ];
    return rows.map(({ role, tournamentId, tournamentName, teamId, teamName, leagueName }) => ({
      role, tournamentId, tournamentName, teamId, teamName, leagueName,
      published: publicTeams.some(tournament => tournament.id === tournamentId && tournament.teams.some(team => team.id === teamId)),
    }));
  }
  private noQuery(query: Record<string, unknown>) {
    if (Object.keys(query).length) throw new BadRequestException('La hoja deportiva no admite parámetros de identidad.');
  }
  private managerTeams(account: AccountProfile) {
    if (account.identity?.status !== 'verified') return [];
    if (!account.identity.actorId) throw new ConflictException('No se pudo resolver tu identidad deportiva verificada.');
    return this.scoring.managerPlanTeams(account.identity.actorId, account.id);
  }
  @Get('manager-teams')
  @Header('Cache-Control', 'private, no-store')
  managerAccess(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>) {
    this.noQuery(query);
    const account = this.accounts.authenticate(accountToken(req));
    return this.accounts.managerTeamAccess(account, this.managerTeams(account));
  }
  @Post('manager-teams')
  @Header('Cache-Control', 'private, no-store')
  managerSelection(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>, @Body() body: unknown) {
    this.noQuery(query); assertAccountOrigin(req);
    const account = this.accounts.authenticate(accountToken(req));
    return this.accounts.changeManagerTeams(account, this.managerTeams(account), body);
  }
  @Get('manager-player-totals')
  @Header('Cache-Control', 'private, no-store')
  managerPlayerTotals(@Req() req: IncomingMessage) {
    const account = this.accounts.authenticate(accountToken(req));
    throw new ForbiddenException({
      code: 'MANAGER_PLAYER_TOTALS_UNAVAILABLE', accountId: account.id,
      message: 'Manager consulta las estadísticas de cada jugador solo por partido, nunca acumuladas, en ningún nivel.',
    });
  }
  @Get('statistics')
  @Header('Cache-Control', 'private, no-store')
  statistics(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>) {
    const account = this.accounts.authenticate(accountToken(req));
    if (Object.keys(query).some(key => !['mode', 'source', ...statisticsFilterKeys].includes(key)) ||
        !(query.mode === undefined || query.mode === 'player' || query.mode === 'team') ||
        !(query.source === undefined || query.source === 'official' || query.source === 'example'))
      throw new BadRequestException('Las estadísticas se consultan desde tu propia cuenta, sin parámetros de identidad o permisos.');
    if (!hasAccountFeature(account, query.mode === 'team' ? 'team-statistics' : 'player-statistics')) throw new ForbiddenException({
      code: 'STATISTICS_PLAN_REQUIRED', accountId: account.id,
      message: 'Estas estadísticas requieren un acceso de prueba vigente para el plan correspondiente.',
    });
    const mode = query.mode === 'team' ? 'team' : 'player', source = query.source === 'example' ? 'example' : 'official';
    const analysisAllowed = hasAccountFeature(account, mode === 'team' ? 'manager-statistics-analysis' : 'player-statistics-analysis');
    if (!analysisAllowed && Object.keys(query).some(key => key !== 'mode' && key !== 'source')) throw new ForbiddenException({
      code: 'STATISTICS_ANALYSIS_REQUIRED', accountId: account.id,
      message: `Los filtros y acumulados de ${mode === 'team' ? 'Manager' : 'Jugador'} requieren Nivel 3 · Análisis completo.`,
    });
    let filters;
    try { filters = readStatisticsFilters(query); }
    catch (error) {
      if (error instanceof Error) throw new BadRequestException(error.message);
      throw error;
    }
    if (source === 'example' && !account.localTestAccess) throw new ForbiddenException('Los ejemplos internos están reservados a la cuenta maestra; tus registros oficiales permanecen separados.');
    const identity = account.identity?.status === 'verified' ? account.identity : null;
    if (identity && !identity.actorId) throw new ConflictException('No se pudo resolver tu identidad deportiva verificada.');
    const managed = identity && mode === 'team' && source !== 'example' ? this.scoring.managerStatistics(identity.actorId!) : null;
    const games = [...(managed?.games ?? (source === 'example' ? exampleStatisticsGames(mode) :
      identity ? this.scoring.personalStatistics(identity.identification, identity.actorId!, mode) : []))];
    if (identity && source !== 'example' && mode === 'player') {
      games.push(...this.friendly.personalStatistics(identity.identification));
      games.push(...this.accounts.personalPrivateStatistics(identity.identification, games));
    }
    return { accountId: account.id, mode, source, identityVerified: identity !== null, analysisAllowed,
      games: filterStatisticsGames(games, filters), ...(managed ? { players: managed.players } : {}) };
  }
  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  own(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>) {
    this.noQuery(query);
    const token = accountToken(req);
    return { ...this.accounts.sportsSheet(token), teams: this.teams(this.accounts.authenticate(token)) };
  }
  @Get('career')
  @Header('Cache-Control', 'private, no-store')
  career(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>) {
    const account = this.accounts.authenticate(accountToken(req));
    if (Object.keys(query).some(key => key !== 'source') ||
        !(query.source === undefined || query.source === 'official' || query.source === 'example'))
      throw new BadRequestException('La trayectoria se consulta desde tu propia cuenta, sin parámetros de identidad o permisos.');
    if (!hasAccountFeature(account, 'career')) throw new ForbiddenException({
      code: 'CAREER_PLAN_REQUIRED', accountId: account.id,
      message: 'La trayectoria detallada requiere un acceso de prueba vigente.',
    });
    const source = query.source === 'example' ? 'example' : 'official';
    if (source === 'example' && !account.localTestAccess) throw new ForbiddenException('Los ejemplos internos no son participaciones de tu cuenta.');
    const identity = account.identity?.status === 'verified' ? account.identity : null;
    if (identity && !identity.actorId) throw new ConflictException('No se pudo resolver tu identidad deportiva verificada.');
    const games = source === 'example' ? exampleCareerGames() :
      identity ? this.scoring.personalCareer(identity.identification, identity.actorId!) : [];
    return { accountId: account.id, source, identityVerified: identity !== null,
      games: hasAccountFeature(account, 'player-statistics-analysis') ? games : games.filter(game => game.role !== 'player') };
  }
  @Post('me')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  save(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>, @Body() body: unknown) {
    this.noQuery(query); assertAccountOrigin(req);
    const token = accountToken(req);
    const teams = this.teams(this.accounts.authenticate(token));
    return { ...this.accounts.changeSportsSheet(token, body), teams };
  }
  @Get('public/:ref')
  @Header('Cache-Control', 'no-store')
  published(@Param('ref') ref: string, @Query() query: Record<string, unknown>) {
    this.noQuery(query);
    return this.accounts.publishedSportsSheet(ref, account => this.teams(account));
  }
}
