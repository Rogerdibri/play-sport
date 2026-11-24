import { BadRequestException, Body, Controller, Get, Header, Param, Post, Req, Query } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { AccountsService } from '../accounts/accounts.service';
import { accountToken, assertAccountOrigin } from '../accounts/account-http';
import { FriendlyGamesService } from './friendly-games.service';
import { RegistrationService } from './registration.service';
import { hasAccountFeature } from '@playsport/shared';

@Controller('friendly-games')
export class FriendlyGamesController {
  constructor(private readonly games: FriendlyGamesService, private readonly registry: RegistrationService,
    private readonly accounts: AccountsService) {}
  private owner(request: IncomingMessage) {
    if (request.method !== 'GET') assertAccountOrigin(request);
    return `account:${this.accounts.authenticate(accountToken(request)).id}`;
  }
  private legacy(input: unknown) {
    if (!input || typeof input !== 'object' || !('key' in input) || typeof input.key !== 'string' || !/^[a-f0-9]{64}$/.test(input.key))
      throw new BadRequestException('Selecciona un acceso anterior válido de este dispositivo.');
    return this.registry.getFamily(input.key).id;
  }
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Req() request: IncomingMessage) { return this.games.list(this.owner(request)); }
  @Get(':id/final-report')
  @Header('Cache-Control', 'private, no-store')
  report(@Req() request: IncomingMessage, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw new BadRequestException('El resumen no admite parámetros de cuenta o permisos.');
    const account = this.accounts.authenticate(accountToken(request));
    return this.games.report(`account:${account.id}`, id, hasAccountFeature(account, 'final-report-details'));
  }
  @Post()
  @Header('Cache-Control', 'private, no-store')
  create(@Req() request: IncomingMessage, @Body() input: unknown) { return this.games.create(this.owner(request), input); }
  @Post('legacy/preview')
  @Header('Cache-Control', 'private, no-store')
  preview(@Req() request: IncomingMessage, @Body() input: unknown) {
    this.owner(request);
    return this.games.list(this.legacy(input));
  }
  @Post('legacy/import')
  @Header('Cache-Control', 'private, no-store')
  import(@Req() request: IncomingMessage, @Body() input: unknown) {
    const owner = this.owner(request), legacy = this.legacy(input);
    if (!input || typeof input !== 'object' || !('confirmed' in input) || input.confirmed !== true ||
        !('ids' in input) || !Array.isArray(input.ids) || !input.ids.length || input.ids.length > 100 ||
        !input.ids.every((id: unknown) => typeof id === 'string'))
      throw new BadRequestException('Selecciona tus amistosos y confirma que pertenecen a tu cuenta.');
    return this.games.importLegacy(owner, legacy, input.ids);
  }
  @Post(':id/updates')
  @Header('Cache-Control', 'private, no-store')
  update(@Req() request: IncomingMessage, @Param('id') id: string, @Body() input: unknown) {
    return this.games.update(this.owner(request), id, input);
  }
}
