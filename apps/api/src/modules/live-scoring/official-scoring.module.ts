import { Module } from '@nestjs/common';
import { OfficialScoringController } from './official-scoring.controller';
import { OfficialScoringService } from './official-scoring.service';

@Module({
  controllers: [OfficialScoringController],
  providers: [OfficialScoringService],
  exports: [OfficialScoringService]
})
export class OfficialScoringModule {}
