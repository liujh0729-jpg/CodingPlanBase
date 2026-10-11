import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController, UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController, UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
