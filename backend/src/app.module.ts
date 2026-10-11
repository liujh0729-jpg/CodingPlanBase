import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { GatewayModule } from './gateway/gateway.module';
import { HealthController } from './health.controller';
import { InstallModule } from './install/install.module';
import { PrismaModule } from './prisma/prisma.module';
import { ChandlerModule } from './chandler/chandler.module';
import { SettingsModule } from './settings/settings.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';

const environment = process.env.NODE_ENV || 'development';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        `.env.${environment}.local`,
        `.env.${environment}`,
        '.env.local',
        '.env',
      ],
    }),
    PrismaModule,
    AuthModule,
    SettingsModule,
    UsersModule,
    TenantsModule,
    GatewayModule,
    ChandlerModule,
    InstallModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
