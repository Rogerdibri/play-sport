import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { OfficialScoringModule } from '../live-scoring/official-scoring.module';
import { GameChatController } from './game-chat.controller';
import { GameChatService } from './game-chat.service';

@Module({ imports: [AccountsModule, OfficialScoringModule], controllers: [GameChatController], providers: [GameChatService] })
export class GameChatModule {}
