import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { Site } from '../database/entities/site.entity';
import { LuckyAdapter } from './lucky.adapter';
import { LuckyController } from './lucky.controller';
import { LuckyService } from './lucky.service';
import { SitesController } from './sites.controller';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Site])],
  controllers: [LuckyController, SitesController],
  providers: [LuckyAdapter, LuckyService],
})
export class LuckyModule {}
