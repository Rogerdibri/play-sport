import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OfficialScoringModule } from './modules/live-scoring/official-scoring.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { GameChatModule } from './modules/game-chat/game-chat.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { InstitutionalLogosModule } from './modules/institutional-logos/institutional-logos.module';
import { TournamentsModule } from './modules/tournaments/tournaments.module';

@Module({
	imports: [OfficialScoringModule, AccountsModule, GameChatModule, MarketplaceModule, WalletModule, InstitutionalLogosModule, TournamentsModule],
	controllers: [AppController],
	providers: [AppService]
})
export class AppModule {}
