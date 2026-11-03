import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OfficialScoringModule } from './modules/live-scoring/official-scoring.module';

@Module({
	imports: [OfficialScoringModule],
	controllers: [AppController],
	providers: [AppService]
})
export class AppModule {}
