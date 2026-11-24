import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
  type CanActivate,
  type ExecutionContext
} from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { AccountsService } from '../accounts/accounts.service';
import { accountToken, assertAccountOrigin } from '../accounts/account-http';
import { OfficialScoringService } from './official-scoring.service';

export type ScorekeeperScopedRequest = IncomingMessage & { assertScorekeeperAccess?: () => void };
type Request = ScorekeeperScopedRequest & {
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  body?: Record<string, unknown>;
};
@Injectable()
export class SportingAccountGuard implements CanActivate {
  private readonly accounts: AccountsService | undefined;
  private readonly scoring: OfficialScoringService;
  constructor(@Optional() accounts: AccountsService, scoring: OfficialScoringService) {
    this.accounts = accounts;
    this.scoring = scoring;
  }
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>(),
      body = req.body ?? {};
    if (/\/registration\/adult(?:\?|$)/.test(req.url ?? '') && typeof body.identification === 'string') {
      const person = this.accounts?.verifiedPerson(body.identification);
      if (person) {
        const account = this.accounts!.authenticate(accountToken(req));
        assertAccountOrigin(req);
        if (
          account.id !== person.accountId ||
          body.fullName !== person.identity.fullName ||
          body.birthDate !== person.identity.birthDate
        )
          throw new ForbiddenException(
            'El registro debe pertenecer a tu propia identidad verificada y conservar sus datos.'
          );
      }
    }
    const tournamentId = req.params.tournamentId ?? body.tournamentId ?? req.query.tournamentId;
    if (req.params.tournamentId && body.tournamentId && req.params.tournamentId !== body.tournamentId)
      throw new BadRequestException('El torneo de la solicitud no coincide.');
    const actors = [
      body.managerId,
      body.actorId,
      body.organizerId,
      req.query.managerId,
      req.query.organizerId,
      req.query.userId,
      req.query.actorId
    ];
    const personal = actors.filter(
      (value): value is string => typeof value === 'string' && value.startsWith('person:')
    );
    const managed = typeof tournamentId === 'string' && this.scoring.hasManagedInscriptions(tournamentId);
    const officialWrite = req.method === 'POST' && /\/official-scoring\//.test(req.url ?? '');
    const actorRead = req.method === 'GET' && actors.some(value => typeof value === 'string' && value.length > 0);
    const privateRead =
      managed &&
      req.method === 'GET' &&
      /\/(?:official-scoring\/tournaments|registration\/roster)\//.test(req.url ?? '');
    const scorekeeperRequest = body.actorRole === 'scorekeeper' || body.role === 'scorekeeper' || req.query.role === 'scorekeeper';
    if (!personal.length && !officialWrite && !actorRead && !(managed && req.method === 'POST') && !privateRead && !scorekeeperRequest) return true;
    if (!this.accounts) throw new ForbiddenException('El acceso autenticado deportivo no está configurado.');
    const accounts = this.accounts;
    const account = accounts.authenticate(accountToken(req));
    if (scorekeeperRequest) {
      req.assertScorekeeperAccess = () => {
        const current = accounts.authenticate(accountToken(req));
        if (current.identity?.status !== 'verified' || !current.identity.actorId)
          throw new ForbiddenException('Verifica tu identidad para anotar partidos oficiales.');
        if (typeof tournamentId === 'string') {
          const gameId = req.params.gameId;
          const tournaments = this.scoring.scorekeeperTournaments(current.identity.actorId);
          const substitution = typeof gameId === 'string' && this.scoring.isScorekeeperSubstitute(current.identity.actorId, tournamentId, gameId);
          if (req.method === 'POST' && !(substitution ? this.scoring.scorekeeperTournamentActive(tournamentId) :
            tournaments.some(team => team.tournamentId === tournamentId && team.active)))
            throw new ForbiddenException('Este torneo no admite nuevas anotaciones.');
          const startedAt = typeof gameId === 'string' ? this.scoring.gameOperationStartedAt(tournamentId, gameId) : null;
          const continuing = typeof gameId === 'string' && this.scoring.scorekeeperGameAssigned(current.identity.actorId, tournamentId, gameId) &&
            accounts.roleContinuationAllowed(current, 'scorekeeper', startedAt);
          if (!substitution && !continuing) accounts.assertScorekeeperAccess(current, tournaments, tournamentId,
            typeof gameId === 'string' && this.scoring.scorekeeperGameAssigned(current.identity.actorId, tournamentId, gameId) ? gameId : undefined);
          if (req.method === 'POST' && !substitution) accounts.assertRoleOperation(current, 'scorekeeper',
            startedAt);
        } else if (req.method === 'POST' || !/\/official-scoring\/games(?:\?|$)/.test(req.url ?? ''))
          throw new ForbiddenException('Anotador solo consulta jugadores y datos dentro de un torneo autorizado.');
      };
      req.assertScorekeeperAccess();
    }
    if (
      privateRead &&
      typeof tournamentId === 'string' &&
      !this.scoring.accountOrganizesTournament(tournamentId, account.id) &&
      !this.scoring.accountHasInscription(
        tournamentId,
        account.id,
        typeof req.params.teamId === 'string' ? req.params.teamId : undefined
      )
    )
      throw new ForbiddenException('No tienes acceso al roster privado de esta inscripción.');
    if (req.method === 'POST') assertAccountOrigin(req);
    const managerWrite = req.method === 'POST' && account.identity?.status === 'verified' &&
      (body.managerId === account.identity.actorId || body.role === 'manager' || body.actorRole === 'manager');
    const teamId = req.params.teamId ?? body.teamId;
    if (managerWrite && typeof tournamentId === 'string' && typeof teamId === 'string') {
      this.accounts.assertManagerTeamAccess(account, this.scoring.managerPlanTeams(account.identity!.actorId!, account.id),
        tournamentId, teamId, typeof req.params.gameId === 'string' ? this.scoring.gameOperationStartedAt(tournamentId, req.params.gameId) : null);
    }
    for (const actor of personal) {
      if (actors.some((value) => typeof value === 'string' && value !== actor))
        throw new ForbiddenException('No puedes combinar tu identidad con la de otro actor en una operación.');
      if (account.identity?.status !== 'verified' || actor !== account.identity.actorId)
        throw new ForbiddenException('Esta identidad deportiva no pertenece a tu cuenta verificada.');
      if (typeof tournamentId === 'string' &&
          !this.scoring.accountManagesTournament(tournamentId, actor, account.id) &&
          !this.scoring.accountOrganizesTournament(tournamentId, account.id) &&
          !this.scoring.actorAssignedTournament(tournamentId, actor) &&
          !(scorekeeperRequest && typeof req.params.gameId === 'string' && this.scoring.isScorekeeperSubstitute(actor, tournamentId, req.params.gameId)))
        throw new ForbiddenException('No tienes este torneo o partido asignado.');
    }
    if (!personal.length && !privateRead && !scorekeeperRequest &&
        !(account.localTestAccess && process.env.NODE_ENV !== 'production'))
      throw new ForbiddenException('Los perfiles locales no conceden permisos. Utiliza tu identidad verificada y tus asignaciones.');
    if (
      managed &&
      req.method === 'POST' &&
      !personal.length &&
      !(account.localTestAccess && process.env.NODE_ENV !== 'production' && this.scoring.accountOrganizesTournament(tournamentId, account.id))
    )
      throw new ForbiddenException('Esta operación requiere la cuenta organizadora autorizada.');
    if (managed && req.method === 'POST' && !personal.length && body.managerId)
      throw new ForbiddenException('El roster y el lineup de esta inscripción solo los prepara su manager.');
    if (
      managed &&
      req.method === 'POST' &&
      /\/official-scoring\/tournaments\/[^/]+\/teams\/[^/]+\/roster(?:\?|$)/.test(req.url ?? '')
    )
      throw new ForbiddenException(
        'Prepara el roster desde la inscripción del manager y envíalo a revisión; no se sustituye desde las herramientas anteriores.'
      );
    return true;
  }
}
