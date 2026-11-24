import { Module } from '@nestjs/common';
import { OfficialScoringController } from './official-scoring.controller';
import { OfficialScoringService } from './official-scoring.service';
import { RegistrationService } from './registration.service';
import { RegistrationController } from './registration.controller';
import { FriendlyGamesController } from './friendly-games.controller';
import { FriendlyGamesService } from './friendly-games.service';
import { AccountsModule } from '../accounts/accounts.module';
import { AccountsService } from '../accounts/accounts.service';
import { SportingAccountGuard } from './sporting-account.guard';
import { registrationAge } from '@playsport/shared';
import { FavoritesController } from './favorites.controller';
import { SportsSheetController } from './sports-sheet.controller';
import { ScorekeeperAccessController } from './scorekeeper-access.controller';

@Module({
  imports: [AccountsModule],
  controllers: [OfficialScoringController, RegistrationController, FriendlyGamesController, FavoritesController, SportsSheetController, ScorekeeperAccessController],
  providers: [{ provide: OfficialScoringService, inject: [RegistrationService], useFactory: (registry: RegistrationService) =>
    new OfficialScoringService(registry, { path: process.env.PLAYSPORT_OFFICIAL_STATE_PATH ?? '.local/official-scoring/state.sqlite' })
  }, SportingAccountGuard, { provide: RegistrationService, inject: [AccountsService], useFactory: (accounts: AccountsService) => {
    const registry = new RegistrationService(undefined, input => {
    const person = accounts.verifiedPerson(input);
    return person ? { id: `PERSON${person.identity.actorId!.slice('person:'.length).replace(/-/g, '').toUpperCase()}`, identification: person.identity.identification,
      fullName: person.identity.fullName, isMinor: registrationAge(person.identity.birthDate) < 18, registrationStatus: 'registered', privateIdentity: true } : null;
    });
    accounts.setRegisteredPersonLookup(input => registry.registeredPersonId(input));
    return registry;
  } },
    { provide: FriendlyGamesService, useFactory: () => new FriendlyGamesService() }],
  exports: [OfficialScoringService]
})
export class OfficialScoringModule {}
