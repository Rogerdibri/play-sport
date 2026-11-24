import { BadRequestException, Body, Controller, Get, Header, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { favoriteKey, playerDemoTournaments, playerDemoFavoritePlayers, type FavoriteTarget } from '@playsport/shared';
import { AccountsService } from '../accounts/accounts.service';
import { accountToken, assertAccountOrigin } from '../accounts/account-http';
import { OfficialScoringService } from './official-scoring.service';

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly accounts: AccountsService, private readonly scoring: OfficialScoringService) {}
  private catalog(examples: boolean): FavoriteTarget[] {
    const targets = new Map<string, FavoriteTarget>();
    const add = (target: FavoriteTarget) => {
      const key = favoriteKey(target), previous = targets.get(key);
      if (!previous) targets.set(key, target);
      else for (const link of target.memberships)
        if (!previous.memberships.some(row => row.tournamentId === link.tournamentId && row.teamId === link.teamId))
          previous.memberships.push(link);
    };
    const exampleIds = new Set(examples ? playerDemoTournaments.map(row => row.id) : []);
    const tournaments = [...this.scoring.publicSportsTournaments().tournaments, ...(examples ? playerDemoTournaments : [])];
    for (const tournament of tournaments) {
      const marker = exampleIds.has(tournament.id) ? { example: true } : {};
      if (tournament.leagueId) add({ kind: 'league', id: tournament.leagueId, name: tournament.leagueName,
        ...marker, memberships: [{ tournamentId: tournament.id, teamId: '' }] });
      for (const team of tournament.teams) add({ kind: 'team', id: team.id, name: team.name,
        ...marker, memberships: [{ tournamentId: tournament.id, teamId: team.id }] });
    }
    for (const player of this.scoring.publicFavoritePlayers()) add({
      kind: 'player', id: this.accounts.favoritePlayerId(player.identificationNumber), name: player.name,
      memberships: [{ tournamentId: player.tournamentId, teamId: player.teamId }],
    });
    if (examples) for (const player of playerDemoFavoritePlayers) add({
      kind: 'player', id: this.accounts.favoritePlayerId(player.id), name: player.name, example: true,
      memberships: [{ tournamentId: player.membership.tournamentId, teamId: player.membership.teamId }],
    });
    return [...targets.values()];
  }
  private ownCatalog(req: IncomingMessage, query: Record<string, unknown>) {
    const account = this.accounts.authenticate(accountToken(req));
    if (Object.keys(query).length) throw new BadRequestException('Los favoritos se consultan desde tu propia cuenta, sin parámetros de identidad.');
    return this.catalog(account.localTestAccess === true);
  }
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>) {
    const catalog = this.ownCatalog(req, query);
    return { ...this.accounts.favorites(accountToken(req)), catalog };
  }
  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  change(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>, @Body() body: unknown) {
    assertAccountOrigin(req);
    return this.accounts.changeFavorite(accountToken(req), body, this.ownCatalog(req, query));
  }
}
