import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { BillingService } from './billing.service';
import { CatalogService } from './catalog.service';
import { ChannelCacheService } from './channel-cache.service';
import { ChannelsService } from './channels.service';
import {
  ChannelsController,
  ModelsController,
  SetupController,
  TokensController,
  WalletController,
} from './gateway.controller';
import { RelayController } from './relay.controller';
import { RelayService } from './relay.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [
    ChannelsController,
    TokensController,
    ModelsController,
    SetupController,
    WalletController,
    RelayController,
  ],
  providers: [
    ChannelCacheService,
    ChannelsService,
    TokensService,
    BillingService,
    CatalogService,
    RelayService,
  ],
  exports: [CatalogService, ChannelsService, ChannelCacheService],
})
export class GatewayModule {}
