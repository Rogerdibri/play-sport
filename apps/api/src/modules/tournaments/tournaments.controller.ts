import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { accountToken, assertAccountOrigin } from '../accounts/account-http';
import { TournamentsService } from './tournaments.service';
@Controller('tournaments')
export class TournamentsController {
  private readonly tournaments: TournamentsService;
  constructor(tournaments: TournamentsService) {
    this.tournaments = tournaments;
  }
  private query(query: Record<string, unknown>, keys: string[]) {
    if (
      Object.keys(query).some((key) => !keys.includes(key)) ||
      Object.values(query).some((value) => typeof value !== 'string')
    )
      throw new BadRequestException('La consulta de torneos no es válida.');
  }
  @Get()
  list(
    @Query() q: Record<string, unknown>,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse
  ) {
    this.query(q, ['role', 'actorId']);
    res.setHeader('Cache-Control', 'no-store');
    return this.tournaments.list(accountToken(req), q.role, q.actorId);
  }
  @Get('public')
  publicList(@Query() q: Record<string, unknown>, @Res({ passthrough: true }) res: ServerResponse) {
    this.query(q, []);
    res.setHeader('Cache-Control', 'no-store');
    return this.tournaments.publicList();
  }
  @Get('capacity')
  capacity(@Query() q: Record<string, unknown>, @Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.query(q, []); res.setHeader('Cache-Control', 'private, no-store');
    return this.tournaments.capacity(accountToken(req));
  }
  @Post('free-reservation')
  @HttpCode(200)
  reserveFree(@Query() q: Record<string, unknown>, @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse, @Body() body: unknown) {
    this.query(q, []); assertAccountOrigin(req); res.setHeader('Cache-Control', 'private, no-store');
    return this.tournaments.reserveFree(accountToken(req), body);
  }
  @Get('manager')
  manager(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    return this.tournaments.managerList(accountToken(req));
  }
  @Post('plan-selection')
  @HttpCode(200)
  selectPlan(@Query() q: Record<string, unknown>, @Req() req: IncomingMessage, @Body() body: unknown,
    @Res({ passthrough: true }) res: ServerResponse) {
    this.query(q, []); assertAccountOrigin(req); res.setHeader('Cache-Control', 'private, no-store');
    return this.tournaments.selectPlan(accountToken(req), body);
  }
  @Get('admin-capacity')
  adminCapacity(@Query() q: Record<string, unknown>, @Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.query(q, ['tournamentId']); res.setHeader('Cache-Control', 'private, no-store');
    if (typeof q.tournamentId !== 'string' || !q.tournamentId) throw new BadRequestException('Indica el torneo.');
    return this.tournaments.adminCapacity(accountToken(req), q.tournamentId);
  }
  @Post('plan-authorization')
  @HttpCode(200)
  authorizePlan(@Query() q: Record<string, unknown>, @Req() req: IncomingMessage, @Body() body: unknown,
    @Res({ passthrough: true }) res: ServerResponse) {
    this.query(q, []); assertAccountOrigin(req); res.setHeader('Cache-Control', 'private, no-store');
    return this.tournaments.authorizePlan(accountToken(req), body);
  }
  @Post('restart-game')
  @HttpCode(200)
  restartGame(@Query() q: Record<string, unknown>, @Req() req: IncomingMessage, @Body() body: unknown,
    @Res({ passthrough: true }) res: ServerResponse) {
    this.query(q, []); assertAccountOrigin(req); res.setHeader('Cache-Control', 'private, no-store');
    return this.tournaments.restartGame(accountToken(req), body);
  }
  @Post('manager')
  @HttpCode(200)
  managerChange(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse, @Body() body: unknown) {
    assertAccountOrigin(req); res.setHeader('Cache-Control', 'no-store');
    return this.tournaments.managerChange(accountToken(req), body);
  }
  @Get('public/:id')
  publicTournament(
    @Param('id') id: string,
    @Query() q: Record<string, unknown>,
    @Res({ passthrough: true }) res: ServerResponse
  ) {
    this.query(q, []);
    res.setHeader('Cache-Control', 'no-store');
    return this.tournaments.getPublic(id);
  }
  @Get(':id/roster')
  roster(
    @Param('id') id: string,
    @Query() q: Record<string, unknown>,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse
  ) {
    this.query(q, ['role', 'actorId', 'teamId']);
    res.setHeader('Cache-Control', 'no-store');
    if (typeof q.teamId !== 'string') throw new BadRequestException('Falta el equipo.');
    return this.tournaments.roster(accountToken(req), q.role, q.actorId, id, q.teamId);
  }
  @Get(':id/history')
  history(
    @Param('id') id: string,
    @Query() q: Record<string, unknown>,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse
  ) {
    this.query(q, ['role', 'actorId']);
    res.setHeader('Cache-Control', 'no-store');
    return this.tournaments.history(accountToken(req), q.role, q.actorId, id);
  }
  @Post()
  @HttpCode(200)
  change(
    @Body() body: unknown,
    @Query() q: Record<string, unknown>,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse
  ) {
    this.query(q, []);
    assertAccountOrigin(req);
    res.setHeader('Cache-Control', 'no-store');
    return this.tournaments.change(accountToken(req), body);
  }
}
