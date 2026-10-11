import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { AdminTenantsController, TenantConsoleController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [AdminTenantsController, TenantConsoleController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
