import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { OfficialScoringModule } from '../live-scoring/official-scoring.module';
import { InstitutionalLogosService } from './institutional-logos.service';
import { InstitutionalLogosController } from './institutional-logos.controller';
@Module({
  imports: [AccountsModule, OfficialScoringModule],
  providers: [InstitutionalLogosService],
  controllers: [InstitutionalLogosController]
})
export class InstitutionalLogosModule {}
