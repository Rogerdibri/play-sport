import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Post, Req, Res, Query } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { AccountsService } from './accounts.service';
import { accountCookieName, accountToken, assertAccountOrigin } from './account-http';

@Controller('accounts')
export class AccountsController {
  private readonly accounts: AccountsService;
  constructor(accounts: AccountsService) { this.accounts = accounts; }
  @Get('scorekeeper-extras')
  scorekeeperExtras(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse, @Query() query: Record<string, unknown>) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (Object.keys(query).length) throw new BadRequestException('La cola no admite parámetros adicionales.');
    return this.accounts.scorekeeperExtraQueue(this.token(req));
  }
  @Post('scorekeeper-extras')
  @HttpCode(200)
  reviewScorekeeperExtra(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse,
    @Query() query: Record<string, unknown>, @Body() body: unknown) {
    this.origin(req); res.setHeader('Cache-Control', 'private, no-store');
    if (Object.keys(query).length) throw new BadRequestException('La revisión no admite parámetros adicionales.');
    return this.accounts.reviewScorekeeperExtra(this.token(req), body);
  }
  @Get('administration')
  administration(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse, @Query() query: Record<string, unknown>) {
    res.setHeader('Cache-Control', 'private, no-store');
    return this.accounts.administration(this.token(req), query);
  }
  @Post('administration')
  @HttpCode(200)
  changeTrial(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse, @Body() body: unknown, @Query() query: Record<string, unknown>) {
    this.origin(req); res.setHeader('Cache-Control', 'private, no-store');
    if (Object.keys(query).length) throw new BadRequestException('La modificación administrativa no admite parámetros en la URL.');
    return this.accounts.changeTrial(this.token(req), body);
  }
  @Get('access')
  access(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse, @Query() query: Record<string, unknown>) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (Object.keys(query).length) throw new BadRequestException('Consulta únicamente los accesos de tu propia cuenta.');
    return this.accounts.ownAccess(this.token(req));
  }
  @Post('activate-role')
  @HttpCode(200)
  activateRole(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse,
    @Query() query: Record<string, unknown>, @Body() body: unknown) {
    this.origin(req); res.setHeader('Cache-Control', 'private, no-store');
    if (Object.keys(query).length) throw new BadRequestException('La activación no admite parámetros en la URL.');
    return this.accounts.activateRole(this.token(req), body);
  }
  @Get('scorecards')
  scorecards(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse, @Query() query: Record<string, unknown>) {
    res.setHeader('Cache-Control', 'private, no-store');
    const scope = query.scope;
    if (Object.keys(query).some(key => key !== 'scope') ||
        scope !== undefined && (typeof scope !== 'string' || !scope || scope.length > 1000))
      throw new BadRequestException('Consulta únicamente tus propias planillas y un ámbito válido.');
    return this.accounts.privateScorecards(this.token(req), scope);
  }
  @Post('scorecards')
  @HttpCode(200)
  saveScorecard(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse, @Body() body: unknown) {
    this.origin(req); res.setHeader('Cache-Control', 'private, no-store');
    return this.accounts.savePrivateScorecard(this.token(req), body);
  }
  @Get('scorecards/report')
  scorecardReport(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse, @Query() query: Record<string, unknown>) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (Object.keys(query).some(key => key !== 'scope') ||
        typeof query.scope !== 'string' || !query.scope || query.scope.length > 1000)
      throw new BadRequestException('Consulta el resumen de una planilla de tu propia cuenta.');
    return this.accounts.privateScorecardReport(this.token(req), query.scope);
  }
  @Get('profile')
  profile(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    return this.accounts.personalProfile(this.token(req));
  }
  @Post('profile')
  @HttpCode(200)
  saveProfile(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse, @Body() body: unknown) {
    this.origin(req); res.setHeader('Cache-Control', 'no-store');
    return this.accounts.changePersonalProfile(this.token(req), body);
  }

  @Post('identity')
  @HttpCode(200)
  identity(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse, @Body() body: unknown) {
    this.origin(req); res.setHeader('Cache-Control', 'no-store');
    return this.accounts.submitIdentity(this.token(req), body);
  }
  @Get('identity-requests')
  identityRequests(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    return this.accounts.identityQueue(this.token(req));
  }
  @Get('identity-evidence')
  identityEvidence(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse, @Query('accountId') id: string) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    return this.accounts.identityEvidence(this.token(req), id);
  }
  @Post('identity-review')
  @HttpCode(200)
  identityReview(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse, @Body() body: unknown) {
    this.origin(req); res.setHeader('Cache-Control', 'no-store');
    return this.accounts.reviewIdentity(this.token(req), body);
  }

  private cookieName() {
    return accountCookieName();
  }

  private token(request: IncomingMessage): string | undefined {
    return accountToken(request);
  }

  private origin(request: IncomingMessage) {
    assertAccountOrigin(request);
  }

  private address(request: IncomingMessage): string {
    const socket = request.socket.remoteAddress;
    if (!socket) throw new ForbiddenException('No se pudo verificar el origen de la conexión.');
    const forwarded = request.headers['x-playsport-client-ip'];
    if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(socket) && typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
    return socket;
  }

  private cookie(response: ServerResponse, token: string, clear = false) {
    response.setHeader('Set-Cookie', `${this.cookieName()}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 34560000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    response.setHeader('Cache-Control', 'no-store');
  }

  @Post('register')
  async register(@Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse, @Body() body: unknown) {
    this.origin(request);
    const result = await this.accounts.register(body, this.address(request));
    this.cookie(response, result.token);
    return { account: result.account };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse, @Body() body: unknown) {
    this.origin(request);
    const result = await this.accounts.login(body, this.address(request));
    this.cookie(response, result.token);
    return { account: result.account };
  }

  @Get('me')
  me(@Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    const token = this.token(request), account = this.accounts.authenticate(token);
    if (account.localTestAccess && token) this.cookie(response, token);
    return { account };
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse) {
    this.origin(request);
    this.accounts.logout(this.token(request));
    this.cookie(response, '', true);
  }

  @Post('password')
  @HttpCode(200)
  async password(@Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse, @Body() body: unknown) {
    this.origin(request);
    const result = await this.accounts.changePassword(this.token(request), body);
    this.cookie(response, result.token);
    return { account: result.account };
  }
  @Post('photo')
  @HttpCode(200)
  photo(@Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse, @Body() body: unknown) {
    this.origin(request); response.setHeader('Cache-Control', 'no-store');
    return this.accounts.changePhoto(this.token(request), body);
  }
}
