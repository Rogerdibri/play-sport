import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';

@Module({ imports: [AccountsModule], controllers: [MarketplaceController], providers: [MarketplaceService] })
export class MarketplaceModule {}
