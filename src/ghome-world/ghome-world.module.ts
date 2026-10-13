import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { GhomeWorld, GhomeCommandReceipt } from '../database/entities/ghome-world.entity';
import { GhomeWorldService } from './ghome-world.service';
import { GhomeWorldGateway } from './ghome-world.gateway';
import { GhomeWorldController } from './ghome-world.controller';
@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([GhomeWorld, GhomeCommandReceipt])],
  controllers: [GhomeWorldController], providers: [GhomeWorldService, GhomeWorldGateway],
  exports: [GhomeWorldGateway],
})
export class GhomeWorldModule {}
