import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import {
  AdminEntitlementsController,
  AdminOrdersController,
  AdminPayController,
  ChandlerAuthController,
  PayController,
} from './chandler.controller';
import { ChandlerService } from './chandler.service';

@Module({
  imports: [PrismaModule, UsersModule, TenantsModule],
  controllers: [
    ChandlerAuthController,
    PayController,
    AdminOrdersController,
    AdminPayController,
    AdminEntitlementsController,
  ],
  providers: [ChandlerService],
  exports: [ChandlerService],
})
export class ChandlerModule {}
