import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PveClient } from './pve-client.service';
import { PveController } from './pve.controller';
import { PveMonitorService } from './pve-monitor.service';

@Module({
  imports: [AuthModule],
  controllers: [PveController],
  providers: [PveClient, PveMonitorService],
})
export class PveModule {}
