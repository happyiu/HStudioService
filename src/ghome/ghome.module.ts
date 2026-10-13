import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { GhomeController } from './ghome.controller';
import { GhomeService } from './ghome.service';

@Module({
  imports: [AuthModule],
  controllers: [GhomeController],
  providers: [GhomeService],
})
export class GhomeModule {}
