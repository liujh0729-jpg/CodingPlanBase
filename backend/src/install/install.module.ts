import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { InstallController } from './install.controller';
import { InstallService } from './install.service';

@Module({
  imports: [UsersModule],
  controllers: [InstallController],
  providers: [InstallService],
})
export class InstallModule {}
