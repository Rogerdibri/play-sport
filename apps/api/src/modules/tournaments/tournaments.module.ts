import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { OfficialScoringModule } from '../live-scoring/official-scoring.module';
import { TournamentsService } from './tournaments.service';
import { TournamentsController } from './tournaments.controller';
@Module({
  imports: [AccountsModule, OfficialScoringModule],
  providers: [TournamentsService],
  controllers: [TournamentsController],
  exports: [TournamentsService]
})
export class TournamentsModule {}
