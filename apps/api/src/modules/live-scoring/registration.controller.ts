import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header, Headers, Optional, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { AccountsService } from '../accounts/accounts.service';
import { accountToken } from '../accounts/account-http';
import { SportingAccountGuard } from './sporting-account.guard';
import { isRosterRole, rosterLookupKey, type AdultRegistration, type MinorRegistration, type ManagerRoster, type ManagerRosterTeam,
  type PreRegistration, type RosterRole, type RosterPerson } from '@playsport/shared';
import { RegistrationService } from './registration.service';
import { OfficialScoringService } from './official-scoring.service';

@Controller('registration')
@UseGuards(SportingAccountGuard)
export class RegistrationController {
  private readonly registry: RegistrationService;
  private readonly scoring: OfficialScoringService;
  private readonly accounts?: AccountsService;
  constructor(registry: RegistrationService, scoring: OfficialScoringService, @Optional() accounts?: AccountsService) {
    this.registry = registry;
    this.scoring = scoring;
    this.accounts = accounts;
  }
  private access(authorization?: string) { return authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''; }
  @Get('roster/player-teams')
  @Header('Cache-Control', 'private, no-store')
  playerTeams(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>) {
    if (!this.accounts) throw new ForbiddenException('El acceso autenticado deportivo no está configurado.');
    const account = this.accounts.authenticate(accountToken(req));
    if (Object.keys(query).length) throw new BadRequestException('Los equipos se consultan desde tu propia cuenta, sin parámetros de identidad.');
    return { accountId: account.id, teams: account.identity?.status === 'verified' ?
      this.scoring.listPlayerTeams(account.identity.identification) : [] };
  }
  private managerTeam(managerId: string, tournamentId: string, teamId: string) {
    const team = this.scoring.listManagerRosterTeams(managerId).find(item => item.tournamentId === tournamentId && item.teamId === teamId);
    if (!team) throw new ForbiddenException('Solo el manager del equipo puede consultar o preparar este roster.');
    return team;
  }
  @Get('roster/manager-teams')
  @Header('Cache-Control', 'private, no-store')
  managerTeams(@Req() req: IncomingMessage, @Query() query: Record<string, unknown>) {
    if (!this.accounts) throw new ForbiddenException('El acceso autenticado deportivo no está configurado.');
    const account = this.accounts.authenticate(accountToken(req));
    if (Object.keys(query).length) throw new BadRequestException('Los equipos se consultan desde tu propia cuenta, sin parámetros de identidad.');
    if (account.identity?.status !== 'verified') return { accountId: account.id, teams: [] };
    if (!account.identity.actorId) throw new ConflictException('No se pudo resolver tu identidad deportiva verificada.');
    return { accountId: account.id, teams: this.scoring.listManagerSportsTeams(account.identity.actorId, account.id) };
  }
  private roster(team: ManagerRosterTeam): ManagerRoster {
    const official = this.scoring.getTournamentTeamRoster(team.tournamentId, team.teamId, 'free');
    const approved = official.rosterPlayers.map(player => {
      const person = this.registry.rosterPerson(player.identificationNumber) ?? this.scoring.lookupRosterPerson(player.identificationNumber);
      if (!person) throw new ConflictException('No se pudo resolver un integrante del roster aprobado. No se reemplazó.');
      return { person, role: 'PLAYER' as const, approvalStatus: 'approved' as const };
    });
    const direct = this.registry.rosterMembers(team);
    const ids = new Set(direct.map(row => row.person.id));
    return { team, members: [...approved.filter(row => !ids.has(row.person.id)), ...direct],
      admission: this.registry.rosterAdmission(this.scoring.rosterRulesContext(team.tournamentId), team.teamId) };
  }
  private organizerContext(tournamentId: string, organizerId: string) {
    if (typeof organizerId !== 'string' || !organizerId.trim()) throw new BadRequestException('Falta el organizador del torneo.');
    const context = this.scoring.rosterRulesContext(tournamentId);
    if (context.organizerId !== organizerId) throw new ForbiddenException('Solo el organizador propietario puede configurar estas reglas.');
    return context;
  }
  @Get('roster/rules')
  rosterRuleTournaments(@Query('organizerId') organizerId: string) {
    return { tournaments: this.scoring.listOrganizerRosterTournaments(organizerId) };
  }
  @Get('roster/rules/:tournamentId')
  getRosterRules(@Param('tournamentId') tournamentId: string, @Query('organizerId') organizerId: string) {
    return this.registry.rosterRules(this.organizerContext(tournamentId, organizerId));
  }
  @Post('roster/rules/:tournamentId')
  saveRosterRules(@Param('tournamentId') tournamentId: string, @Body() input: { organizerId: string; rules: unknown; revision: number; reopen: boolean }) {
    return this.registry.saveRosterRules(this.organizerContext(tournamentId, input.organizerId), input.rules, input.revision, input.reopen);
  }
  @Get('roster/teams')
  rosterTeams(@Query('managerId') managerId: string) { return { teams: this.scoring.listManagerRosterTeams(managerId) }; }
  @Get('roster/members')
  getRoster(@Query('managerId') managerId: string, @Query('tournamentId') tournamentId: string, @Query('teamId') teamId: string) {
    return this.roster(this.managerTeam(managerId, tournamentId, teamId));
  }
  @Get('roster/person')
  lookupRoster(@Query('managerId') managerId: string, @Query('tournamentId') tournamentId: string, @Query('teamId') teamId: string,
    @Query('identification') identification: string) {
    this.managerTeam(managerId, tournamentId, teamId);
    if (typeof identification !== 'string') throw new BadRequestException('Introduce una cédula o ID.');
    let key: string;
    try { key = rosterLookupKey(identification); } catch (error) {
      if (error instanceof Error) throw new BadRequestException(error.message);
      throw error;
    }
    return { person: this.registry.rosterPerson(key) ?? this.scoring.lookupRosterPerson(key) };
  }
  @Post('roster/members')
  addRoster(@Body() input: { managerId: string; tournamentId: string; teamId: string; role: RosterRole; personId: string }) {
    const team = this.managerTeam(input.managerId, input.tournamentId, input.teamId);
    if (typeof input.personId !== 'string' || !input.personId || !isRosterRole(input.role)) throw new BadRequestException('Selecciona una persona existente y su cargo.');
    const person = this.registry.rosterPerson(input.personId) ?? this.scoring.lookupRosterPerson(input.personId);
    if (!person) throw new BadRequestException('No se encontró esa persona. Búscala o preinscríbela primero.');
    this.assertNotApproved(team, person);
    this.registry.addRosterMember(team, input.role, person, { context: this.scoring.rosterRulesContext(team.tournamentId),
      validate: candidate => this.scoring.assertManagerRosterAddition(team, input.role, candidate) });
    return this.roster(team);
  }
  private assertNotApproved(team: ManagerRosterTeam, person: RosterPerson) {
    if (this.roster(team).members.some(row => row.approvalStatus === 'approved' && row.person.id === person.id)) {
      throw new ConflictException('Esta persona ya figura en el roster. No se duplicó ni se cambió su cargo.');
    }
  }
  @Post('roster/preinscriptions')
  preinscribe(@Body() input: { managerId: string; tournamentId: string; teamId: string; role: RosterRole; person: PreRegistration }) {
    const team = this.managerTeam(input.managerId, input.tournamentId, input.teamId);
    if (!isRosterRole(input.role)) throw new BadRequestException('Selecciona un cargo válido del roster.');
    if (typeof input.person?.identification === 'string' && input.person.identification &&
        (this.scoring.lookupRosterPerson(input.person.identification) || this.scoring.hasExistingPlayerIdentity(input.person.identification))) {
      throw new ConflictException('Esta identidad ya tiene un registro deportivo. Utiliza el existente; no se creó otra persona.');
    }
    this.registry.preinscribeRosterMember(team, input.role, input.person, { context: this.scoring.rosterRulesContext(team.tournamentId),
      validate: candidate => this.scoring.assertManagerRosterAddition(team, input.role, candidate) });
    return this.roster(team);
  }
  @Post('roster/invitation')
  invitePreRegistration(@Body() input: { managerId: string; tournamentId: string; teamId: string; personId: string }) {
    const team = this.managerTeam(input.managerId, input.tournamentId, input.teamId);
    return this.registry.invitePreRegistration(team, input.personId);
  }
  @Post('preinscriptions/recover')
  recoverPreRegistration(@Headers('authorization') authorization: string, @Body() input: { invitation: string }) {
    return this.registry.recoverPreRegistration(this.access(authorization), input.invitation);
  }
  @Post('access')
  createAccess() { return this.registry.createAccess(); }
  @Get('family')
  getFamily(@Headers('authorization') authorization?: string) { return this.registry.getFamily(this.access(authorization)); }
  @Post('adult')
  saveAdult(@Headers('authorization') authorization: string, @Body() input: AdultRegistration) {
    return this.registry.saveAdult(this.access(authorization), input);
  }
  @Post('children')
  addMinor(@Headers('authorization') authorization: string, @Body() input: MinorRegistration) {
    const family = this.registry.addMinor(this.access(authorization), input, identification => this.scoring.hasExistingPlayerIdentity(identification));
    this.scoring.refreshRegisteredMinors();
    return family;
  }
  @Post('children/:childId/document')
  addDocument(@Headers('authorization') authorization: string, @Param('childId') childId: string, @Body() input: { identification: string }) {
    return this.registry.addDocument(this.access(authorization), childId, input.identification, identification => this.scoring.hasExistingPlayerIdentity(identification));
  }
  @Post('children/:childId/transfer')
  inviteTransfer(@Headers('authorization') authorization: string, @Param('childId') childId: string, @Body() input: { identification: string }) {
    return this.registry.inviteTransfer(this.access(authorization), childId, input.identification);
  }
  @Post('transfers/accept')
  acceptTransfer(@Headers('authorization') authorization: string, @Body() input: { invitation: string; relationship: MinorRegistration['relationship']; consent: boolean }) {
    return this.registry.acceptTransfer(this.access(authorization), input.invitation, input.relationship, input.consent);
  }
}
